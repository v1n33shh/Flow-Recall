"use client";

import { useRef, useState } from "react";
import { motion } from "motion/react";
import type { ChallengeLevel, ChallengeOutcome, Concept } from "@/lib/types";
import type { Confidence } from "@/lib/recallModel";
import SwipeChallenge, { type SwipeChallengeHandle } from "./SwipeChallenge";
import ClozeChallenge from "./ClozeChallenge";

type FeedSlideProps = {
  concept: Concept;
  level: ChallengeLevel;
  attempt: number;
  /** True for cards freshly injected by Infinite Recall Mode — triggers the
   *  one-shot materialisation sweep on first viewport entry. */
  isNew?: boolean;
  onEnter: () => void;
  onResolve: (outcome: ChallengeOutcome, confidence?: Confidence) => void;
  /** A callback ref, not a `Ref` - see attachSwipe. */
  challengeRef?: (handle: SwipeChallengeHandle | null) => void;
};

export default function FeedSlide({
  concept,
  level,
  attempt,
  isNew,
  onEnter,
  onResolve,
  challengeRef,
}: FeedSlideProps) {
  // Fire the materialisation sweep exactly once — on first viewport entry.
  // Using a ref (not state) avoids a re-render on toggle; the sweep is a
  // self-contained motion animation that plays and stays in its end state.
  const hasSwooped = useRef(false);
  const [swoopVisible, setSwoopVisible] = useState(false);
  const swipeHandle = useRef<SwipeChallengeHandle | null>(null);

  function handleEnter() {
    onEnter();
    if (isNew && !hasSwooped.current) {
      hasSwooped.current = true;
      setSwoopVisible(true);
      // Hide the sweep element after animation completes so it can't
      // accidentally re-trigger if the component re-renders.
      setTimeout(() => setSwoopVisible(false), 900);
    }
  }

  function handleAnswered(correct: boolean, confidence?: Confidence) {
    onResolve(correct ? "correct" : "incorrect", confidence);
  }

  // Leaving the viewport is the feed's skip signal. A wrong swipe waiting on its
  // confidence tap has not announced yet, so flush it first: without this, a real
  // wrong answer would degrade into a skip, and a skip is deliberately never
  // credited against a memory. The feed's resolvedKeys guard makes the trailing
  // "skipped" a no-op whenever the flush announced.
  function handleLeave() {
    swipeHandle.current?.flushPending();
    onResolve("skipped");
  }

  // The swipe's handle has two consumers: this slide, for the flush above, and
  // the feed's index-keyed registry for desktop keyboard shortcuts. Declared as a
  // callback ref rather than a React.Ref so both can be served - writing through
  // to a `Ref`'s own `.current` is a prop mutation, which is exactly what
  // react-hooks/immutability exists to stop.
  function attachSwipe(handle: SwipeChallengeHandle | null) {
    swipeHandle.current = handle;
    challengeRef?.(handle);
  }

  return (
    <motion.section
      onViewportEnter={handleEnter}
      onViewportLeave={handleLeave}
      viewport={{ amount: 0.6 }}
      className="flex h-dvh w-full shrink-0 snap-start snap-always items-center justify-center px-5 sm:px-6"
      style={{
        paddingTop: "env(safe-area-inset-top)",
        paddingBottom: "env(safe-area-inset-bottom)",
      }}
    >
      <div className="w-full max-w-md">
        {/* Card header — concept label + badges */}
        {/* The overflow-hidden + relative here contains the full-width sweep. */}
        <div className="relative mb-6 flex flex-wrap items-center justify-between gap-2 overflow-hidden rounded-xl text-xs font-medium text-muted-foreground">

          {/* Full-width materialisation sweep — an accent-colored light bar
              that travels left→right across the entire header the moment
              the card enters the viewport, signalling "this card was just
              generated for you". */}
          {swoopVisible && (
            <motion.div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 z-10"
              initial={{ x: "-110%" }}
              animate={{ x: "110%" }}
              transition={{ duration: 0.7, ease: [0.25, 0, 0.2, 1] }}
              style={{
                background:
                  "linear-gradient(90deg, transparent 0%, hsl(var(--accent) / 0.45) 50%, transparent 100%)",
              }}
            />
          )}

          <span className="flex items-center gap-2 uppercase tracking-widest text-muted-foreground">
            {concept.concept}

            {/* Retry badge — only on re-queued items */}
            {attempt > 1 && (
              <span className="rounded-full bg-foreground/10 px-2 py-0.5 text-[10px] normal-case tracking-normal text-muted-foreground">
                Retry
              </span>
            )}
          </span>

          {/* "Generated" badge — shown persistently on Infinite Recall cards.
               Spring-pops in and glows to mark AI-generated content. */}
          {isNew && (
            <motion.span
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ type: "spring", stiffness: 380, damping: 18, delay: 0.05 }}
              className="rounded-full border border-accent/50 bg-accent/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-accent shadow-[0_0_12px_-2px_hsl(var(--accent)/0.6)]"
            >
              Generated
            </motion.span>
          )}
        </div>

        {level === 2 ? (
          <ClozeChallenge concept={concept} onAnswered={handleAnswered} />
        ) : (
          <SwipeChallenge ref={attachSwipe} concept={concept} onAnswered={handleAnswered} />
        )}

        <p className="mt-8 text-center text-sm text-muted-foreground">
          Scroll down for the next concept ↓
        </p>
      </div>
    </motion.section>
  );
}

