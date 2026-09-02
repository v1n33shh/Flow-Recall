"use client";

import { motion, useReducedMotion } from "motion/react";
import { useSession } from "next-auth/react";
import type { Deck } from "@/lib/types";
import { soonestExamDate } from "@/lib/recallModel";
import { useMemoryOverview } from "@/lib/recallStorage";

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

export default function MemoryOverview({ decks }: { decks: readonly Deck[] }) {
  const { data: session } = useSession();
  const userId = session?.user?.id;
  const reduceMotion = useReducedMotion();

  // Resolved without reading the clock - a component may not - so "is that exam still
  // ahead" is decided inside the hook, where it can be.
  const { overview, loading } = useMemoryOverview(userId, soonestExamDate(decks));
  // Both the horizon and its label come from the read rather than from `Date.now()`
  // here, so the caption can never name a different day than the number was computed
  // for.
  const { summary, expected, total, horizonDays: days, anchoredToExam } = overview;

  // `met` is a unit with no credited success, so this is "has anything actually
  // been answered" rather than "does a library exist".
  const studied = summary.units - summary.met;
  if (!userId || loading || total === 0 || studied === 0) return null;

  const rows = [
    { key: "solid", label: "Solid", value: summary.solid },
    { key: "holding", label: "Holding", value: summary.holding },
    { key: "fading", label: "Slipping", value: summary.fading },
  ].filter((row) => row.value > 0);

  return (
    <motion.section
      initial={reduceMotion ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 280, damping: 26 }}
      aria-labelledby="memory-heading"
      className="mt-6 w-full max-w-4xl rounded-2xl border border-border bg-surface/60 p-5 text-left shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] md:backdrop-blur-xl"
    >
      <p
        id="memory-heading"
        className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground"
      >
        {anchoredToExam
          ? `On exam day (${days} ${days === 1 ? "day" : "days"})`
          : `In ${days} ${days === 1 ? "day" : "days"}`}
      </p>

      <p className="mt-1.5 text-3xl font-bold tracking-tight tabular-nums text-foreground">
        {Math.round(expected)}{" "}
        <span className="text-xl font-semibold text-muted-foreground">of {total}</span>
      </p>
      <p className="mt-0.5 text-sm text-muted-foreground">
        concepts you&apos;ll still recall
      </p>
      {/* Says what the number IS, and it is not a forecast of a student who keeps
          studying - it is what happens if they stop. Getting this caption wrong
          would make an honest projection into a quiet promise. */}
      <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
        If you don&apos;t review between now and then. Studying moves it up.
      </p>

      {rows.length > 0 && (
        <dl className="mt-4 flex flex-wrap items-baseline gap-x-5 gap-y-2 border-t border-border pt-3">
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
