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
  const { summary, expected, total, horizonDays: days, anchoredToExam } = overview;

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
      className="w-full max-w-sm text-center"
    >
      <p
        id="memory-heading"
        className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground"
      >
        {anchoredToExam
          ? `On exam day (${days} ${days === 1 ? "day" : "days"})`
          : `In ${days} ${days === 1 ? "day" : "days"}`}
      </p>

      {/* The best number this app has, finally at the size it deserves. It was 30px,
          fourth from the top, under a marketing headline - while the readiness dashboards
          this borrows from put their one figure at roughly 72pt as the first thing on
          screen, readable at arm's length. */}
      <p className="mt-3 font-sans text-6xl font-semibold leading-none tracking-tight tabular-nums text-foreground sm:text-7xl">
        {Math.round(expected)}
      </p>
      <p className="mt-2 text-sm text-muted-foreground">
        of {total} concepts you&apos;ll still recall
      </p>
      {/* Says what the number IS, and it is not a forecast of a student who keeps
          studying - it is what happens if they stop. Getting this caption wrong
          would make an honest projection into a quiet promise. */}
      <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
        If you don&apos;t review between now and then. Studying moves it up.
      </p>
      {/* What the number is made of, pointed at what to do about it. The counts below say
          six are fading; without this they are trivia, and with it they are the reason the
          session underneath exists. */}
      {summary.fading > 0 && (
        <p className="mt-1 text-[11px] font-medium leading-relaxed text-foreground/80">
          {summary.fading} {summary.fading === 1 ? "is" : "are"} fading — that is what
          tonight is for.
        </p>
      )}

      {rows.length > 0 && (
        <dl className="mt-5 flex flex-wrap items-baseline justify-center gap-x-5 gap-y-2 border-t border-border pt-4">
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
