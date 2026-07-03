"use client";

import { useState } from "react";
import { motion, useAnimationControls } from "motion/react";
import type { Concept } from "@/lib/types";
import { vibrateCorrect, vibrateIncorrect } from "@/lib/haptics";
import { fireSmallBurst } from "@/lib/confetti";

type Grade = { correct: boolean; feedback: string };

type ChatChallengeProps = {
  concept: Concept;
  onAnswered: (correct: boolean) => void;
};

export default function ChatChallenge({ concept, onAnswered }: ChatChallengeProps) {
  const controls = useAnimationControls();

  const [answer, setAnswer] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [grade, setGrade] = useState<Grade | null>(null);

  // Once the grade is in, the card flips to reveal the verdict + master answer.
  const flipped = grade !== null;

  async function handleSubmit() {
    if (answer.trim().length === 0 || loading) return;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/grade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: concept.question,
          correctAnswer: concept.answer,
          userAnswer: answer,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error ?? "Grading failed.");
      }

      setGrade(data);
      onAnswered(data.correct);

      if (data.correct) {
        vibrateCorrect();
        controls.start({ scale: [1, 1.06, 1], transition: { duration: 0.35, ease: "easeOut" } });
        fireSmallBurst();
      } else {
        vibrateIncorrect();
        controls.start({ x: [0, -10, 10, -10, 10, 0], transition: { duration: 0.4, ease: "easeInOut" } });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Grading failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="w-full">
      {/* controls handles the scale-bounce / shake feedback on the whole card. */}
      <motion.div animate={controls}>
        {/* Stable perspective viewport - its own non-animated element so the
            vanishing point never drifts during the shake. */}
        <div className="[perspective:1000px]">
          {/* Flipping element: preserve-3d holds both faces in 3D space, and
              it turns 180° on the Y-axis the moment a grade returns. */}
          <motion.div
            style={{ transformStyle: "preserve-3d" }}
            animate={{ rotateY: flipped ? 180 : 0 }}
            transition={{ type: "spring", stiffness: 260, damping: 26 }}
            className="relative h-80 w-full"
          >
            {/* FRONT: the Feynman prompt - explain it in your own words. */}
            <div className="absolute inset-0 flex flex-col rounded-3xl border border-white/10 bg-graphite p-5 text-left [backface-visibility:hidden]">
              <p className="mb-4 text-lg font-medium leading-snug text-zinc-200">
                {concept.question}
              </p>
              <textarea
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                disabled={flipped || loading}
                placeholder="Explain this concept in full - as if you were teaching it to a friend. Don't just define it; unpack why it works."
                rows={4}
                className="min-h-0 w-full flex-1 resize-none rounded-2xl border border-white/10 bg-matte/40 p-3 text-sm leading-relaxed text-zinc-200 placeholder-zinc-600 outline-none focus:border-gold/40 disabled:opacity-60"
              />
              <button
                type="button"
                onClick={handleSubmit}
                disabled={loading || answer.trim().length === 0}
                className="mt-3 min-h-11 w-full rounded-full border border-white/10 bg-gold px-6 py-2.5 text-sm font-medium text-matte transition-colors hover:bg-gold/90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
              >
                {loading ? "Grading..." : "Submit Explanation"}
              </button>
            </div>

            {/* BACK: color-coded verdict + the master explanation. Pre-rotated
                180° so it reads upright once the card has flipped. */}
            <div className="absolute inset-0 flex flex-col rounded-3xl border border-white/10 bg-gradient-to-br from-zinc-900 to-[#0A0A0A] p-5 text-left [transform:rotateY(180deg)] [backface-visibility:hidden]">
              {/* Verdict: dark-glass panel, only the title carries the color;
                  the body stays crisp and readable rather than tinted. */}
              <div
                className={`rounded-2xl border px-4 py-3 ${
                  grade?.correct
                    ? "border-emerald-500/30 bg-emerald-950/40"
                    : "border-rose-500/30 bg-rose-950/40"
                }`}
              >
                <p
                  className={`text-sm font-semibold ${
                    grade?.correct ? "text-emerald-400" : "text-rose-400"
                  }`}
                >
                  {grade?.correct ? "Mastered!" : "Missing key details"}
                </p>
                <p className="mt-1 text-sm leading-relaxed text-zinc-200">{grade?.feedback}</p>
              </div>

              <div className="mt-4 min-h-0 flex-1 overflow-y-auto no-scrollbar">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-gold">
                  Master Explanation
                </p>
                {/* Deep-dive paragraph, falling back to the short answer for
                    decks generated before `explanation` existed. */}
                <div className="mt-1.5 rounded-r-xl border-l-4 border-l-gold bg-white/5 p-4 text-sm leading-relaxed text-zinc-300">
                  {concept.explanation || concept.answer}
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </motion.div>

      {error && <p className="mt-3 text-center text-sm text-rose-400">{error}</p>}
    </div>
  );
}
