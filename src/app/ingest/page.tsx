"use client";

import Link from "next/link";
import { startTransition, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import type { Concept, Deck } from "@/lib/types";
import {
  appendConceptsToDeck,
  findDeckBySourceKey,
  getSavedDecks,
  saveDeck,
  setStudyDeck,
} from "@/lib/storage";
import PdfDropzone from "@/components/PdfDropzone";
import { vibrateTap } from "@/lib/haptics";
import { FREE_DECKS_PER_MONTH } from "@/lib/freeQuota";
import { chunkText, DEFAULT_CHUNK_SIZE } from "@/lib/chunkText";
import {
  CONTINUE_BATCH_SIZE,
  PERSIST_FAILED_CODE,
  runChunks,
  runChunksContinuous,
  type ContinuousProgress,
} from "@/lib/ingestChunks";
import { sourceKeyFor } from "@/lib/sourceKey";
import { apiUrl, API_FETCH_CREDENTIALS } from "@/lib/apiUrl";

// The ids this app is realistically pinned to, with the names their makers use. A map
// rather than a clever transform because "gpt-oss" prettifies to "Gpt Oss" and no
// amount of casing rules fixes that.
//
// DECLARED BEFORE MODEL_OPTIONS, and it has to stay that way: MODEL_OPTIONS calls
// freeModelLabel() during module evaluation, and a `const` read from inside a function
// called before its own declaration is a temporal-dead-zone ReferenceError, not
// undefined. Function declarations hoist; const bindings do not. Getting this order
// wrong broke a production build with "Cannot access 'x' before initialization" while
// `tsc --noEmit` stayed perfectly clean - TypeScript does not model TDZ across a call.
const FREE_MODEL_LABELS: Record<string, string> = {
  "qwen/qwen3.6-27b": "Qwen 3.6 27B",
  "openai/gpt-oss-120b": "GPT-OSS 120B",
  "openai/gpt-oss-20b": "GPT-OSS 20B",
};

/** The dropdown's name for the free model. Falls back to a best-effort prettifier so
 * an unrecognised id still reads as something rather than breaking the label. */
function freeModelLabel(id: string): string {
  const known = FREE_MODEL_LABELS[id];
  if (known) return known;
  const name = id.split("/").pop() ?? id;
  return name
    .split("-")
    .map((part) => (/^\d/.test(part) ? part.toUpperCase() : part.charAt(0).toUpperCase() + part.slice(1)))
    .join(" ");
}

// Kept local (not imported from @/lib/ai) on purpose: that module pulls in the
// server-side provider SDKs, and importing it here would drag them into the
// client bundle. These ids must stay in sync with @/lib/ai's FREE_MODEL and
// the route's requestSchema (which derives its enum from that same constant).
// Read from the environment so a Groq model decommission is a config change rather
// than an app release - see the FREE_MODEL comment in @/lib/ai, which this must stay
// in lockstep with. The label is derived rather than hardcoded for the same reason.
const DEFAULT_MODEL = process.env.NEXT_PUBLIC_GROQ_FREE_MODEL || "qwen/qwen3.6-27b";
const MODEL_OPTIONS = [
  { id: DEFAULT_MODEL, label: `${freeModelLabel(DEFAULT_MODEL)} (Free)`, pro: false },
  { id: "claude-haiku-latest", label: "Claude Haiku (Pro)", pro: true },
] as const;

// Coverage cap. Sequential chunking is safe from rate limits, but 40 requests is
// five minutes of standing still on a phone. At the 4500-character chunk size
// (DEFAULT_CHUNK_SIZE) this is ~90,000 characters of a book in ~20 requests -
// half the requests the old 40 x 1500 spent, across 1.5x the text. Whatever is
// left over is saved as pendingChunks and finished from the library on demand.
const MAX_CHUNKS = 20;

function titleFromFileName(fileName: string): string {
  const withoutExtension = fileName.replace(/\.pdf$/i, "");
  return withoutExtension.trim() || "Untitled Notes";
}

export default function IngestPage() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const plan = session?.user?.plan ?? "FREE";
  const isAuthenticated = status === "authenticated";

  const [selectedModel, setSelectedModel] = useState<string>(DEFAULT_MODEL);
  const [text, setText] = useState("");
  const [title, setTitleState] = useState("Untitled Notes");
  // saveDeck() needs the title as of whenever generation actually finishes,
  // not whatever it was when generation *started* - a plain closure over
  // `title` inside handleGenerate would go stale if the user edits the
  // title while a request is in flight. Keep a ref in lockstep instead.
  const titleRef = useRef(title);
  const [concepts, setConcepts] = useState<Concept[] | null>(null);
  const [savedDeckId, setSavedDeckId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Distinct from `error`: when the server rejects with FREE_LIMIT_REACHED we
  // show the premium upsell block instead of the generic error banner.
  const [showPaywall, setShowPaywall] = useState(false);
  // 1-indexed - currentChunk is 0 whenever we're not mid-generation.
  const [currentChunk, setCurrentChunk] = useState(0);
  const [totalChunks, setTotalChunks] = useState(0);
  // Set while a retry is sleeping off a rate limit. Without it the progress bar
  // sits at the same part for up to 45 seconds with nothing to say, which reads
  // as a hang - and a student who force-quits there loses the whole deck.
  const [waitingReason, setWaitingReason] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  // The deck this upload turns out to be a repeat of, held so the student can
  // choose before anything is spent. Non-null means the recognition card is up and
  // NO request has been sent - see handleGenerate.
  const [recognised, setRecognised] = useState<{
    deck: Deck;
    text: string;
    sourceKey: string;
  } | null>(null);
  // Progress of a continuous run over a recognised deck's leftovers, and the flag
  // that asks it to stop. A ref, not state: runChunksContinuous polls it from
  // inside a loop that closed over its own render, and a state value read there
  // would be forever false.
  const [continuing, setContinuing] = useState(false);
  const [continueProgress, setContinueProgress] = useState<ContinuousProgress | null>(null);
  const stopRequested = useRef(false);
  // What is left of this month's generation allowance, for the recognition card.
  // Null while unknown (not yet fetched, or the request failed) - the card simply
  // omits the line rather than guessing, because a wrong number here would be worse
  // than no number.
  const [allowance, setAllowance] = useState<{ remaining: number; limit: number } | null>(null);

  // Only while the recognition card is up, and re-read when a run finishes so a
  // second Continue shows what the first one spent. Deliberately not fetched on page
  // load: nothing else on this screen has a use for it.
  const recognisedDeckId = recognised?.deck.id ?? null;
  useEffect(() => {
    if (!recognisedDeckId || continuing || !isAuthenticated) return;
    let cancelled = false;
    const tzOffset = new Date().getTimezoneOffset();
    fetch(apiUrl(`/api/account/usage?tzOffset=${tzOffset}`), {
      credentials: API_FETCH_CREDENTIALS,
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data || typeof data.remaining !== "number") return;
        setAllowance({ remaining: data.remaining, limit: data.limit });
      })
      .catch(() => {
        // A missing allowance line is a cosmetic loss; the server enforces the
        // ceiling regardless, so there is nothing to recover from here.
      });
    return () => {
      cancelled = true;
    };
  }, [recognisedDeckId, continuing, isAuthenticated]);

  const selectedIsPro = MODEL_OPTIONS.find((m) => m.id === selectedModel)?.pro ?? false;
  // A free user who picked a Pro model - the one state we hard-block generation on.
  const proModelLocked = selectedIsPro && plan !== "PRO";

  function setTitle(value: string) {
    titleRef.current = value;
    setTitleState(value);
  }

  async function handleGenerate(
    sourceText: string = text,
    options: { skipRecognition?: boolean } = {},
  ) {
    vibrateTap();
    // Without this, dropping a PDF while a pasted-text generation is still in
    // flight (handlePdfExtracted calls this unconditionally) starts a second
    // concurrent run - the two loops interleave currentChunk/totalChunks/
    // concepts updates and can save the deck twice.
    if (loading) return;
    if (!isAuthenticated) {
      setError("Please sign in to generate concepts.");
      return;
    }
    if (proModelLocked) {
      setError("You need a Pro subscription to use this model.");
      return;
    }

    const trimmed = sourceText.trim();
    if (trimmed.length === 0) return;

    // Before anything is chunked or sent: is this a source we have already made
    // cards from? If so, offer to continue that deck and spend NOTHING until the
    // student picks. Doing this after generating would mean paying for cards they
    // already own, which is exactly what re-uploading costs them today.
    const sourceKey = sourceKeyFor(trimmed);
    if (!options.skipRecognition) {
      const existing = findDeckBySourceKey(sourceKey, session?.user?.id);
      if (existing) {
        setError(null);
        setShowPaywall(false);
        setConcepts(null);
        setTruncated(false);
        setRecognised({ deck: existing, text: trimmed, sourceKey });
        return;
      }
    }
    setRecognised(null);

    const allChunks = chunkText(trimmed, DEFAULT_CHUNK_SIZE);
    const wasTruncated = allChunks.length > MAX_CHUNKS;
    const chunks = wasTruncated ? allChunks.slice(0, MAX_CHUNKS) : allChunks;
    const pendingChunks = wasTruncated ? allChunks.slice(MAX_CHUNKS) : [];

    setLoading(true);
    setError(null);
    setShowPaywall(false);
    setConcepts(null);
    setTruncated(wasTruncated);
    setTotalChunks(chunks.length);
    setWaitingReason(null);

    // Chunks are sent one at a time, in order, retrying the failures worth
    // retrying - see runChunks. `failedAtIndex` is which chunk was in flight when
    // it gave up, so the catch block can recover the unprocessed remainder
    // instead of discarding it; see the comment on that block for why it matters.
    let accumulated: Concept[] = [];
    let failedAtIndex = chunks.length;
    // The route's machine-readable reason for stopping, where it sent one. The catch
    // below branches on this rather than on message text - see runChunks.
    let failureCode: string | null = null;

    try {
      const run = await runChunks(chunks, {
        model: selectedModel,
        countsFirstChunk: true,
        onProgress: ({ current, waitingReason }) => {
          setCurrentChunk(current);
          setWaitingReason(waitingReason);
        },
      });
      accumulated = run.concepts;
      failedAtIndex = run.failedAtIndex;
      failureCode = run.code;
      if (run.error) throw new Error(run.error);

      setConcepts(accumulated);
      // Auto-persist immediately so a refresh (even before the user clicks
      // "Start studying") never loses a freshly generated deck.
      const deck = saveDeck(titleRef.current, accumulated, {
        pendingChunks,
        model: selectedModel,
        userId: session?.user?.id,
        sourceKey,
      });
      setSavedDeckId(deck.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Something went wrong.";
      const budgetReached = failureCode === "GENERATION_BUDGET_REACHED";

      // Whatever stopped the run, cards that were generated were paid for - save
      // them and queue the rest. Done before the branching below so no path can
      // silently drop them.
      if (accumulated.length > 0) {
        try {
          const deck = saveDeck(titleRef.current, accumulated, {
            pendingChunks: [...chunks.slice(failedAtIndex), ...pendingChunks],
            model: selectedModel,
            userId: session?.user?.id,
            sourceKey,
          });
          setSavedDeckId(deck.id);
          setConcepts(accumulated);
        } catch (saveError) {
          // Saving is what this block exists to do, and it is also one of the things
          // that can have landed us in it: saveDeck throws when the device has no
          // room left (DeckStorageFullError). Throwing a second time here would leave
          // handleGenerate with no message on screen at all - twenty chunks paid for
          // and nothing to show - so the storage message stands in for the branching
          // below, which would otherwise tell the student to go and finish a deck
          // that was never created.
          setError(saveError instanceof Error ? saveError.message : message);
          return;
        }
      }

      if (message === "FREE_LIMIT_REACHED") {
        // Swap the generic error banner for the dedicated upsell block.
        setError(null);
        setShowPaywall(true);
      } else if (budgetReached) {
        // Distinct from the snag copy below on purpose: that one says "tap Generate
        // Next Section to finish", and the next tap is refused for the same reason
        // this one was. Telling a student to retry into a wall is worse than saying
        // there is a wall.
        setError(
          accumulated.length > 0
            ? `${message} We saved the ${accumulated.length} cards that were generated before it ran out.`
            : message,
        );
      } else if (accumulated.length > 0) {
        // A later chunk failed after at least one earlier chunk already succeeded.
        // Chunk 0 succeeding is what spends one of a FREE user's monthly decks
        // server-side (see /api/ingest's isFirstChunk gate), so the save above is what
        // keeps that allowance from being burned for nothing. "Generate Next Section"
        // sends isFirstChunk: false, so finishing later costs no extra deck.
        setError(
          "Generation hit a snag partway through, but we saved what we got. Go to your library and tap \"Generate Next Section\" to finish this deck - it won't cost you anything extra.",
        );
      } else {
        setError(message);
      }
    } finally {
      setLoading(false);
      setCurrentChunk(0);
      setTotalChunks(0);
      setWaitingReason(null);
    }
  }

  /** Continue the deck this upload turned out to be a repeat of.
   *
   * Generates from the DECK's own pendingChunks, not from the text just uploaded -
   * that is the whole point. The deck's leftovers are the authoritative record of
   * what has not been generated, so nothing is re-generated and nothing is paid for
   * twice, and no second library row appears. */
  async function handleContinueRecognised() {
    if (!recognised) return;
    const { deck } = recognised;
    const pending = deck.pendingChunks ?? [];
    if (pending.length === 0) return;

    vibrateTap();
    stopRequested.current = false;
    setContinuing(true);
    setError(null);
    setConcepts(null);
    setContinueProgress({
      currentSection: 1,
      totalSections: pending.length,
      cardsSoFar: 0,
      waitingReason: null,
      stopping: false,
    });

    try {
      const run = await runChunksContinuous(pending, {
        // The deck's own model, not the dropdown's: continuing a Pro deck on the
        // free model would silently change what the cards were made by.
        model: deck.model,
        // This deck's first chunk was paid for when it was created. Marking one of
        // these as a first chunk would charge a student a second deck allowance for
        // the book they are already part-way through.
        countsFirstChunk: false,
        batchSize: CONTINUE_BATCH_SIZE,
        shouldStop: () => stopRequested.current,
        onBatch: (batchConcepts, remaining) =>
          appendConceptsToDeck(deck.id, batchConcepts, remaining),
        onProgress: setContinueProgress,
      });

      setSavedDeckId(deck.id);
      setConcepts(run.concepts);
      if (run.error) {
        const kept = run.concepts.length;
        // GENERATION_BUDGET_REACHED is one of two failures where "tap again" is wrong -
        // the next tap is refused for the same reason this one was.
        const budgetReached = run.code === "GENERATION_BUDGET_REACHED";
        // The other is a full device: the next tap would drop what it regenerates, and
        // the cards this run reports were generated but never saved, so neither the
        // retry advice nor the "we kept N" count may be shown for it.
        const persistFailed = run.code === PERSIST_FAILED_CODE;
        setError(
          !kept || persistFailed
            ? run.error
            : budgetReached
              ? `${run.error} We kept the ${kept} cards generated before it ran out.`
              : `${run.error} We kept the ${kept} cards that came through - tap again to carry on.`,
        );
      }
      // Read the deck back rather than patching the snapshot. onBatch has already
      // written it and storage is the only thing that knows what actually landed:
      // patching `pendingChunks` alone left the card saying "33 cards · 7 sections
      // left" when the deck had grown to 57 cards, and adding `run.concepts` instead
      // would be wrong the other way, since on a persist failure those are cards the
      // deck does not have.
      const stored = getSavedDecks().find((candidate) => candidate.id === deck.id);
      if (stored) {
        setRecognised((prev) => (prev && prev.deck.id === deck.id ? { ...prev, deck: stored } : prev));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      stopRequested.current = false;
      setContinuing(false);
      setContinueProgress(null);
    }
  }

  /** "Stop" - honoured at the next section boundary, never mid-section: the requests
   * already in flight are paid for either way. */
  function handleStopContinue() {
    vibrateTap();
    stopRequested.current = true;
    setContinueProgress((prev) => (prev ? { ...prev, stopping: true } : prev));
  }

  /** "Start a separate deck" - today's behaviour, now explicitly chosen. The new deck
   * carries the same sourceKey, so the next upload offers to continue the newest. */
  function handleStartSeparate() {
    if (!recognised) return;
    const { text: sourceText } = recognised;
    setRecognised(null);
    void handleGenerate(sourceText, { skipRecognition: true });
  }

  /** For a recognised deck with nothing left to generate: study it rather than
   * offering a button that would generate nothing. */
  function handleStudyRecognised() {
    if (!recognised) return;
    vibrateTap();
    setStudyDeck(recognised.deck.id, recognised.deck.concepts);
    startTransition(() => {
      router.push("/study");
    });
  }

  function handlePdfExtracted(extractedText: string, fileName: string) {
    setText(extractedText);
    setTitle(titleFromFileName(fileName));
    handleGenerate(extractedText);
  }

  function handleStartStudying() {
    if (!concepts || concepts.length === 0 || !savedDeckId) return;
    setStudyDeck(savedDeckId, concepts);
    // Low-priority transition so the tap's own visual feedback isn't blocked
    // on /study's (heavier) initial render committing - see PageTransition.tsx.
    startTransition(() => {
      router.push("/study");
    });
  }

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-4 py-10 sm:px-6 sm:py-16">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">Auto-Ingest</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Paste your lecture notes, textbook chapter, or a PDF below. We&apos;ll
        break it into micro-concepts ready for recall practice.
      </p>

      {status === "unauthenticated" && (
        <div className="mt-6 rounded-xl border border-border bg-surface px-4 py-3 text-sm text-foreground">
          You need to be signed in to generate concepts.{" "}
          <Link href="/login" className="font-medium underline">
            Sign in
          </Link>
        </div>
      )}

      <div className="mt-6">
        <PdfDropzone onExtracted={handlePdfExtracted} />
      </div>

      <div className="mt-4 flex items-center gap-3 text-xs uppercase tracking-widest text-muted-foreground">
        <div className="h-px flex-1 bg-foreground/10" />
        or paste text
        <div className="h-px flex-1 bg-foreground/10" />
      </div>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Paste your notes here..."
        rows={10}
        className="mt-4 w-full resize-y rounded-2xl border border-border bg-surface p-4 text-base text-foreground placeholder-muted-foreground outline-none focus:"
      />

      <label className="mt-4 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Deck title
      </label>
      <input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Untitled Notes"
        className="mt-1.5 w-full rounded-xl border border-border bg-surface px-4 py-3 text-base text-foreground placeholder-muted-foreground outline-none focus:"
      />

      <label
        htmlFor="model-select"
        className="mt-6 block text-xs font-bold uppercase tracking-widest text-foreground"
      >
        Model
      </label>
      <div className="relative mt-1.5">
        <select
          id="model-select"
          value={selectedModel}
          onChange={(e) => setSelectedModel(e.target.value)}
          className="w-full cursor-pointer appearance-none rounded-lg border border-border bg-surface px-4 py-3 pr-11 text-base font-bold text-foreground outline-none transition-all focus:-translate-x-0.5 focus:-translate-y-0.5 focus:"
        >
          {MODEL_OPTIONS.map((m) => (
            <option key={m.id} value={m.id} className="bg-surface font-medium text-foreground">
              {m.label}
            </option>
          ))}
        </select>
        <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-lg font-bold text-foreground">
          ▾
        </span>
      </div>

      {proModelLocked && (
        <div className="mt-3 rounded-lg border border-border bg-surface px-4 py-3 text-sm font-bold text-foreground">
          You need a Pro subscription to use this model.
        </div>
      )}

      <button
        type="button"
        onClick={() => handleGenerate()}
        disabled={loading || text.trim().length === 0 || !isAuthenticated || proModelLocked}
        className="mt-4 self-stretch rounded-full bg-accent ring-1 ring-inset ring-accent/30 shadow-[inset_0_1px_0_rgba(255,255,255,0.15),0_8px_24px_-6px_rgba(0,0,0,0.4)] px-6 py-3.5 text-base font-medium text-accent-foreground transition-all duration-200 hover:bg-accent/90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 sm:self-start sm:py-2.5 sm:text-sm"
      >
        {loading ? `Generating part ${currentChunk} of ${totalChunks}...` : "Generate micro-concepts"}
      </button>

      {recognised && <RecognisedSourceCard
        deck={recognised.deck}
        allowance={allowance}
        continuing={continuing}
        progress={continueProgress}
        onContinue={handleContinueRecognised}
        onStop={handleStopContinue}
        onStartSeparate={handleStartSeparate}
        onStudy={handleStudyRecognised}
      />}

      {showPaywall && (
        <div className="mt-4 overflow-hidden rounded-2xl border border-accent/30 bg-gradient-to-br from-accent/10 via-surface to-surface p-6 shadow-lg shadow-accent/5">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-widest text-accent">
              ✦ Flowrecall Pro
            </span>
          </div>
          <p className="mt-3 text-lg font-semibold text-foreground">
            You&apos;ve used all {FREE_DECKS_PER_MONTH} of this month&apos;s free decks.
          </p>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Your allowance resets at the start of next month. Everything you&apos;ve already
            made stays free to study, review and map. Pro removes the limit and unlocks the
            smartest models.
          </p>
          <Link
            href="/pricing"
            className="mt-5 inline-flex items-center justify-center rounded-full bg-accent px-6 py-3 text-sm font-semibold text-accent-foreground ring-1 ring-inset ring-accent/30 shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_8px_28px_-6px_rgba(0,0,0,0.45)] transition-all duration-200 hover:bg-accent/90 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_12px_40px_-6px_rgba(0,0,0,0.55)] active:scale-[0.98]"
          >
            Upgrade to Pro &rarr;
          </Link>
        </div>
      )}

      {loading && totalChunks > 1 && (
        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-foreground/10">
          <div
            className="h-full bg-accent transition-all"
            style={{ width: `${(currentChunk / totalChunks) * 100}%` }}
          />
        </div>
      )}

      {loading && waitingReason && (
        <p className="mt-2 text-center text-xs text-muted-foreground">{waitingReason}</p>
      )}

      {truncated && (
        <div className="mt-4 rounded-xl border border-border bg-surface px-4 py-3 text-sm font-medium text-foreground">
          To keep generation blazing fast, we processed the first section. You
          can generate the rest anytime from your Library!
        </div>
      )}

      {error && !proModelLocked && (
        <div className="mt-6 rounded-xl border border-border bg-surface px-4 py-3 text-sm text-foreground">
          {error}
        </div>
      )}

      {concepts && (
        <div className="mt-8 flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium text-muted-foreground">
              {concepts.length} concepts generated &middot; saved to your library
            </p>
            <button
              type="button"
              onClick={handleStartStudying}
              className="rounded-full bg-accent ring-1 ring-inset ring-accent/30 shadow-[inset_0_1px_0_rgba(255,255,255,0.15),0_8px_24px_-6px_rgba(0,0,0,0.4)] px-5 py-2.5 text-sm font-medium text-accent-foreground transition-all duration-200 hover:bg-accent/90 active:scale-95"
            >
              Start studying &rarr;
            </button>
          </div>
          {concepts.map((c) => (
            <div
              key={c.id}
              className="rounded-xl border border-border bg-surface p-4"
            >
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground/70">
                {c.concept}
              </p>
              <p className="mt-2 text-sm text-foreground">{c.question}</p>
              <p className="mt-1 text-sm text-muted-foreground">{c.answer}</p>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}

/** How long ago, in the words a student would use. Relative while that is the more
 * useful answer, then the same short date the library shows. */
function lastTouchedLabel(timestamp: number): string {
  const days = Math.floor((Date.now() - timestamp) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  return new Date(timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Shown when an upload turns out to be a source the student has already made cards
 * from - the alternative to silently adding a second copy of their book to the
 * library, which is what this screen did before.
 *
 * Nothing here has spent anything yet. handleGenerate returns before chunking when
 * it finds a match, so every request in this flow is behind one of these buttons. */
function RecognisedSourceCard({
  deck,
  allowance,
  continuing,
  progress,
  onContinue,
  onStop,
  onStartSeparate,
  onStudy,
}: {
  deck: Deck;
  allowance: { remaining: number; limit: number } | null;
  continuing: boolean;
  progress: ContinuousProgress | null;
  onContinue: () => void;
  onStop: () => void;
  onStartSeparate: () => void;
  onStudy: () => void;
}) {
  const sectionsLeft = deck.pendingChunks?.length ?? 0;
  const finished = sectionsLeft === 0;

  return (
    <div className="mt-4 overflow-hidden rounded-2xl border border-accent/30 bg-gradient-to-br from-accent/10 via-surface to-surface p-6 shadow-lg shadow-accent/5">
      <span className="text-xs font-bold uppercase tracking-widest text-accent">
        ✦ You&apos;ve studied this before
      </span>
      <p className="mt-3 text-lg font-semibold text-foreground">{deck.title}</p>
      {/* Hidden while a run is going, because it cannot keep up with one: the deck is
          rewritten every batch and this line is a snapshot taken when the card
          appeared. The progress block below is the live count. */}
      {!continuing && (
        <p className="mt-1.5 text-sm text-muted-foreground">
          {finished
            ? `Fully generated · ${deck.concepts.length} cards`
            : `${deck.concepts.length} cards · ${sectionsLeft} ${sectionsLeft === 1 ? "section" : "sections"} left`}
          {" · last added "}
          {lastTouchedLabel(deck.updatedAt ?? deck.createdAt)}
        </p>
      )}

      {/* What one tap will actually be able to finish. Continuous generation makes it
          easy to spend a month's allowance without meaning to, and being stopped
          part-way through a twenty-minute run is a worse way to learn this number.
          Omitted entirely when unknown rather than guessed. */}
      {!continuing && !finished && allowance && (
        <p className="mt-1 text-sm text-muted-foreground">
          {allowance.remaining === 0
            ? "You've used this month's generation allowance - it resets at the start of next month."
            : allowance.remaining < sectionsLeft
              ? `Your plan allows ${allowance.remaining} more ${allowance.remaining === 1 ? "section" : "sections"} this month, so this won't finish the book in one go.`
              : `Your plan allows ${allowance.remaining} more sections this month - enough to finish this.`}
        </p>
      )}

      {continuing && progress ? (
        <>
          <p className="mt-4 text-sm font-medium text-foreground">
            Generating section {progress.currentSection} of {progress.totalSections}...
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {progress.cardsSoFar} {progress.cardsSoFar === 1 ? "card" : "cards"} so far
            {progress.stopping ? " · finishing this section" : ""}
          </p>
          {/* The rate-limit wait, surfaced for the same reason /ingest surfaces it:
              a 62-second pause with nothing on screen reads as a hang, and this run
              can contain many of them. */}
          {progress.waitingReason && (
            <p className="mt-1 text-xs text-muted-foreground">{progress.waitingReason}</p>
          )}
          <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-foreground/10">
            <div
              className="h-full bg-accent transition-all"
              style={{
                width: `${Math.round((progress.currentSection / Math.max(1, progress.totalSections)) * 100)}%`,
              }}
            />
          </div>
          <button
            type="button"
            onClick={onStop}
            disabled={progress.stopping}
            className="mt-4 inline-flex items-center justify-center rounded-full border border-border bg-transparent px-6 py-3 text-sm font-semibold text-foreground transition-all duration-200 hover:bg-foreground/10 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {progress.stopping ? "Finishing this section..." : "Stop"}
          </button>
        </>
      ) : (
        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
          <button
            type="button"
            onClick={finished ? onStudy : onContinue}
            className="inline-flex items-center justify-center rounded-full bg-accent px-6 py-3 text-sm font-semibold text-accent-foreground ring-1 ring-inset ring-accent/30 shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_8px_28px_-6px_rgba(0,0,0,0.45)] transition-all duration-200 hover:bg-accent/90 active:scale-[0.98]"
          >
            {finished ? "Study this deck →" : "Continue this deck"}
          </button>
          <button
            type="button"
            onClick={onStartSeparate}
            className="text-sm font-medium text-muted-foreground underline decoration-muted-foreground/40 underline-offset-4 transition-colors hover:text-foreground"
          >
            Start a separate deck
          </button>
        </div>
      )}
    </div>
  );
}
