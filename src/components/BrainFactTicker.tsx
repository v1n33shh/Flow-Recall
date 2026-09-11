"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { factAt, nextCursor } from "@/lib/brainFacts";
import { getFactCursor, setFactCursor } from "@/lib/storage";

/** Something true to read while the model works.
 *
 * Generating a deck is the longest wait in this app by a wide margin. ContinuationProgress
 * says so in its own docblock - "a run can last twenty minutes and contain several
 * 62-second rate-limit waits" - and on the free tier ingestChunks sustains roughly one
 * request a minute against a 20-chunk cap. Until now the only thing on screen through all
 * of that was a button whose label counted parts, so the student sat watching a number
 * that moved once a minute.
 *
 * This is the one moment in the app where a student is captive and WANTS something to
 * read, which is exactly what BRAIN_FACTS is: short, checkable, unattributed claims about
 * memory. The fact set was grown from fourteen to twenty-four when this shipped, because
 * fourteen rotate in under three minutes and a long run would have visibly looped.
 *
 * It shares the one cursor with the library header and the home page, so the
 * "every fact before any repeat" property holds across the whole app rather than per
 * screen - and a twenty-minute generation leaves the student's next library visit
 * continuing where the wait left off instead of restarting.
 *
 * PERFORMANCE CONTRACT (StreakCounter/PageTransition): the crossfade is opacity and a 4px
 * transform, nothing else, and prefers-reduced-motion swaps the text with no animation at
 * all rather than animating faster.
 */

/** Long enough to read a sentence twice without it feeling like a slideshow. */
export const ROTATE_MS = 12_000;

export default function BrainFactTicker({ className = "" }: { className?: string }) {
  const reduceMotion = useReducedMotion();
  // Read once, at mount. Held out of state deliberately: this is where the walk starts,
  // and it must not change when the component re-renders for any other reason.
  const start = useMemo(() => getFactCursor(), []);
  const [steps, setSteps] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setSteps((n) => n + 1), ROTATE_MS);
    return () => clearInterval(id);
  }, []);

  // `factAt` is total over any integer, so adding an unbounded step count to the stored
  // start is safe and needs no wrapping of its own.
  const cursor = start + steps;

  // Leave the NEXT fact behind for whatever screen the student opens after this, so the
  // app-wide no-repeat walk continues instead of restarting from wherever it began here.
  useEffect(() => {
    setFactCursor(nextCursor(cursor));
  }, [cursor]);

  return (
    <div className={`min-h-[3.5rem] ${className}`}>
      <AnimatePresence mode="wait" initial={false}>
        <motion.p
          key={cursor}
          initial={reduceMotion ? false : { opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduceMotion ? { opacity: 1 } : { opacity: 0, y: -4 }}
          transition={{ duration: reduceMotion ? 0 : 0.45, ease: "easeOut" }}
          className="text-center text-sm leading-relaxed text-muted-foreground [text-wrap:balance]"
        >
          {factAt(cursor)}
        </motion.p>
      </AnimatePresence>
    </div>
  );
}
