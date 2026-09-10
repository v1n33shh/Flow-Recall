"use client";

import { useEffect } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { vibrateTap } from "@/lib/haptics";

/** The safety net that lets deleting a deck be a single tap.
 *
 * Two other places in this repo already refuse `window.confirm` - ConceptEditor
 * ("a WebView dialog is jarring and can be suppressed outright") and the reader's
 * SelectionBar ("on Android renders a system dialog titled with the app's own
 * localhost origin") - and both replaced it with a two-tap confirm. This goes one
 * further, because deletion here is genuinely reversible and a confirm is not free:
 * it taxes the ninety-nine deliberate deletions to catch the one mistake.
 *
 * What makes that safe rather than reckless is the data model. `deleteDeck` writes a
 * TOMBSTONE rather than dropping the row, precisely so a deletion can propagate, and
 * `restoreDeck` puts the deck and its session back with a newer `updatedAt` - so an
 * undo out-stamps the tombstone even if a sync has already carried it to another
 * device. See both in src/lib/storage.ts.
 *
 * Renders nothing at all when there is nothing to undo. Everything it animates is
 * transform or opacity, per the performance contract StreakCounter and PageTransition
 * are written to. */

/** How long the offer stands. Long enough to notice the bar, read it and reach it
 * one-handed; short enough that it is gone before it becomes furniture. */
export const UNDO_WINDOW_MS = 6000;

export type PendingDelete = {
  /** The deleted deck's id - also what re-keys the bar (and its timer) when a second
   * deletion lands while the first is still offered. */
  id: string;
  title: string;
};

export default function DeckUndoBar({
  pending,
  onUndo,
  onExpire,
}: {
  pending: PendingDelete | null;
  onUndo: () => void;
  /** The window closed with no undo. The caller drops the snapshot it was holding;
   * the deletion, which already happened, simply stands. */
  onExpire: () => void;
}) {
  const reduceMotion = useReducedMotion();
  const pendingId = pending?.id ?? null;

  useEffect(() => {
    if (pendingId === null) return;
    const timer = window.setTimeout(onExpire, UNDO_WINDOW_MS);
    return () => window.clearTimeout(timer);
    // Keyed on the id, not the object: a re-render that rebuilds the same pending
    // deletion must not restart a countdown that is already half spent.
  }, [pendingId, onExpire]);

  return (
    <AnimatePresence>
      {pending && (
        <motion.div
          key={pending.id}
          initial={reduceMotion ? false : { opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 16 }}
          transition={{ type: "spring", stiffness: 420, damping: 32 }}
          className="pointer-events-none fixed inset-x-0 z-50 flex justify-center px-3"
          // Clears MobileTabBar, whose real rendered height (its own safe-area
          // padding included) it publishes as --tabbar-h on <html>. That variable
          // collapses to 0 at sm:, where the bar is hidden and this can sit at the
          // bottom of the window instead.
          style={{ bottom: "calc(var(--tabbar-h, 0px) + 1.25rem)" }}
        >
          <div
            role="status"
            aria-live="polite"
            className="pointer-events-auto relative flex w-full max-w-[420px] items-center gap-3 overflow-hidden rounded-2xl border border-border bg-surface/95 px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_16px_40px_-12px_rgba(0,0,0,0.85)] md:backdrop-blur-xl"
          >
            <p className="min-w-0 flex-1 text-sm text-foreground">
              <span className="block truncate font-medium">{pending.title}</span>
              <span className="text-xs text-muted-foreground">Deck deleted</span>
            </p>
            <button
              type="button"
              onClick={() => {
                vibrateTap();
                onUndo();
              }}
              className="shrink-0 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground ring-1 ring-inset ring-accent/30 transition-transform duration-200 active:scale-[0.97]"
            >
              Undo
            </button>

            {/* The window, draining. scaleX from a left origin, so it is one
                composited transform per frame rather than a width animation that
                would relayout the bar sixty times a second. */}
            {!reduceMotion && (
              <motion.span
                aria-hidden="true"
                className="absolute inset-x-0 bottom-0 h-0.5 origin-left bg-accent/40"
                initial={{ scaleX: 1 }}
                animate={{ scaleX: 0 }}
                transition={{ duration: UNDO_WINDOW_MS / 1000, ease: "linear" }}
              />
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
