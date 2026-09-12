"use client";

import { useEffect, useMemo } from "react";
import { factAt, nextCursor } from "@/lib/brainFacts";
import { getFactCursor, setFactCursor } from "@/lib/storage";
import { EYEBROW, GLASS_PANEL, TEXT_BODY } from "@/lib/spatial";

/** The home screen's opening line: one true thing about memory, different every visit.
 *
 * ---------------------------------------------------------------------------
 * THE CONTENT IS REAL, AND THAT IS A DELIBERATE CONSTRAINT RATHER THAN A LIMITATION
 * ---------------------------------------------------------------------------
 * These are the twenty-four lines in src/lib/brainFacts.ts, which this repo already
 * maintains under a rule stated in that file: every claim is checkable, and NOT ONE of them
 * is attributed to anybody, because "a misattributed quotation is worse than no quotation".
 * Two of them carry numbers and both were checked against sources (NCBI Basic
 * Neurochemistry for the 2%/20%/20W figures; Cowan's limit for "about four") rather than
 * recalled.
 *
 * The brief that commissioned this widget illustrated it with a different shape of line -
 * a named citation plus a precise percentage. That shape is not used here, on purpose:
 * writing a statistic and a date into a sentence is the single easiest way to put a
 * fabricated fact in front of a student, and this app's whole subject is memory research.
 * The existing set says the same things without borrowing anyone's authority to do it.
 *
 * ---------------------------------------------------------------------------
 * HOW IT ROTATES
 * ---------------------------------------------------------------------------
 * Per visit, not on a timer. The cursor advances by one on mount and is stored, so a
 * student meets all twenty-four before meeting any of them twice - `nextCursor` walks
 * rather than randomising precisely so the same line never lands two opens in a row.
 *
 * A timer was the other option and it is the wrong one twice over: text that changes while
 * someone is reading it is a bug wearing a feature's clothes, and an interval ticking on
 * the home screen is exactly the kind of idle JS this shell has spent two revisions
 * removing.
 *
 * THE CURSOR IS SHARED with the marketing page's own fact line (src/app/page.tsx). That is
 * intentional and already documented there: a student who opens both surfaces meets two
 * different facts. Only one of the two ever renders at a time - page.tsx branches on
 * `useIsNative` - so they cannot double-advance it in a single paint.
 *
 * READ IN useMemo, ADVANCED IN useEffect. Not held in state: nothing re-renders because of
 * it, and `react-hooks/set-state-in-effect` is an error in this repo. Same shape as
 * BrainFactSection, which the same rule pushed there first.
 */
export default function DailyInsight() {
  // Read once, advance for next time.
  const cursor = useMemo(() => getFactCursor(), []);
  useEffect(() => {
    setFactCursor(nextCursor(cursor));
  }, [cursor]);

  return (
    <section aria-label="Daily insight" className={`rounded-[24px] p-5 ${GLASS_PANEL}`}>
      {/* Monospaced, bracketed, machine-ish - the same eyebrow the landing page's ticker
          carries, so the two surfaces are legibly one product. */}
      <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-white/40">
        [ SYS.FACT ]
      </p>
      {/* min-h holds two lines of this size so the widget does not change height as the
          line changes between opens - the longest fact in the set wraps to three lines at
          360dp and the shortest to one, and a home screen whose first element resizes on
          every launch reads as unstable. 3.75rem is two lines of 14px at leading-relaxed
          plus the margin; a three-line fact grows past it, which is the right direction to
          be wrong in. */}
      <p className={`mt-2.5 min-h-[3.75rem] text-sm leading-relaxed ${TEXT_BODY}`}>
        {factAt(cursor)}
      </p>
    </section>
  );
}
