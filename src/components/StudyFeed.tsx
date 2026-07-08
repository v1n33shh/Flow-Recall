"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { useSession } from "next-auth/react";
import type { ChallengeLevel, ChallengeOutcome, Concept, QueueItem, StudyProgress } from "@/lib/types";
import { addConceptsToDeck, getProgress, saveProgress } from "@/lib/storage";
import FeedSlide from "./FeedSlide";
import type { SwipeChallengeHandle } from "./SwipeChallenge";
import CompletionSlide from "./CompletionSlide";
import StreakCounter from "./StreakCounter";

// How many slides ahead a failed/skipped concept gets requeued at an easier level.
const RETRY_OFFSET = 3;

/** Picks a challenge level from a weighted distribution rather than a fixed
 * cycle, so the feed feels like an unpredictable rollercoaster. Skewed toward
 * the quick Swipe to prevent fatigue: 50% Level 1, 30% Level 2, 20% Level 3. */
function getRandomLevel(): ChallengeLevel {
  const roll = Math.random();
  if (roll < 0.5) return 1;
  if (roll < 0.8) return 2;
  return 3;
}

function buildInitialQueue(concepts: Concept[]): QueueItem[] {
  // Shuffle so the deck isn't studied in chronological order, then hand each
  // concept a weighted-random level - no two sessions play out the same way.
  const shuffled = [...concepts].sort(() => Math.random() - 0.5);
  return shuffled.map((concept) => ({
    key: `${concept.id}::1`,
    concept,
    level: getRandomLevel(),
    attempt: 1,
  }));
}

function nextEasierLevel(level: ChallengeLevel): ChallengeLevel | null {
  if (level === 1) return null;
  return (level - 1) as ChallengeLevel;
}

/** A queue item counts as already-resolved if its concept is mastered, or a
 * later retry attempt for the same concept already exists in the queue -
 * either way it shouldn't be answerable again if the user scrolls back to
 * it after resuming. There's no separate persisted "resolved" list
 * (StudyProgress doesn't carry one), so this is reconstructed from
 * queue + masteredIds. The one gap: a Level-1 item that already failed
 * (with nowhere easier to retry to) looks identical to a never-attempted
 * one - worst case the student gets an extra redundant rep on something
 * they already struggled with, which is harmless. */
