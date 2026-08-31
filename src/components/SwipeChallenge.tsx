"use client";

import { useImperativeHandle, useRef, useState, type Ref } from "react";
import { motion, useMotionValue, useTransform, useAnimationControls, animate } from "motion/react";
import type { Concept } from "@/lib/types";
import type { Confidence } from "@/lib/recallModel";
import { vibrateCorrect, vibrateIncorrect } from "@/lib/haptics";
import ConceptDebrief from "./ConceptDebrief";

/** Imperative surface a Level-1 swipe card exposes to the study feed's global
 * keyboard listener - Anki-style "reveal, then self-grade". Only Level-1 cards
 * expose this; Level-2's typing-based ClozeChallenge intentionally leaves the
 * keyboard alone. */
export type SwipeChallengeHandle = {
  /** True once the answer is showing (Space/Enter), or after any grade. */
  isRevealed: () => boolean;
  /** True once graded - further shortcuts are ignored. */
  isResolved: () => boolean;
  /** Show the answer without grading it - the "flip the card" step. */
  reveal: () => void;
  /** Grade the card: `true` = Correct, `false` = Incorrect/Skip. */
  resolve: (correct: boolean) => void;
  /** Announce a wrong answer that is still waiting on its confidence tap.
   *
   * A failure does not reach the parent until the student says whether they
   * guessed, so a student who scrolls away mid-question would otherwise have a
   * real wrong answer degrade into an uncredited skip - the feed treats leaving
   * the viewport as a skip, and a skip is deliberately not allowed to decay a
   * memory. The slide calls this before falling back to that skip, so the answer
   * lands as the incorrect answer it was, with confidence simply absent. */
  flushPending: () => void;
};

