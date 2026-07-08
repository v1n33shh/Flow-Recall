"use client";

import { useState } from "react";
import { motion, useAnimationControls } from "motion/react";
import type { Concept } from "@/lib/types";
import { vibrateCorrect, vibrateIncorrect } from "@/lib/haptics";

type FillBlankChallengeProps = {
  concept: Concept;
  onAnswered: (correct: boolean) => void;
};

export default function FillBlankChallenge({ concept, onAnswered }: FillBlankChallengeProps) {
  const [value, setValue] = useState("");
  const [submitted, setSubmitted] = useState(false);
  // Deep-dive is opt-in so the flipped card stays uncluttered until asked.
  const [showExplanation, setShowExplanation] = useState(false);
  const controls = useAnimationControls();

  const hasBlank = concept.cloze.includes("_____");
  const [before, after] = hasBlank ? concept.cloze.split("_____") : [concept.cloze + " ", ""];

  const isCorrect = value.trim().toLowerCase() === concept.answer.trim().toLowerCase();

  // The card flips to the graded back face the moment the user checks.
  const flipped = submitted;

  function handleSubmit() {
    if (submitted || value.trim().length === 0) return;
    setSubmitted(true);
    onAnswered(isCorrect);

    if (isCorrect) {
      vibrateCorrect();
      controls.start({ scale: [1, 1.08, 1], transition: { duration: 0.35, ease: "easeOut" } });
    } else {
      vibrateIncorrect();
      controls.start({ x: [0, -10, 10, -10, 10, 0], transition: { duration: 0.4, ease: "easeInOut" } });
    }
  }

  return (
    <div className="w-full">
      {/* controls handles the scale-bounce / shake feedback on the whole card. */}
      <motion.div animate={controls}>
        {/* Stable perspective viewport - its own non-animated element so the
            vanishing point never drifts during the shake. */}
        <div className="[perspective:1000px]">
          {/* Flipping element: preserve-3d holds both faces in 3D space, and it
              turns 180° on the Y-axis once the answer is checked. */}
          <motion.div
            style={{ transformStyle: "preserve-3d" }}
            animate={{ rotateY: flipped ? 180 : 0 }}
            transition={{ type: "spring", stiffness: 260, damping: 26 }}
            className="relative w-full"
          >
            {/* FRONT: the cloze sentence with the fillable blank. */}
            <div
              className={`flex flex-col rounded-3xl border border-white/10 bg-surface p-6 [backface-visibility:hidden] ${
                flipped ? "invisible" : ""
              }`}
            >
              <div className="flex flex-1 items-center justify-center py-2">
                <p className="text-center text-base leading-relaxed text-zinc-300">
                  {before}
                  <input
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
                    disabled={submitted}
                    placeholder="..."
                    autoCapitalize="off"
                    className="mx-1 w-36 border-b-2 border-white/20 bg-transparent px-2 py-1 text-center font-semibold text-zinc-300 outline-none focus:border-accent sm:w-40"
                  />
                  {after}
                </p>
              </div>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={value.trim().length === 0}
                className="mx-auto mt-4 min-h-11 w-full max-w-xs rounded-full border border-white/10 bg-gradient-to-b from-blue-500 to-blue-600 ring-1 ring-inset ring-blue-400/40 shadow-[inset_0_1px_0_rgba(255,255,255,0.15),0_8px_24px_-6px_rgba(37,99,235,0.55)] px-6 py-2.5 text-sm font-medium text-white transition-all duration-200 hover:from-blue-400 hover:to-blue-500 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
              >
                Check
              </button>
            </div>

            {/* BACK: verdict + the completed sentence. Pre-rotated 180° so it
                reads upright once the card has flipped. */}
            <div
              className="absolute inset-0 flex flex-col rounded-3xl border border-white/10 bg-gradient-to-br from-zinc-900 to-[#0A0A0A] p-6 text-center [transform:rotateY(180deg)] [backface-visibility:hidden]"
              style={{ minHeight: "100%" }}
            >
              <div
                className={`shrink-0 rounded-2xl border px-4 py-3 text-sm font-semibold ${
                  isCorrect
                    ? "border-emerald-500/30 bg-emerald-950/40 text-emerald-400"
                    : "border-rose-500/30 bg-rose-950/40 text-rose-400"
                }`}
              >
                {isCorrect ? "Nailed it!" : "Not quite"}
              </div>
              <div className="mt-4 flex min-h-0 flex-1 flex-col overflow-y-auto no-scrollbar">
                <p className="text-base leading-relaxed text-zinc-200 shrink-0 mb-4 text-center">
                  {before}
                  <span className="font-semibold text-white">{concept.answer}</span>
                  {after}
                </p>
                {concept.explanation && !showExplanation && (
                  <button
                    type="button"
                    onClick={() => setShowExplanation(true)}
                    className="mt-4 text-xs font-medium text-accent hover:underline"
                  >
                    Read Deep Dive ↓
                  </button>
                )}
                {concept.explanation && showExplanation && (
                  <div className="mt-1 rounded-r-xl border-l-4 border-l-accent bg-white/5 p-4 text-sm text-left leading-relaxed text-zinc-300 shrink-0">
                    {concept.explanation}
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        </div>
      </motion.div>
    </div>
  );
}
