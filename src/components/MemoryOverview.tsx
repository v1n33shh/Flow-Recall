"use client";

import { motion, useReducedMotion } from "motion/react";
import type { MemoryOverview } from "@/lib/recallStorage";
import { MASTERY_LABEL } from "@/lib/masteryCopy";

/** What you will still know later - the number no other flashcard app can print.
 *
 * Anki knows when a card is next DUE, and a due date carries no probability, so
 * there is nothing in it to project forward. FSRS state is a decay curve per
 * concept, and a curve can be evaluated at any future date - which is what turns
 * "you have 40 cards due" into "you will recall 61 of 94 a week from now".
 *
 * This is also the reason to open the app when you are NOT studying, which the home
 * screen has never had. Everything here is derived from data already on the device:
 * no AI call, no network, no new model.
 *
 * Renders nothing at all until the engine has something to project from. Signed out
 * it records nothing; with a library nobody has answered yet, "0 of 94" is
 * arithmetically true and reads as an accusation, so the block waits. */

export default function MemoryOverview({
  overview,
  show,
}: {
  overview: MemoryOverview;
  /** `hasProjection` from useHomeProjection. The decision lives there rather than here so
   * this panel and HomeHeroNumber cannot both render, or both decline to. */
  show: boolean;
}) {
  const reduceMotion = useReducedMotion();
  // Both the horizon and its label come from the read rather than from `Date.now()`
  // here, so the caption can never name a different day than the number was computed
  // for.
  const { summary, expected, studied, horizonDays: days, anchoredToExam } = overview;

  if (!show) return null;

  const rows = [
    { key: "solid", label: MASTERY_LABEL.solid, value: summary.solid },
    { key: "holding", label: MASTERY_LABEL.holding, value: summary.holding },
    // Was "Slipping" here and "Fading" on every other screen - the same state under two
    // names, which a student had no way to connect. See masteryCopy.ts.
    { key: "fading", label: MASTERY_LABEL.fading, value: summary.fading },
  ].filter((row) => row.value > 0);

  return (
    <motion.section
      initial={reduceMotion ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 280, damping: 26 }}
      aria-labelledby="memory-heading"
      // No card chrome and centred, because this is now the FIRST thing on the native home
      // rather than a tile partway down it. A border around the hero number would frame
      // the one figure the screen exists to show as though it were a widget.
      className="w-full max-w-xl text-left"
    >
      {/* DEMOTED, on purpose. This was the 72pt hero for two rebuilds and it is better as
          a sentence: the statement above already says what tonight is, and a second
          competing number was half of why the screen read as a readout.

          The denominator is `studied`, not `total`, and that is a correctness fix rather
          than a design one. projectedRecall only sums units it has a memory for, but this
          used to divide against every concept in the library - so a student with 351
          concepts who had answered 20 read "5 of 351", their recall measured against 330
          concepts they had never been shown. That is not a prediction. */}
      <p
        id="memory-heading"
        className="text-sm leading-relaxed text-muted-foreground"
      >
        Of the{" "}
        <span className="font-medium tabular-nums text-foreground">{studied}</span> you have
        studied, you will still hold{" "}
        <span className="font-medium tabular-nums text-foreground">{Math.round(expected)}</span>{" "}
        {anchoredToExam
          ? `on exam day, ${days} ${days === 1 ? "day" : "days"} from now`
          : `in ${days} ${days === 1 ? "day" : "days"}`}
        {" — "}
        {/* Says what the number IS: not a forecast of a student who keeps studying, but
            what happens if they stop. Without it an honest projection reads as a promise. */}
        if you review nothing between now and then.
      </p>

      {rows.length > 0 && (
        <dl className="mt-4 flex flex-wrap items-baseline gap-x-5 gap-y-2">
          {rows.map((row) => (
            <div key={row.key} className="flex items-baseline gap-1.5">
              <dt className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                {row.label}
              </dt>
              <dd className="text-sm font-semibold tabular-nums text-foreground">{row.value}</dd>
            </div>
          ))}
          {/* The claim that separates this engine from a due-date queue: some of
              what you know needs nothing from you tonight. */}
          {summary.resting > 0 && (
            <p className="basis-full text-[11px] text-muted-foreground">
              {summary.resting} of those {summary.resting === 1 ? "needs" : "need"} nothing from
              you right now.
            </p>
          )}
        </dl>
      )}
    </motion.section>
  );
}
