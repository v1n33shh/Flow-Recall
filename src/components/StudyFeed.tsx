"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import type { ChallengeLevel, ChallengeOutcome, Concept, QueueItem, StudyProgress } from "@/lib/types";
import { getProgress, saveProgress } from "@/lib/storage";
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

  const totalConcepts = concepts.length;
  const progress = totalConcepts === 0 ? 0 : Math.min(masteredIds.size / totalConcepts, 1);

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
    <div className="fixed inset-0 z-0 bg-matte">
      <div
        className="pointer-events-none absolute inset-x-0 top-0 z-10 h-1 bg-white/10"
        style={{ marginTop: "env(safe-area-inset-top)" }}
      >
        <motion.div
          className="h-full bg-gold"
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
    </div>
  );
}
