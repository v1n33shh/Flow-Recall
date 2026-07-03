"use client";

import { useImperativeHandle, useState, type Ref } from "react";
import { motion, useMotionValue, useTransform, useAnimationControls, animate } from "motion/react";
import type { Concept } from "@/lib/types";
import { vibrateCorrect, vibrateIncorrect } from "@/lib/haptics";

/** Imperative surface a Level-1 swipe card exposes to the study feed's global
 * keyboard listener - Anki-style "reveal, then self-grade". Only Level-1 cards
 * expose this; typing-based levels intentionally leave the keyboard alone. */
export type SwipeChallengeHandle = {
  /** True once the answer is showing (Space/Enter), or after any grade. */
  isRevealed: () => boolean;
  /** True once graded - further shortcuts are ignored. */
  isResolved: () => boolean;
  /** Show the answer without grading it - the "flip the card" step. */
  reveal: () => void;
  /** Grade the card: `true` = Correct, `false` = Incorrect/Skip. */
  resolve: (correct: boolean) => void;
};

type SwipeChallengeProps = {
  concept: Concept;
  onAnswered: (correct: boolean) => void;
  ref?: Ref<SwipeChallengeHandle>;
};

export default function SwipeChallenge({ concept, onAnswered, ref }: SwipeChallengeProps) {
  const [showTrue] = useState(() => Math.random() < 0.5);
  const claim = showTrue ? concept.answer : concept.distractor;
  // Answer visible but not yet graded - the middle "revealed" state that only
  // the keyboard flow can enter (a swipe reveals + grades in one motion). This
  // one flag also drives the 3D flip, so the card turns whether the user
  // swiped, tapped ✓/✕, or hit Space.
  const [revealed, setRevealed] = useState(false);
  // Final graded result, and the single source of truth for "locked".
  const [outcome, setOutcome] = useState<boolean | null>(null);
  // Deep-dive is opt-in so the flipped card stays uncluttered until asked.
  const [showExplanation, setShowExplanation] = useState(false);

  const x = useMotionValue(0);
  const rotate = useTransform(x, [-200, 200], [-12, 12]);
  // Drives a shake/bounce on a wrapper around the draggable card, kept
  // separate from the card's own drag-bound `x`/`rotate` motion values so
  // the two animations don't fight over the same style props.
  const cardControls = useAnimationControls();

  const resolved = outcome !== null;

  // Snap the card back to center - shared by reveal and grade so a mid-drag
  // keyboard action doesn't leave the card stranded off-axis (and so the flip
  // happens dead-center rather than out at a swipe offset).
  function recenter() {
    animate(x, 0, { type: "spring", stiffness: 300, damping: 30 });
  }

  // The one grading path for every input - swipe, tap, or keyboard. The
  // `resolved` guard makes feedback, haptics, and the parent callback fire
  // exactly once no matter how many times it's called.
  function grade(correct: boolean) {
    if (resolved) return;
    setOutcome(correct);
    setRevealed(true);
    recenter();

    if (correct) {
      vibrateCorrect();
      cardControls.start({ scale: [1, 1.12, 1], transition: { duration: 0.35, ease: "easeOut" } });
    } else {
      vibrateIncorrect();
      cardControls.start({ x: [0, -10, 10, -10, 10, 0], transition: { duration: 0.4, ease: "easeInOut" } });
    }

    onAnswered(correct);
  }

  // Swipe/tap path: the user asserts the claim is true/false, graded against
  // the (randomly) shown claim.
  function decide(userSaysTrue: boolean) {
    if (resolved) return;
    grade(userSaysTrue === showTrue);
  }

  // Recreated every render (no deps) so it always reads the latest state -
  // no stale `revealed`/`resolved` when the feed's listener calls in.
  useImperativeHandle(ref, () => ({
    isRevealed: () => revealed,
    isResolved: () => resolved,
    reveal: () => {
      if (resolved) return;
      setRevealed(true);
      recenter();
    },
    resolve: (correct: boolean) => grade(correct),
  }));

  return (
    <div className="w-full">
      <p className="mb-4 text-center text-sm text-zinc-400">{concept.question}</p>

      {/* cardControls handles the scale-bounce / shake feedback. */}
      <motion.div animate={cardControls}>
        {/* Stable perspective viewport for the 3D flip - kept as its own,
            non-animated element so the vanishing point never drifts. */}
        <div className="[perspective:1000px]">
          {/* The draggable card IS the flipping element: it keeps the
              Tinder-style drag physics (translateX + tilt via `x`/`rotate`)
              AND flips 180° on the Y-axis once `revealed`. preserve-3d keeps
              the two faces in 3D space so backface-visibility can hide
              whichever one is facing away. */}
          <motion.div
            drag={revealed ? false : "x"}
            style={{ x, rotate, transformStyle: "preserve-3d" }}
            animate={{ rotateY: revealed ? 180 : 0 }}
            transition={{ type: "spring", stiffness: 260, damping: 26 }}
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={0.85}
            onDragEnd={(_, info) => {
              if (info.offset.x > 100) decide(true);
              else if (info.offset.x < -100) decide(false);
            }}
            className={`relative h-56 w-full ${
              revealed ? "" : "cursor-grab active:cursor-grabbing"
            }`}
          >
            {/* Front face: the claim to judge. */}
            <div className="absolute inset-0 flex items-center justify-center rounded-3xl border border-white/10 bg-graphite p-8 text-center [backface-visibility:hidden]">
              <p className="text-xl font-medium text-zinc-300">{claim}</p>
            </div>

            {/* Back face: the real answer. Pre-rotated 180° so it reads
                upright once the card has flipped. */}
            <div className="absolute inset-0 flex flex-col rounded-3xl border border-white/10 bg-gradient-to-br from-zinc-900 to-[#0A0A0A] p-6 text-center [transform:rotateY(180deg)] [backface-visibility:hidden] overflow-y-auto no-scrollbar">
              <div className="flex flex-col items-center justify-center shrink-0 mb-3">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-gold">
                  Answer
                </p>
                <p className="text-xl font-medium text-zinc-100 mt-1">{concept.answer}</p>
              </div>
              {concept.explanation && !showExplanation && (
                <button
                  type="button"
                  onClick={() => setShowExplanation(true)}
                  className="mt-4 text-xs font-medium text-gold hover:underline"
                >
                  Read Deep Dive ↓
                </button>
              )}
              {concept.explanation && showExplanation && (
                <div className="mt-2 rounded-r-xl border-l-4 border-l-gold bg-white/5 p-4 text-sm text-left leading-relaxed text-zinc-300 shrink-0">
                  {concept.explanation}
                </div>
              )}
            </div>
          </motion.div>
        </div>
      </motion.div>

      {resolved ? (
        // Color-coded verdict: green for correct, red for incorrect.
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className={`mt-6 rounded-2xl border px-4 py-3 text-center text-sm ${
            outcome ? "border-emerald-500/30 bg-emerald-950/40" : "border-rose-500/30 bg-rose-950/40"
          }`}
        >
          <p className={`font-medium ${outcome ? "text-emerald-400" : "text-rose-400"}`}>
            {outcome ? "Correct!" : "Not quite"}
          </p>
          <p className="mt-1 text-zinc-200">
            {concept.question} &rarr; {concept.answer}
          </p>
        </motion.div>
      ) : revealed ? (
        // Keyboard "reveal" state: the card has flipped to show the answer,
        // now awaiting a 1 / 2 self-grade.
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-6 rounded-2xl border border-white/10 bg-graphite px-4 py-4 text-center"
        >
          <p className="text-xs font-medium uppercase tracking-widest text-zinc-500">
            How did you do?
          </p>
          <div className="mt-4 flex justify-center gap-3">
            <button
              type="button"
              onClick={() => grade(false)}
              className="flex items-center gap-2 rounded-full border border-white/15 px-4 py-2 text-sm font-medium text-zinc-300 transition-transform hover:scale-105 active:scale-95"
            >
              <kbd className="rounded bg-white/10 px-1.5 py-0.5 text-xs text-zinc-400">1</kbd>
              Incorrect
            </button>
            <button
              type="button"
              onClick={() => grade(true)}
              className="flex items-center gap-2 rounded-full bg-gold px-4 py-2 text-sm font-medium text-matte transition-transform hover:scale-105 active:scale-95"
            >
              <kbd className="rounded bg-matte/20 px-1.5 py-0.5 text-xs text-matte">2</kbd>
              Correct
            </button>
          </div>
        </motion.div>
      ) : (
        <div className="mt-6 flex justify-center gap-4">
          <button
            type="button"
            onClick={() => decide(false)}
            aria-label="Mark as false"
            className="flex h-14 w-14 items-center justify-center rounded-full border border-white/15 text-2xl text-zinc-300 transition-transform hover:scale-105 active:scale-95"
          >
            ✕
          </button>
          <button
            type="button"
            onClick={() => decide(true)}
            aria-label="Mark as true"
            className="flex h-14 w-14 items-center justify-center rounded-full border border-white/15 text-2xl text-zinc-300 transition-transform hover:scale-105 active:scale-95"
          >
            ✓
          </button>
        </div>
      )}
    </div>
  );
}
