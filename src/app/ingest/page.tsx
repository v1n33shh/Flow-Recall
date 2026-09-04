"use client";

import Link from "next/link";
import { startTransition, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import type { Concept } from "@/lib/types";
import { saveDeck, setStudyDeck } from "@/lib/storage";
import PdfDropzone from "@/components/PdfDropzone";
import { vibrateTap } from "@/lib/haptics";
import { FREE_DECKS_PER_MONTH } from "@/lib/freeQuota";
import { chunkText, DEFAULT_CHUNK_SIZE } from "@/lib/chunkText";
import { runChunks } from "@/lib/ingestChunks";

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

// The ids this app is realistically pinned to, with the names their makers use. A map
// rather than a clever transform because "gpt-oss" prettifies to "Gpt Oss" and no
// amount of casing rules fixes that.
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

  const selectedIsPro = MODEL_OPTIONS.find((m) => m.id === selectedModel)?.pro ?? false;
  // A free user who picked a Pro model - the one state we hard-block generation on.
  const proModelLocked = selectedIsPro && plan !== "PRO";

  function setTitle(value: string) {
    titleRef.current = value;
    setTitleState(value);
  }

  async function handleGenerate(sourceText: string = text) {
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
      const deck = saveDeck(
        titleRef.current,
        accumulated,
        pendingChunks,
        selectedModel,
        session?.user?.id,
      );
      setSavedDeckId(deck.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Something went wrong.";
      const budgetReached = failureCode === "GENERATION_BUDGET_REACHED";

      // Whatever stopped the run, cards that were generated were paid for - save
      // them and queue the rest. Done before the branching below so no path can
      // silently drop them.
      if (accumulated.length > 0) {
        const deck = saveDeck(
          titleRef.current,
          accumulated,
          [...chunks.slice(failedAtIndex), ...pendingChunks],
          selectedModel,
          session?.user?.id,
        );
        setSavedDeckId(deck.id);
        setConcepts(accumulated);
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