function reconstructResolvedKeys(progress: StudyProgress): Set<string> {
  const maxAttemptByConceptId = new Map<string, number>();
  for (const item of progress.queue) {
    const current = maxAttemptByConceptId.get(item.concept.id) ?? 0;
    if (item.attempt > current) maxAttemptByConceptId.set(item.concept.id, item.attempt);
  }

  const resolved = new Set<string>();
  for (const item of progress.queue) {
    const isMastered = progress.masteredIds.includes(item.concept.id);
    const isSuperseded = item.attempt < (maxAttemptByConceptId.get(item.concept.id) ?? item.attempt);
    if (isMastered || isSuperseded) resolved.add(item.key);
  }
  return resolved;
}

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
  const [streak, setStreak] = useState(() => savedProgress?.streak ?? 0);

  // A queue item can resolve twice (e.g. answered, then later scrolled past) -
  // this guards so only the first resolution counts. On resume, seed it from
  // the restored progress so already-answered cards can't be re-triggered.
  const resolvedKeys = useRef<Set<string>>(
    savedProgress ? reconstructResolvedKeys(savedProgress) : new Set(),
  );
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

  // --- Infinite Recall Mode (Pro) ---------------------------------------
  const { data: session } = useSession();
  const isPro = session?.user?.plan === "PRO";

  const [showUpsell, setShowUpsell] = useState(false);
  const [shuffling, setShuffling] = useState(false);
  const [shuffleError, setShuffleError] = useState<string | null>(null);
  const [shuffleSuccess, setShuffleSuccess] = useState<number | null>(null);

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
      const seen = new Map<string, Concept>();
      for (const item of queue) {
        if (!seen.has(item.concept.id)) seen.set(item.concept.id, item.concept);
      }
      const seed = Array.from(seen.values()).map((c) => ({
        concept: c.concept,
        question: c.question,
        answer: c.answer,
        explanation: c.explanation,
      }));

      const res = await fetch(`/api/decks/${deckId}/shuffle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ concepts: seed }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? "Couldn't generate new cards. Please try again.");
      }

      const newConcepts = (data.concepts as Concept[] | undefined) ?? [];
      if (newConcepts.length === 0) {
        throw new Error("No new cards came back. Please try again.");
      }

      // Seamlessly append to the live feed (before the completion slide) so the
      // user just keeps swiping, and grow the denominator so progress stays honest.
      setQueue((prev) => [
        ...prev,
        ...newConcepts.map((concept) => ({
          key: `${concept.id}::1`,
          concept,
          level: getRandomLevel(),
          attempt: 1,
        })),
      ]);
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

  function resolve(item: QueueItem, outcome: ChallengeOutcome) {
    if (resolvedKeys.current.has(item.key)) return;
    resolvedKeys.current.add(item.key);

    if (outcome === "correct") {
      setStreak((s) => s + 1);
      setMasteredIds((prev) => new Set(prev).add(item.concept.id));
      return;
    }

    // Skipping counts the same as answering wrong here - the user didn't
    // demonstrate recall either way, and D.I.E.'s retry logic already
    // treats them identically below.
    setStreak(0);

    const easierLevel = nextEasierLevel(item.level);
    if (easierLevel === null) return;

    setQueue((prev) => {
      const idx = prev.findIndex((q) => q.key === item.key);
      if (idx === -1) return prev;

      const insertAt = Math.min(Math.max(idx + RETRY_OFFSET, currentIndexRef.current + 1), prev.length);
      const nextAttempt = item.attempt + 1;
      const retryItem: QueueItem = {
        key: `${item.concept.id}::${nextAttempt}`,
        concept: item.concept,
        level: easierLevel,
        attempt: nextAttempt,
      };

      const next = [...prev];
      next.splice(insertAt, 0, retryItem);
      return next;
    });
  }

  // Auto-save on every change so closing the tab mid-session never loses
  // progress - resuming later restores the exact queue, streak, and mastery.
  useEffect(() => {
    saveProgress(deckId, {
      deckId,
      streak,
      masteredIds: Array.from(masteredIds),
      queue,
    });
  }, [deckId, streak, masteredIds, queue]);

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
        className="pointer-events-none absolute inset-x-0 top-0 z-10 h-1 bg-white/10"
        style={{ marginTop: "env(safe-area-inset-top)" }}
      >
        <motion.div
          className="h-full bg-accent"
          animate={{ width: `${progress * 100}%` }}
          transition={{ type: "spring", stiffness: 200, damping: 30 }}
        />
      </div>

      {/* Escape hatch back to /ingest - the feed is otherwise a one-way trip
          to the completion slide. z-20 keeps it clickable above the progress
          bar; sits top-left, clear of the top-right streak flame. */}
      <button
        type="button"
        onClick={() => router.push("/ingest")}
        aria-label="Exit study session"
        className="absolute left-4 top-4 z-20 flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-white/5 text-zinc-300 backdrop-blur-md transition-colors hover:bg-white/10 active:scale-95"
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

      <div
        className="pointer-events-none absolute right-4 top-4 z-10"
        style={{ marginTop: "env(safe-area-inset-top)" }}
      >
        <StreakCounter streak={streak} />
      </div>

      <div className="h-dvh w-full snap-y snap-mandatory overflow-y-scroll no-scrollbar">
        {queue.map((item, index) => (
          <FeedSlide
            key={item.key}
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
            }}
            onResolve={(outcome) => resolve(item, outcome)}
          />
        ))}
        <CompletionSlide total={totalConcepts} />
      </div>

      {/* Infinite Recall Mode - floating Electric-Azure CTA + inline error. */}
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
              className="pointer-events-auto mx-4 max-w-xs rounded-full border border-emerald-500/40 bg-emerald-500/10 px-5 py-2 text-center text-xs font-semibold text-emerald-300 backdrop-blur-md shadow-[0_0_20px_-4px_rgba(16,185,129,0.4)]"
            >
              {shuffleSuccess} new cards added to your session
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
          className="pointer-events-auto inline-flex items-center gap-2 rounded-full border border-accent/40 bg-accent/10 px-5 py-2.5 text-sm font-semibold text-accent shadow-[0_0_24px_-6px_rgba(59,130,246,0.7)] backdrop-blur-md transition-all duration-200 hover:bg-accent/20 hover:shadow-[0_0_32px_-4px_rgba(59,130,246,0.9)] active:scale-[0.98] disabled:cursor-wait"
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
              className="relative w-full max-w-md overflow-hidden rounded-3xl border border-white/10 bg-surface p-7 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_30px_80px_-20px_rgba(0,0,0,0.8)]"
            >
              {/* Azure ambient glow */}
              <div className="pointer-events-none absolute -top-24 left-1/2 h-48 w-48 -translate-x-1/2 rounded-full bg-accent/20 blur-3xl" />
              <div className="relative">
                <span className="inline-flex items-center gap-2 rounded-full border border-accent/40 bg-accent/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-widest text-accent">
                  Pro · Infinite Recall
                </span>
                <h2 className="mt-5 text-2xl font-bold tracking-tight text-white">
                  Don&apos;t memorize the card. Master the concept.
                </h2>
                <p className="mt-3 text-sm leading-relaxed text-zinc-400">
                  Static flashcards trick your brain into recognizing words instead
                  of understanding concepts. Infinite Recall dynamically generates
                  high-yield questions from new angles—exposing your blind spots
                  so you never freeze on an exam again.
                </p>
                <Link
                  href="/pricing"
                  className="mt-6 inline-flex w-full items-center justify-center rounded-full bg-gradient-to-b from-blue-500 to-blue-600 px-6 py-3.5 text-sm font-semibold text-white ring-1 ring-inset ring-blue-400/40 shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_8px_28px_-6px_rgba(37,99,235,0.55)] transition-all duration-200 hover:from-blue-400 hover:to-blue-500 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_12px_40px_-6px_rgba(59,130,246,0.75)] active:scale-[0.98]"
                >
                  Upgrade to Pro
                </Link>
                <button
                  type="button"
                  onClick={() => setShowUpsell(false)}
                  className="mt-3 block w-full text-xs font-medium text-zinc-500 transition-colors hover:text-zinc-300"
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
