"use client";

import { AnimatePresence, motion } from "motion/react";

const FIRE_THRESHOLD = 3;

export default function StreakCounter({ streak }: { streak: number }) {
  const onFire = streak >= FIRE_THRESHOLD;

  // A forest pill with butter text reads well on both surfaces it appears on:
  // the butter navbar (forest pops) and the forest study feed (the butter
  // border/text delineate it against the dark green).
  return (
    <AnimatePresence>
      {streak > 0 && (
        <motion.div
          key="streak"
          initial={{ opacity: 0, scale: 0.6, y: -8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.6 }}
          transition={{ type: "spring", stiffness: 400, damping: 20 }}
          className={`flex items-center gap-1 rounded-full border bg-graphite px-3 py-1 text-sm font-semibold text-gold ${
            onFire ? "border-white/20" : "border-white/10"
          }`}
        >
          {/* The infinite pulse lives on its own element, separate from the
              AnimatePresence-controlled wrapper above - a repeat: Infinity
              transition on the same element AnimatePresence needs to exit
              fights the exit animation and the element never cleanly
              disappears (opacity oscillates forever instead of settling). */}
          <motion.span
            animate={
              onFire
                ? {
                    scale: [1, 1.15, 1],
                    filter: [
                      "drop-shadow(0 0 2px rgba(212,175,55,0.4))",
                      "drop-shadow(0 0 10px rgba(212,175,55,0.95))",
                      "drop-shadow(0 0 2px rgba(212,175,55,0.4))",
                    ],
                  }
                : { scale: 1, filter: "drop-shadow(0 0 0px rgba(212,175,55,0))" }
            }
            transition={onFire ? { duration: 1.1, repeat: Infinity, ease: "easeInOut" } : { duration: 0.2 }}
          >
            🔥
          </motion.span>
          <span className="tabular-nums">{streak}</span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
