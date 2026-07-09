"use client";

import { useRef, useState } from "react";
import { motion } from "motion/react";
import type { ChallengeLevel, ChallengeOutcome, Concept } from "@/lib/types";
import SwipeChallenge, { type SwipeChallengeHandle } from "./SwipeChallenge";
import FillBlankChallenge from "./FillBlankChallenge";
import ChatChallenge from "./ChatChallenge";
import type { Ref } from "react";

type FeedSlideProps = {
  concept: Concept;
  level: ChallengeLevel;
  attempt: number;
  /** True for cards freshly injected by Infinite Recall Mode — triggers the
   *  one-shot materialisation sweep on first viewport entry. */
  isNew?: boolean;
  onEnter: () => void;
  onResolve: (outcome: ChallengeOutcome) => void;
  challengeRef?: Ref<SwipeChallengeHandle>;
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

  function handleAnswered(correct: boolean) {
    onResolve(correct ? "correct" : "incorrect");
  }

  return (
    <motion.section
      onViewportEnter={handleEnter}
      onViewportLeave={() => onResolve("skipped")}
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
        <div className="relative mb-6 flex flex-wrap items-center justify-between gap-2 overflow-hidden rounded-xl text-xs font-medium text-zinc-400">

          {/* Full-width materialisation sweep — a blue light bar that travels
              left→right across the entire header the moment the card enters
              the viewport, signalling "this card was just generated for you". */}
          {swoopVisible && (
            <motion.div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 z-10"
              initial={{ x: "-110%" }}
              animate={{ x: "110%" }}
              transition={{ duration: 0.7, ease: [0.25, 0, 0.2, 1] }}
              style={{
                background:
                  "linear-gradient(90deg, transparent 0%, rgba(59,130,246,0.45) 50%, transparent 100%)",
              }}
            />
          )}

          <span className="flex items-center gap-2 uppercase tracking-widest text-zinc-400">
            {concept.concept}

            {/* Retry badge — only on re-queued items */}
            {attempt > 1 && (
              <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] normal-case tracking-normal text-zinc-400">
                Retry
              </span>
            )}
          </span>

          {/* "Generated" badge — shown persistently on Infinite Recall cards.
               Spring-pops in and glows azure to mark AI-generated content. */}
          {isNew && (
            <motion.span
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ type: "spring", stiffness: 380, damping: 18, delay: 0.05 }}
              className="rounded-full border border-accent/50 bg-accent/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-accent shadow-[0_0_12px_-2px_rgba(59,130,246,0.6)]"
            >
              Generated
            </motion.span>
          )}
        </div>

        {level === 1 && (
          <SwipeChallenge ref={challengeRef} concept={concept} onAnswered={handleAnswered} />
        )}
        {level === 2 && <FillBlankChallenge concept={concept} onAnswered={handleAnswered} />}
        {level === 3 && <ChatChallenge concept={concept} onAnswered={handleAnswered} />}

        <p className="mt-8 text-center text-sm text-zinc-500">
          Scroll down for the next concept ↓
        </p>
      </div>
    </motion.section>
  );
}

