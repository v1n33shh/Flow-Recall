"use client";

import { motion } from "motion/react";

// PERFORMANCE CONTRACT (low-end Android, 60fps):
// All animations touch ONLY `transform` (scale) and `opacity`.
// We never animate filter/box-shadow — those force a repaint every frame
// and destroy performance on cheap Android phones.

// Tier thresholds — same scale as StreakModal so the two components stay in sync.
type FlameTier = { from: string; via: string; to: string; core: string };

function getFlameTier(streak: number): FlameTier {
  if (streak >= 14)
    return { from: "#FFFFFF", via: "#E2E8F0", to: "#94A3B8", core: "#FFFFFF" }; // God Tier — silver/white
  if (streak >= 7)
    return { from: "#F43F5E", via: "#E11D48", to: "#BE123C", core: "#FFE4E6" }; // Ruby red
  if (streak >= 3)
    return { from: "#FBBF24", via: "#F59E0B", to: "#EA580C", core: "#FEF3C7" }; // Inferno — amber/orange
  return { from: "#93C5FD", via: "#3B82F6", to: "#2563EB", core: "#DBEAFE" };   // The Spark — electric azure
}

/** A tiny SVG flame whose gradient evolves with the streak tier.
 *  Only the static gradient colors change per tier — the breathing loop
 *  (scale only) is identical across all tiers, so switching tier costs zero frames. */
function TierFlame({ streak }: { streak: number }) {
  const tier = getFlameTier(streak);
  // Always pulse to make it feel alive, but pulse harder when on fire!
  const pulseScale = streak >= 3 ? 1.18 : 1.08;

  return (
    <motion.svg
      viewBox="0 0 24 24"
      className="h-4 w-4 shrink-0"
      // scale-only pulse: transform is GPU-compositable, no paint triggered.
      animate={{ scale: [1, pulseScale, 1] }}
      transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
      aria-hidden="true"
    >
      <defs>
        {/* Static gradient — colors swap instantly on tier change, never animate. */}
        <linearGradient id={`fg-${streak}`} x1="12" y1="2" x2="12" y2="22" gradientUnits="userSpaceOnUse">
          <stop offset="0"   stopColor={tier.from} />
          <stop offset="0.5" stopColor={tier.via} />
          <stop offset="1"   stopColor={tier.to} />
        </linearGradient>
      </defs>
      {/* Outer flame body */}
      <path
        d="M12 2c1.8 3.2 5 5.4 5 9.2a5 5 0 0 1-10 0c0-1.7.7-3.1 1.9-4.2-.1 1.4.7 2.4 1.9 2.4-1.3-2.9-.1-5.7 1.2-7.4z"
        fill={`url(#fg-${streak})`}
      />
      {/* Inner core — bright heart of the flame */}
      <path
        d="M12 21a2.9 2.9 0 0 0 2.9-2.9c0-1.5-1.1-2.5-1.8-3.6-.8 1.1-1.6 1.7-2.2 2.6-.4.6-.7 1-.7 1.6A2.8 2.8 0 0 0 12 21z"
        fill={tier.core}
      />
    </motion.svg>
  );
}

export default function StreakCounter({
  streak,
  onClick,
}: {
  streak: number;
  onClick?: () => void;
}) {
  const onFire = streak >= 3;

  return (
    <motion.div
      key="streak"
      initial={{ opacity: 0, scale: 0.6, y: -8 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 400, damping: 20 }}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      aria-label={onClick ? `${streak} day streak. View details.` : undefined}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      className={`flex items-center gap-1.5 rounded-full border bg-surface px-2 sm:px-3 py-1 text-sm font-semibold outline-none ${
        onFire ? "border-white/20 text-white" : "border-white/10 text-accent"
      } ${onClick ? "cursor-pointer select-none transition-transform hover:scale-105 active:scale-95 focus-visible:ring-2 focus-visible:ring-accent/60" : ""}`}
    >
      <TierFlame streak={streak} />
      <span className="tabular-nums">{streak}</span>
    </motion.div>
  );
}