type SwipeChallengeProps = {
  concept: Concept;
  onAnswered: (correct: boolean, confidence?: Confidence) => void;
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

  const x = useMotionValue(0);
  const rotate = useTransform(x, [-200, 200], [-12, 12]);
  // The two edge labels that make the gesture discoverable. `cursor-grab` used
  // to be the ONLY hint this card was draggable, and nothing anywhere said which
  // direction meant what - the mapping existed solely inside onDragEnd's ±100px
  // check. On a phone, which is the only platform this ships to, that made the
  // app's signature interaction invisible: a student could find the ✕/✓ buttons
  // and nothing else. Each label brightens as the card is dragged its way, so the
  // gesture teaches itself on the first attempt.
  const falseHint = useTransform(x, [-100, 0], [1, 0.4]);
  const trueHint = useTransform(x, [0, 100], [0.4, 1]);
  // Drives a shake/bounce on a wrapper around the draggable card, kept
  // separate from the card's own drag-bound `x`/`rotate` motion values so
  // the two animations don't fight over the same style props.
  const cardControls = useAnimationControls();

  const resolved = outcome !== null;

  // A wrong answer is held back until the student answers the confidence
  // question - see the Confidence docblock in recallModel.ts for why the answer
  // to a failed two-option swipe is genuinely ambiguous without it. Correct
  // answers announce immediately; nothing is asked of a student who was right.
  const [awaitingConfidence, setAwaitingConfidence] = useState(false);
  const [confidenceGiven, setConfidenceGiven] = useState<Confidence | null>(null);
  // A ref, not state: flushPending can be called from the slide's viewport-leave
  // handler in the same tick as a tap, and only one of the two may announce.
  const announcedRef = useRef(false);

  function announce(correct: boolean, confidence?: Confidence) {
    if (announcedRef.current) return;
    announcedRef.current = true;
    setAwaitingConfidence(false);
    if (confidence) setConfidenceGiven(confidence);
    onAnswered(correct, confidence);
  }

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
      announce(true);
    } else {
      vibrateIncorrect();
      cardControls.start({ x: [0, -10, 10, -10, 10, 0], transition: { duration: 0.4, ease: "easeInOut" } });
      // Held, not announced. The card still flips and shakes right now, so the
      // feedback is immediate either way - only the write waits.
      setAwaitingConfidence(true);
    }
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
    flushPending: () => {
      if (awaitingConfidence) announce(false);
    },
  }));

  return (
    <div className="w-full">
      <p className="mb-4 text-center text-sm text-muted-foreground">{concept.question}</p>

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
            {/* Front face: the claim to judge. bg-surface flips with the theme,
                so its text must too - text-zinc-300 (near-white) used to go
                invisible on the near-white light-mode surface. */}
            <div className="absolute inset-0 flex items-center justify-center rounded-3xl border border-border bg-surface p-8 text-center [backface-visibility:hidden]">
              {!resolved && (
                <>
                  <motion.span
                    style={{ opacity: falseHint }}
                    className="absolute left-4 top-4 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground"
                  >
                    &larr; False
                  </motion.span>
                  <motion.span
                    style={{ opacity: trueHint }}
                    className="absolute right-4 top-4 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground"
                  >
                    True &rarr;
                  </motion.span>
                </>
              )}
              <p className="text-xl font-medium text-foreground">{claim}</p>
            </div>

            {/* Back face: the real answer. Pre-rotated 180° so it reads upright
                once the card has flipped. Deliberately a fixed-dark card in both
                themes (like the Account avatar) - its light text stays hardcoded
                on purpose, not a theming bug. The deep dive used to live in here
                too, read through a ~224px `no-scrollbar` box; it is ConceptDebrief's
                job now, below the card at full width. */}
            <div className="absolute inset-0 flex flex-col items-center justify-center rounded-3xl border border-white/10 bg-gradient-to-br from-zinc-900 to-[#0A0A0A] p-6 text-center [transform:rotateY(180deg)] [backface-visibility:hidden]">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400">
                Answer
              </p>
              <p className="mt-1 text-lg font-medium text-zinc-100">{concept.answer}</p>
            </div>
          </motion.div>
        </div>
      </motion.div>

      {resolved ? (
        // `outcome === true` rather than `outcome`: `resolved` is derived from a
        // null check, which TypeScript cannot use to narrow `boolean | null` here.
        <ConceptDebrief
          concept={concept}
          correct={outcome === true}
          // Only while the question can still be recorded, plus after it has been
          // answered so the acknowledgement stays on screen. Once flushPending
          // has announced without it, the question disappears rather than
          // pretending a tap would still count for something.
          onConfidence={
            awaitingConfidence || confidenceGiven !== null
              ? (confidence) => announce(false, confidence)
              : undefined
          }
        />
      ) : revealed ? (
        // Keyboard "reveal" state: the card has flipped to show the answer,
        // now awaiting a 1 / 2 self-grade.
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-6 rounded-2xl border border-border bg-surface px-4 py-4 text-center"
        >
          <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
            How did you do?
          </p>
          <div className="mt-4 flex justify-center gap-3">
            <button
              type="button"
              onClick={() => grade(false)}
              className="flex items-center gap-2 rounded-full border border-border px-4 py-2 text-sm font-medium text-foreground transition-transform hover:scale-105 active:scale-95"
            >
              <kbd className="rounded bg-foreground/10 px-1.5 py-0.5 text-xs text-muted-foreground">1</kbd>
              Incorrect
            </button>
            <button
              type="button"
              onClick={() => grade(true)}
              className="flex items-center gap-2 rounded-full bg-accent ring-1 ring-inset ring-accent/30 shadow-[inset_0_1px_0_rgba(255,255,255,0.15),0_8px_24px_-6px_rgba(0,0,0,0.4)] px-4 py-2 text-sm font-medium text-accent-foreground transition-transform hover:scale-105 active:scale-95"
            >
              <kbd className="rounded bg-background/20 px-1.5 py-0.5 text-xs text-accent-foreground">2</kbd>
              Correct
            </button>
          </div>
        </motion.div>
      ) : (
        <div className="mt-6 flex flex-col items-center gap-3">
          <div className="flex justify-center gap-4">
            <button
              type="button"
              onClick={() => decide(false)}
              aria-label="Mark as false"
              className="flex h-14 w-14 items-center justify-center rounded-full border border-border text-2xl text-foreground transition-transform hover:scale-105 active:scale-95"
            >
              ✕
            </button>
            <button
              type="button"
              onClick={() => decide(true)}
              aria-label="Mark as true"
              className="flex h-14 w-14 items-center justify-center rounded-full border border-border text-2xl text-foreground transition-transform hover:scale-105 active:scale-95"
            >
              ✓
            </button>
          </div>
          {/* States the gesture in words, since the card's own affordance was
              `cursor-grab` - which does not exist on touch. */}
          <p className="text-[11px] text-muted-foreground">Swipe the card, or tap</p>
        </div>
      )}
    </div>
  );
}
