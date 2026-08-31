"use client";

import { startTransition, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { useSession } from "next-auth/react";
import type { ChallengeOutcome, Concept, QueueItem } from "@/lib/types";
import { addConceptsToDeck, getProgress, saveProgress } from "@/lib/storage";
import FeedSlide from "./FeedSlide";
import type { SwipeChallengeHandle } from "./SwipeChallenge";
import CompletionSlide from "./CompletionSlide";
import { apiUrl, API_FETCH_CREDENTIALS } from "@/lib/apiUrl";
import {
  buildConceptQueueItems,
  buildInitialQueue,
  nextEasierLevel,
  pathForLevel,
  reconstructResolvedKeys,
} from "@/lib/studyQueue";
import { getSavedDecks } from "@/lib/storage";
import { hasMigratedSavedDecks, importDeck, migrateSavedDecks, recordReview } from "@/lib/recallStorage";
import { unitIdFor, type Confidence } from "@/lib/recallModel";
import {
  createRetrievalClock,
  latencyFor,
  markEntered,
  type RetrievalClock,
} from "@/lib/retrievalClock";

// How many slides ahead a failed/skipped concept gets requeued at an easier level.
const RETRY_OFFSET = 3;

// A lane is retried at most this many times per session. Level 1 has no easier
// level to fall back to, so before this cap existed a failed swipe was requeued
// nowhere at all and failing the easiest card carried no consequence - while a
// failed cloze fell back to a two-option swipe that could then be guessed. Now
// every failure comes back, and nothing runs forever.
const MAX_ATTEMPTS_PER_LANE = 3;

// Which retrieval format the student was actually shown. Derived from LEVEL, not
// lane, and imported rather than declared here so FeedSlide's dispatch and this
// write can never drift apart again - see the PATH_BY_LEVEL docblock in
// lib/studyQueue.ts for what that drift cost.

/** A small Electric-Azure spinner with a soft glow behind it - the premium
 * loading state while Infinite Recall generates fresh cards. */
function GlowSpinner() {
  return (
    <span className="relative flex h-4 w-4">
      <span className="absolute inset-0 rounded-full bg-accent/40 blur-[6px]" />
      <svg className="relative h-4 w-4 animate-spin text-accent" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
        <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      </svg>
    </span>
  );
}

export default function StudyFeed({ deckId, concepts }: { deckId: string; concepts: Concept[] }) {
  const router = useRouter();

  // Read once - only the first render's value is used, by the lazy
  // initializers below. Computing it as a plain const (rather than inside
  // each initializer) avoids reading localStorage three separate times.
  const savedProgress = getProgress(deckId);

  const [queue, setQueue] = useState<QueueItem[]>(() => savedProgress?.queue ?? buildInitialQueue(concepts));
  const [masteredIds, setMasteredIds] = useState<Set<string>>(() => new Set(savedProgress?.masteredIds ?? []));

  // A queue item can resolve twice (e.g. answered, then later scrolled past) -
  // this guards so only the first resolution counts. On resume, seed it from
  // the restored progress so already-answered cards can't be re-triggered.
  // Prefer the exact persisted set; only pre-dual-lane saved sessions lack it
  // and need the heuristic fallback (see StudyProgress.resolvedKeys).
  const resolvedKeys = useRef<Set<string>>(
    new Set(
      savedProgress?.resolvedKeys ??
        (savedProgress ? reconstructResolvedKeys(savedProgress) : []),
    ),
  );
  // Which lanes of each concept have been answered CORRECTLY - the evidence
  // mastery now requires two of, instead of the single lucky answer it used to
  // take. Keyed `${conceptId}::${lane}`. Restored from saved progress; a session
  // saved before this field existed falls back to treating an already-mastered
  // concept as having passed both lanes, which is the only reading that keeps an
  // old resume from suddenly looking incomplete.
  // State, not a ref, and load-bearingly so: the save effect below keys off this
  // exactly as it does off masteredIds. Held as a ref, a correct answer on a
  // concept's FIRST lane would change neither masteredIds nor the queue, the
  // effect would never re-run, and that answer would be lost on resume.
  const [correctLaneKeys, setCorrectLaneKeys] = useState<Set<string>>(
    () =>
      new Set(
        savedProgress?.correctLaneKeys ??
          (savedProgress?.masteredIds ?? []).flatMap((id) => [`${id}::1`, `${id}::2`]),
      ),
  );

  // When each slide came into view, so a resolution can be timed. Measured from
  // viewport entry rather than mount: the feed renders every slide up front, so
  // mount time would report how long the student has been in the session, not
  // how long they spent on this card. Keyed by the item's own key, never by its
  // index - the queue mutates underneath both - see lib/retrievalClock.ts.
  const enteredAt = useRef<RetrievalClock>(createRetrievalClock());

  // Tracks roughly where the user is in the feed, so an async grading result
  // (chat challenge) can't requeue a retry behind where they've already scrolled.
  const currentIndexRef = useRef(0);

  // Registry of the live Level-1 swipe cards' imperative handles, keyed by
  // their queue index, so the global keyboard listener can reach whichever
  // card is currently on screen (via currentIndexRef). Levels 2 & 3 never
  // register a handle - see FeedSlide's challengeRef.
  const slideRefs = useRef(new Map<number, SwipeChallengeHandle>());

  // Total distinct concepts in this session. Grows when Infinite Recall Mode
  // appends new cards, so the progress denominator stays honest. On resume,
  // derive it from the restored queue (which already contains any appended
  // cards) rather than the smaller sessionStorage handoff in `concepts`.
  const [totalConcepts, setTotalConcepts] = useState<number>(() =>
    savedProgress
      ? new Set([
          ...savedProgress.queue.map((item) => item.concept.id),
          ...(savedProgress.masteredIds ?? []),
        ]).size
      : concepts.length,
  );
  const progress = totalConcepts === 0 ? 0 : Math.min(masteredIds.size / totalConcepts, 1);

  // --- Streak tracking ---------------------------------------------------
  // Fire once when the user actually opens a study session. The server
  // increments the streak if this is a new calendar day, and we refresh
  // the session so the navbar flame updates instantly without a reload.
  const { data: session, update: updateSession } = useSession();
  const isPro = session?.user?.plan === "PRO";
  // Every recall-engine record is scoped to the account, so two people signing
  // in on one phone can never merge learning histories - the wart the reader
  // library has. Undefined while the session loads or when signed out, in which
  // case the engine simply records nothing and the feed behaves as before.
  const userId = session?.user?.id;
  useEffect(() => {
    fetch(apiUrl("/api/study/track"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Lets the server compute "today" in this user's own timezone instead
      // of the server process's (see src/lib/localDay.ts).
      body: JSON.stringify({ timezoneOffsetMinutes: new Date().getTimezoneOffset() }),
      credentials: API_FETCH_CREDENTIALS,
    })
      .then(async (res) => {
        if (!res.ok) return;
        const { currentStreak } = await res.json();
        // Inject the fresh streak into the JWT so the navbar flame
        // updates instantly without a full page reload.
        if (typeof currentStreak === "number") {
          updateSession({ currentStreak });
        }
      })
      .catch(() => {}); // silent — streak tracking is non-critical
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Bring this deck into the recall engine. Runs on every session open, which is
  // deliberate: importDeck is idempotent (unit ids are derived from deck +
  // concept id), so this picks up concepts appended by Infinite Recall or a JIT
  // continuation without ever duplicating a unit or resetting its history.
  //
  // The one-time sweep of every OTHER saved deck is what stops the engine only
  // knowing about whichever deck happened to be studied first. Both are
  // best-effort: a failure here leaves the feed working exactly as it did.
  useEffect(() => {
    if (!userId) return;
    const deck = getSavedDecks().find((d) => d.id === deckId);
    const work = deck ? importDeck(deck, userId) : Promise.resolve([]);
    void work
      .then(() => (hasMigratedSavedDecks() ? null : migrateSavedDecks(userId, getSavedDecks())))
      .catch((error) => console.error("recall engine import failed", error));
  }, [userId, deckId]);

  // --- Infinite Recall Mode (Pro) ---------------------------------------

  const [showUpsell, setShowUpsell] = useState(false);
  const [shuffling, setShuffling] = useState(false);
  const [shuffleError, setShuffleError] = useState<string | null>(null);
  const [shuffleSuccess, setShuffleSuccess] = useState<number | null>(null);
  // Mid-session nudge: shown once to free users after they answer their 15th card.
  const [showMidNudge, setShowMidNudge] = useState(false);
  const answeredCountRef = useRef(0);

  async function handleInfiniteRecall() {
    // Growth hook: free users get the upsell modal instead of the feature.
    if (!isPro) {
      setShowUpsell(true);
      return;
    }
    if (shuffling) return;

    setShuffling(true);
    setShuffleError(null);
    try {
      // The server keeps no copy of the deck (this app is localStorage-only),
      // so send it a distilled view of the concepts we have - enough to riff on
      // the material and avoid repeating questions. Dedupe by concept id since
      // the same concept can appear multiple times in the queue.
      // Cap at 10 concepts so the prompt never exceeds Groq's 12,000 TPM limit
      // on large decks — a random sample gives the AI diverse context without
      // blowing the limit.
      const seen = new Map<string, Concept>();
      for (const item of queue) {
        if (!seen.has(item.concept.id)) seen.set(item.concept.id, item.concept);
      }
      const allUnique = Array.from(seen.values());
      const shuffledSample = allUnique.sort(() => Math.random() - 0.5).slice(0, 10);
      const seed = shuffledSample.map((c) => ({
        concept: c.concept,
        question: c.question,
        answer: c.answer,
        explanation: c.explanation,
      }));

      const res = await fetch(apiUrl(`/api/decks/${deckId}/shuffle`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ concepts: seed }),
        credentials: API_FETCH_CREDENTIALS,
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? "Couldn't generate new cards. Please try again.");
      }

      const newConcepts = (data.concepts as Concept[] | undefined) ?? [];
      if (newConcepts.length === 0) {
        throw new Error("No new cards came back. Please try again.");
      }

      // Insert the new cards RIGHT AFTER the current card position so the
      // student sees them on the very next swipe — not buried at the end.
      setQueue((prev) => {
        const insertAt = Math.min(currentIndexRef.current + 1, prev.length);
        // Same swipe+cloze pairing (and same guaranteed-non-adjacent
        // construction) as buildInitialQueue, so freshly-generated Infinite
        // Recall cards get two genuinely different questions per concept
        // too, not just one. isNew triggers FeedSlide's materialisation sweep.
        const newItems: QueueItem[] = buildConceptQueueItems(newConcepts, { isNew: true });
        return [
          ...prev.slice(0, insertAt),
          ...newItems,
          ...prev.slice(insertAt),
        ];
      });
      setTotalConcepts((t) => t + newConcepts.length);

      // Show success toast and auto-dismiss after 3 seconds.
      setShuffleSuccess(newConcepts.length);
      setTimeout(() => setShuffleSuccess(null), 3000);

      // Persist to the saved deck so re-studying later includes these, without
      // clobbering any leftover pendingChunks.
      addConceptsToDeck(deckId, newConcepts);
    } catch (err) {
      setShuffleError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setShuffling(false);
    }
  }

  // `resolvedAt` is captured by the caller, at the moment the answer actually
  // landed, rather than read here - both because that is the honest timestamp
  // and because reading the clock during render is exactly what the purity rule
  // exists to catch.
  function resolve(
    item: QueueItem,
    outcome: ChallengeOutcome,
    resolvedAt: number,
    confidence?: Confidence,
  ) {
    if (resolvedKeys.current.has(item.key)) return;
    resolvedKeys.current.add(item.key);

    // Mid-session nudge: fire once for free users after 15 answers.
    if (!isPro) {
      answeredCountRef.current += 1;
      if (answeredCountRef.current === 15) {
        setShowMidNudge(true);
        setTimeout(() => setShowMidNudge(false), 6000);
      }
    }

    // Hand the retrieval to the recall engine. Fire-and-forget on purpose: the
    // feed must never stall or fail because a write to IndexedDB did, and the
    // engine is additive - if this throws, the session behaves exactly as it
    // did before the engine existed.
    if (userId) {
      void recordReview({
        userId,
        unitId: unitIdFor(deckId, item.concept.id),
        path: pathForLevel(item.level),
        outcome,
        // Read by the RESOLVING card's own key, not by whatever is on screen.
        // Cloze grading is an async fetch, so a student who scrolls while a
        // verdict is pending would otherwise have this answer credited with a
        // different card's latency - and on a production path a borrowed short
        // latency grades EASY and inflates stability on a card they laboured
        // over. 0 means "not measured", which the engine reads as trustworthy
        // rather than suspect - the safe direction.
        latencyMs: latencyFor(enteredAt.current, item.key, resolvedAt),
        confidence,
      }).catch((error) => console.error("recordReview failed", error));
    }

    if (outcome === "correct") {
      // Mastery now needs BOTH of a concept's lanes answered correctly - a
      // recognition swipe and a typed cloze. One correct answer used to be
      // enough, and since lane 1 is a two-option true/false, that made the
      // progress bar half guesswork.
      setCorrectLaneKeys((prev) => {
        const next = new Set(prev).add(`${item.concept.id}::${item.lane}`);
        if (next.has(`${item.concept.id}::1`) && next.has(`${item.concept.id}::2`)) {
          setMasteredIds((mastered) => new Set(mastered).add(item.concept.id));
        }
        return next;
      });
      return;
    }

    // Skipping counts the same as answering wrong for requeueing - the user
    // didn't demonstrate recall either way. (The engine tells them apart: a
    // skip is logged but never allowed to decay a memory. See gradeFor.)
    //
    // Every failure comes back now. It used to fall to an EASIER level or, at
    // level 1, nowhere at all - so failing the easiest card had no consequence
    // and a failed cloze dropped to a swipe that could then be guessed. A lane
    // with no easier level left is retried at its own level instead, capped so
    // nothing runs forever.
    if (item.attempt >= MAX_ATTEMPTS_PER_LANE) return;
    const retryLevel = nextEasierLevel(item.level) ?? item.level;

    setQueue((prev) => {
      const idx = prev.findIndex((q) => q.key === item.key);
      if (idx === -1) return prev;

      const insertAt = Math.min(Math.max(idx + RETRY_OFFSET, currentIndexRef.current + 1), prev.length);
      const nextAttempt = item.attempt + 1;
      const retryItem: QueueItem = {
        key: `${item.concept.id}::${retryLevel}::${nextAttempt}`,
        concept: item.concept,
        level: retryLevel,
        lane: item.lane,
        attempt: nextAttempt,
      };

      const next = [...prev];
      next.splice(insertAt, 0, retryItem);
      return next;
    });
  }

  // Auto-save on every change so closing the tab mid-session never loses
  // progress - resuming later restores the exact queue and mastery.
  useEffect(() => {
    saveProgress(deckId, {
      deckId,
      masteredIds: Array.from(masteredIds),
      queue,
      resolvedKeys: Array.from(resolvedKeys.current),
      correctLaneKeys: Array.from(correctLaneKeys),
    });
    // resolvedKeys is a ref (mutated in resolve(), not via setState) so it's
    // exempt from the deps list. Every resolve() path now changes at least one
    // dep, so this always fires right after it: a correct answer updates
    // correctLaneKeys, and a wrong or skipped one updates queue. Before
    // correctLaneKeys was a dep, a first-lane success changed neither and the
    // answer was silently lost on resume.
  }, [deckId, masteredIds, queue, correctLaneKeys]);

  // Anki-style desktop shortcuts. One listener for the whole feed's lifetime,
  // torn down on unmount so it never double-fires. It reads everything it
  // needs from refs (the active index + the ref registry), so it stays fresh
  // without re-subscribing on every render.
  //   Space / Enter -> reveal the answer
  //   1 -> resolve Incorrect (only once revealed)
  //   2 -> resolve Correct   (only once revealed)
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      // Never hijack typing: the ChatChallenge textarea and FillBlank input
      // rely on these very keys. Bail if focus is in an editable field.
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }

      // Leave browser/OS chords (Cmd+Enter, etc.) and auto-repeat alone.
      if (event.metaKey || event.ctrlKey || event.altKey || event.repeat) return;

      // Only Level-1 swipe cards register a handle, so on Levels 2 & 3 this is
      // undefined and every shortcut becomes a no-op.
      const active = slideRefs.current.get(currentIndexRef.current);
      if (!active || active.isResolved()) return;

      switch (event.key) {
        case " ":
        case "Enter":
          event.preventDefault(); // stop Space from page-scrolling the feed
          active.reveal();
          break;
        case "1":
          if (active.isRevealed()) {
            event.preventDefault();
            active.resolve(false);
          }
          break;
        case "2":
          if (active.isRevealed()) {
            event.preventDefault();
            active.resolve(true);
          }
          break;
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <div className="fixed inset-0 z-0 bg-background">
      <div
        className="pointer-events-none absolute inset-x-0 top-0 z-10 h-1 bg-foreground/10"
        style={{ marginTop: "env(safe-area-inset-top)" }}
      >
        <motion.div
          className="h-full w-full origin-left bg-accent"
          animate={{ scaleX: progress }}
          transition={{ type: "spring", stiffness: 200, damping: 30 }}
        />
      </div>

      {/* Escape hatch back to /ingest - the feed is otherwise a one-way trip
          to the completion slide. z-20 keeps it clickable above the progress
          bar. */}
      <button
        type="button"
        onClick={() => startTransition(() => router.push("/ingest"))}
        aria-label="Exit study session"
        className="absolute left-4 top-4 z-20 flex h-9 w-9 items-center justify-center rounded-full border border-border bg-foreground/5 text-foreground backdrop-blur-md transition-colors hover:bg-foreground/10 active:scale-95"
        style={{ marginTop: "env(safe-area-inset-top)" }}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          className="h-4 w-4"
          aria-hidden="true"
        >
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>

      <div className="h-dvh w-full snap-y snap-mandatory overflow-y-scroll no-scrollbar">
        {queue.map((item, index) => (
          <FeedSlide
            key={item.key}
            isNew={item.isNew}
            concept={item.concept}
            level={item.level}
            attempt={item.attempt}
            challengeRef={(handle) => {
              // Callback ref: register on mount, clean up on unmount so the
              // registry never points at a stale card. Non-Level-1 slides
              // never call this, so their index simply stays absent.
              if (handle) slideRefs.current.set(index, handle);
              else slideRefs.current.delete(index);
            }}
            onEnter={() => {
              currentIndexRef.current = index;
              // First entry only (markEntered enforces it): scrolling back to a
              // card the student already looked at must not restart its clock
              // and turn a long deliberation into a suspiciously fast answer.
              markEntered(enteredAt.current, item.key, Date.now());
            }}
            onResolve={(outcome, confidence) => resolve(item, outcome, Date.now(), confidence)}
          />
        ))}
        <CompletionSlide deckId={deckId} total={totalConcepts} mastered={masteredIds.size} />
      </div>

      {/* Mid-session Pro nudge — shown once after card 15 for free users. */}
      <AnimatePresence>
        {showMidNudge && (
          <motion.div
            key="mid-nudge"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            className="pointer-events-auto absolute left-4 right-4 top-16 z-30 rounded-2xl border border-accent/30 bg-black/90 px-4 py-3 text-left shadow-[0_8px_32px_-8px_hsl(var(--accent)/0.4)] backdrop-blur-md"
          >
            <p className="text-xs font-semibold uppercase tracking-widest text-accent">Pro</p>
            <p className="mt-1 text-sm font-medium text-white">
              15 concepts studied. Pro users never hit a wall.
            </p>
            <Link
              href="/pricing"
              className="mt-2 inline-block text-xs font-semibold text-accent hover:underline"
            >
              Unlock unlimited decks
            </Link>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Infinite Recall Mode - floating accent CTA + inline error. */}
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 z-30 flex flex-col items-center gap-2"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 1.5rem)" }}
      >
        <AnimatePresence>
          {shuffleSuccess !== null && (
            <motion.p
              key="success"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              className="pointer-events-auto mx-4 max-w-xs rounded-full border border-accent/40 bg-accent/10 px-5 py-2 text-center text-xs font-semibold text-accent backdrop-blur-md shadow-[0_0_20px_-4px_hsl(var(--accent)/0.5)]"
            >
              Swipe down — {shuffleSuccess} new cards await
            </motion.p>
          )}
        </AnimatePresence>
        <AnimatePresence>
          {shuffleError && (
            <motion.p
              key="error"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              className="pointer-events-auto mx-4 max-w-xs rounded-full border border-red-500/30 bg-red-500/10 px-4 py-2 text-center text-xs font-medium text-red-300 backdrop-blur-md"
            >
              {shuffleError}
            </motion.p>
          )}
        </AnimatePresence>

        <motion.button
          type="button"
          onClick={handleInfiniteRecall}
          disabled={shuffling}
          whileTap={{ scale: 0.96 }}
          className="pointer-events-auto inline-flex items-center gap-2 rounded-full border border-accent/40 bg-accent/10 px-5 py-2.5 text-sm font-semibold text-accent shadow-[0_0_24px_-6px_hsl(var(--accent)/0.6)] backdrop-blur-md transition-all duration-200 hover:bg-accent/20 hover:shadow-[0_0_32px_-4px_hsl(var(--accent)/0.8)] active:scale-[0.98] disabled:cursor-wait"
        >
          {shuffling ? (
            <>
              <GlowSpinner />
              Generating new angles…
            </>
          ) : shuffleSuccess !== null ? (
            `+${shuffleSuccess} cards added`
          ) : (
            "Infinite Recall Mode"
          )}
        </motion.button>
      </div>

      {/* Free-plan upsell - the growth hook. */}
      <AnimatePresence>
        {showUpsell && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-40 flex items-center justify-center p-6"
          >
            <button
              type="button"
              aria-label="Close"
              onClick={() => setShowUpsell(false)}
              className="absolute inset-0 bg-black/80"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              transition={{ type: "tween", duration: 0.15, ease: "easeOut" }}
              className="relative w-full max-w-md overflow-hidden rounded-3xl border border-border bg-surface p-7 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_30px_80px_-20px_rgba(0,0,0,0.8)]"
            >
              {/* Azure ambient glow */}
              <div className="pointer-events-none absolute -top-24 left-1/2 h-48 w-48 -translate-x-1/2 rounded-full bg-accent/20 blur-3xl" />
              <div className="relative">
                <span className="inline-flex items-center gap-2 rounded-full border border-accent/40 bg-accent/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-widest text-accent">
                  Pro · Infinite Recall
                </span>
                <h2 className="mt-5 text-2xl font-bold tracking-tight text-foreground">
                  Don&apos;t memorize the card. Master the concept.
                </h2>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                  Static flashcards trick your brain into recognizing words instead
                  of understanding concepts. Infinite Recall dynamically generates
                  high-yield questions from new angles—exposing your blind spots
                  so you never freeze on an exam again.
                </p>
                <Link
                  href="/pricing"
                  className="mt-6 inline-flex w-full items-center justify-center rounded-full bg-accent px-6 py-3.5 text-sm font-semibold text-accent-foreground ring-1 ring-inset ring-accent/30 shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_8px_28px_-6px_rgba(0,0,0,0.45)] transition-all duration-200 hover:bg-accent/90 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_12px_40px_-6px_rgba(0,0,0,0.55)] active:scale-[0.98]"
                >
                  Upgrade to Pro
                </Link>
                <button
                  type="button"
                  onClick={() => setShowUpsell(false)}
                  className="mt-3 block w-full text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                >
                  Maybe later
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
