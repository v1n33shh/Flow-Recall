"use client";

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
  onEnter: () => void;
  onResolve: (outcome: ChallengeOutcome) => void;
  /** Wired up from StudyFeed's ref registry to the Level-1 swipe card's
   * imperative handle, so the feed's global keyboard listener can drive the
   * active card directly. Only Level-1 slides attach it - typing-based levels
   * (fill-in-the-blank, chat) never register a handle, which is exactly why
   * the shortcuts stay dormant while the user is typing an answer. */
  challengeRef?: Ref<SwipeChallengeHandle>;
};

export default function FeedSlide({
  concept,
  level,
  attempt,
  onEnter,
  onResolve,
  challengeRef,
}: FeedSlideProps) {
  function handleAnswered(correct: boolean) {
    onResolve(correct ? "correct" : "incorrect");
  }

  return (
    <motion.section
      onViewportEnter={onEnter}
      onViewportLeave={() => onResolve("skipped")}
      viewport={{ amount: 0.6 }}
      className="flex h-dvh w-full shrink-0 snap-start snap-always items-center justify-center px-5 sm:px-6"
      style={{
        paddingTop: "env(safe-area-inset-top)",
        paddingBottom: "env(safe-area-inset-bottom)",
      }}
    >
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-2 text-xs font-medium text-zinc-400">
          <span className="flex items-center gap-2 uppercase tracking-widest text-gold">
            {concept.concept}
            {attempt > 1 && (
              <span className="rounded-full bg-gold/15 px-2 py-0.5 text-[10px] normal-case tracking-normal text-gold">
                Retry
              </span>
            )}
          </span>
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
