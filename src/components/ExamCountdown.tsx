"use client";

import { useEffect, useState } from "react";
import type { Deck } from "@/lib/types";
import { daysUntilExam, soonestExamDate } from "@/lib/recallModel";

/** How long until the paper.
 *
 * Every primitive for this has existed since exam dates shipped, and nothing has ever
 * printed it. `soonestExamDate` and `daysUntilExam` are consumed in exactly one place -
 * MemoryOverview, to choose between "On exam day (9 days)" and "In 7 days" as the caption
 * on a projection - so the number is computed and then folded into a label about
 * something else.
 *
 * It is also the only meaningful number on this screen that needs NO account and NO review
 * history: `useSavedDecks` is localStorage, and a deck carries its own `examDate`. So this
 * is the one line that can appear for a student on their first evening with the app, and
 * it is the line most likely to make them sit down.
 *
 * WHY THE CLOCK IS READ IN AN EFFECT. `daysUntilExam` reads `Date.now()`, and a component
 * may not do that while rendering - the server and the client would disagree and React
 * would report a hydration mismatch. `soonestExamDate` is deliberately clock-free for this
 * exact reason (see its docblock); the clock half happens here, after mount.
 */
export default function ExamCountdown({ decks }: { decks: readonly Deck[] }) {
  const examDate = soonestExamDate(decks);
  const [days, setDays] = useState<number | null>(null);

  useEffect(() => {
    // setState inside an effect is what `react-hooks/set-state-in-effect` forbids when it
    // happens synchronously in the effect body. Deferring by a microtask is the same
    // workaround useIsNative uses, and for the same reason.
    let live = true;
    void Promise.resolve().then(() => {
      if (live) setDays(daysUntilExam(examDate ?? undefined));
    });
    return () => {
      live = false;
    };
  }, [examDate]);

  // No exam set, the clock has not been read yet, or the paper is behind them. A past
  // exam is silence rather than a negative number: the student knows how it went.
  if (days === null || days < 0) return null;

  return (
    <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
      {days === 0
        ? "Your paper is today"
        : `${days} ${days === 1 ? "day" : "days"} until your paper`}
    </p>
  );
}
