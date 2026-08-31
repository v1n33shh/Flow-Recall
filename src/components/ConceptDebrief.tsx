"use client";

import { useState } from "react";
import { motion } from "motion/react";
import type { Concept } from "@/lib/types";
import { vibrateTap } from "@/lib/haptics";

/** What the student is told once a card is resolved, shared by every challenge
 * format so no two of them can disagree about it.
 *
 * The asymmetry is the whole point. `explanation` is the richest thing the
 * generator produces - the ingest prompt calls it "the most important field" and
 * demands a full 3-4 sentence paragraph - and until now it sat behind a
 * `Read Deep Dive` tap that was IDENTICAL whether the student had just aced the
 * card or just discovered they did not know it. The moment of maximum readiness
 * to learn was treated exactly like the moment of minimum need, and the tap was
 * reinforced only by `hover:underline`, which does not exist on the phone this
 * app ships to. So:
 *
 *   - Got it wrong: the explanation is already open. No tap, nothing to discover.
 *   - Got it right: still opt-in, because nobody wants a lecture after a success -
 *     but behind a real bordered control rather than a hover-styled text link.
 *
 * Deliberately renders BELOW the card at full width. The swipe used to show its
 * paragraph inside the flipped back face, an h-56 box with `no-scrollbar`, i.e. a
 * ~224px scroll region with no affordance saying it scrolled. */
export default function ConceptDebrief({
  concept,
  correct,
  note,
}: {
  concept: Concept;
  correct: boolean;
  /** An extra line the format needs to add - cloze uses it to say the auto-check
   * was unavailable and the student's own grading stood. */
  note?: string;
}) {
  // Starts open on a failure, which is the behaviour this component exists for.
  const [showExplanation, setShowExplanation] = useState(!correct);

  return (
    <div className="mt-6 w-full">
      {/* --- Verdict. The one place --success/--danger are in scope (see the
          token comment in globals.css: answer-correctness feedback in the study
          feed, and nothing else). --- */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className={`rounded-2xl border px-4 py-3 text-center text-sm ${
          correct ? "border-success/30 bg-success/10" : "border-danger/30 bg-danger/10"
        }`}
      >
        <p className={`font-medium ${correct ? "text-success" : "text-danger"}`}>
          {correct ? "Correct!" : "Not quite"}
        </p>
        <p className="mt-1 text-foreground">
          {concept.question} &rarr; {concept.answer}
        </p>
        {note && <p className="mt-2 text-xs text-muted-foreground">{note}</p>}
      </motion.div>

      {/* --- The explanation. Open already on a failure; a real control on a
          success. The left rule stays --accent rather than --danger even after a
          wrong answer: this block is the material, not a verdict on it. --- */}
      {concept.explanation && (
        <>
          {!showExplanation && (
            <div className="mt-3 flex justify-center">
              <button
                type="button"
                onClick={() => {
                  vibrateTap();
                  setShowExplanation(true);
                }}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-foreground/5 px-4 py-2 text-xs font-medium text-foreground transition-all duration-200 hover:bg-foreground/10 active:scale-[0.98]"
              >
                Read the deep dive
                <span aria-hidden="true">&darr;</span>
              </button>
            </div>
          )}

          {showExplanation && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ type: "spring", stiffness: 280, damping: 24 }}
              className="mt-3 rounded-r-xl border-l-4 border-l-accent bg-foreground/5 p-4 text-left"
            >
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                {correct ? "Deep dive" : "Why"}
              </p>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {concept.explanation}
              </p>
            </motion.div>
          )}
        </>
      )}
    </div>
  );
}
