"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import type { StreakDay, StreakResponse } from "@/app/api/streak/route";

// PERFORMANCE CONTRACT (low-end Android, 60fps):
// Every animation in this file touches ONLY `transform` (scale/y) and `opacity`
// - both GPU-compositable and off the layout/paint path. We never animate
// width/height/box-shadow/filter, which would thrash layout on cheap phones.
// The flame's "glow" is a statically-blurred layer whose OPACITY pulses (cheap),
// not an animated box-shadow/filter (expensive).

const WEEKDAY_LABELS = ["M", "T", "W", "T", "F", "S", "S"] as const;

// Rendered before the fetch resolves so the week row never pops in empty.
const PLACEHOLDER_DAYS: StreakDay[] = WEEKDAY_LABELS.map((label, i) => ({
  label,
  date: `placeholder-${i}`,
  studied: false,
  isToday: false,
  future: false,
}));

type FlameTier = {
  id: string;
  /** Gamified name shown as the subtitle. */
  label: string;
  /** Gradient stops, top -> bottom. */
  from: string;
  via: string;
  to: string;
  /** Inner-core fill - the bright heart of the flame. */
  core: string;
  /** Blur-glow color behind the flame - the tier's vivid mid tone. */
  glow: string;
};

// Escalating rewards: the flame evolves as the streak grows. Each palette is
// chosen to stay vivid and luxurious against PURE BLACK - saturated mid tones,
// bright cores, no muddy in-betweens. Only static fill/stop colors change per
// tier; the breathing animation (transform + opacity) is byte-for-byte
// identical across tiers, so switching tiers never costs a frame.
function getFlameTier(streak: number): FlameTier {
  if (streak >= 14) {
    // God Tier - iridescent white / silver
    return { id: "god", label: "God Tier", from: "#FFFFFF", via: "#E2E8F0", to: "#94A3B8", core: "#FFFFFF", glow: "#F1F5F9" };
  }
  if (streak >= 7) {
    // Inferno - blazing amber -> orange
    return { id: "inferno", label: "Inferno", from: "#FBBF24", via: "#F59E0B", to: "#EA580C", core: "#FEF3C7", glow: "#FB923C" };
  }
  if (streak >= 3) {
    // Heating Up - vibrant amethyst
    return { id: "amethyst", label: "Heating Up", from: "#C084FC", via: "#9333EA", to: "#7E22CE", core: "#F3E8FF", glow: "#A855F7" };
  }
  // The Spark - Electric Azure (default)
  return { id: "spark", label: "The Spark", from: "#93C5FD", via: "#3B82F6", to: "#2563EB", core: "#DBEAFE", glow: "#3B82F6" };
}

/** Premium custom flame that evolves with the streak. Breathing = a tiny scale
 * loop on the mark plus an opacity loop on a pre-blurred glow layer. Transform
 * + opacity only - the tier only swaps static colors, never animates layout. */
function BreathingFlame({ streak }: { streak: number }) {
  const tier = getFlameTier(streak);
  return (
    <div className="relative flex h-24 w-24 items-center justify-center">
      {/* Glow layer - blur is static; only opacity animates. Color tracks tier. */}
      <motion.div
        aria-hidden="true"
        className="absolute h-20 w-20 rounded-full blur-2xl"
        style={{ backgroundColor: tier.glow }}
        animate={{ opacity: [0.35, 0.7, 0.35] }}
        transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.svg
        viewBox="0 0 24 24"
        className="relative h-20 w-20"
        animate={{ scale: [1, 1.06, 1] }}
        transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
        aria-hidden="true"
      >
        <defs>
          {/* Keyed by tier id so React swaps the whole gradient node on a tier
              change rather than diffing stops in place. */}
          <linearGradient key={tier.id} id="flameGrad" x1="12" y1="2" x2="12" y2="22" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor={tier.from} />
            <stop offset="0.5" stopColor={tier.via} />
            <stop offset="1" stopColor={tier.to} />
          </linearGradient>
        </defs>
        {/* Outer flame body */}
        <path
          d="M12 2c1.8 3.2 5 5.4 5 9.2a5 5 0 0 1-10 0c0-1.7.7-3.1 1.9-4.2-.1 1.4.7 2.4 1.9 2.4-1.3-2.9-.1-5.7 1.2-7.4z"
          fill="url(#flameGrad)"
        />
        {/* Inner core - brighter, gives the flame depth */}
        <path
          d="M12 21a2.9 2.9 0 0 0 2.9-2.9c0-1.5-1.1-2.5-1.8-3.6-.8 1.1-1.6 1.7-2.2 2.6-.4.6-.7 1-.7 1.6A2.8 2.8 0 0 0 12 21z"
          fill={tier.core}
        />
      </motion.svg>
    </div>
  );
}

/** One day cell in the weekly row. Studied = filled Azure square with a check
 * and a STATIC glow (static box-shadow is fine; we just never animate it). */
function DayCell({ day, index }: { day: StreakDay; index: number }) {
  return (
    <motion.div
      className="flex flex-col items-center gap-2"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.12 + index * 0.04, type: "spring", stiffness: 380, damping: 26 }}
    >
      <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
        {day.label}
      </span>
      <div
        className={
          day.studied
            ? "flex h-8 w-8 sm:h-9 sm:w-9 items-center justify-center rounded-lg bg-accent text-white shadow-[0_0_16px_-2px_rgba(59,130,246,0.8)]"
            : `flex h-8 w-8 sm:h-9 sm:w-9 items-center justify-center rounded-lg border ${
                day.isToday ? "border-accent/60" : "border-white/12"
              } ${day.future ? "opacity-40" : ""}`
        }
      >
        {day.studied ? (
          <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden="true">
            <path
              d="M5 12.5l4 4 10-10"
              stroke="currentColor"
              strokeWidth={2.6}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : (
          day.isToday && <span className="h-1.5 w-1.5 rounded-full bg-accent" />
        )}
      </div>
    </motion.div>
  );
}

export default function StreakModal({
  open,
  onClose,
  fallbackStreak,
}: {
  open: boolean;
  onClose: () => void;
  /** The navbar's (possibly-stale) streak, shown instantly until the fresh
   * fetch resolves so the big number never flashes 0. */
  fallbackStreak: number;
}) {
  const [data, setData] = useState<StreakResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Lazy fetch: nothing hits the DB until the user actually opens the modal,
  // which is the most efficient option (no query on every page load).
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setError(null);
    fetch("/api/streak")
      .then(async (res) => ({ ok: res.ok, json: await res.json() }))
      .then(({ ok, json }) => {
        if (cancelled) return;
        if (!ok) {
          setError(json.error ?? "Couldn't load your streak.");
          return;
        }
        setData(json as StreakResponse);
      })
      .catch(() => {
        if (!cancelled) setError("Couldn't load your streak.");
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Escape-to-close while open.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const streakValue = data?.currentStreak ?? fallbackStreak;
  const days = data?.days ?? PLACEHOLDER_DAYS;
  const tier = getFlameTier(streakValue);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center p-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
        >
          {/* Backdrop - solid black, no backdrop-blur (blur forces a costly
              full-viewport GPU pass every frame on cheap phones). */}
          <button
            type="button"
            aria-label="Close streak details"
            onClick={onClose}
            className="absolute inset-0 bg-black/80"
          />

          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Streak details"
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ type: "tween", duration: 0.15, ease: "easeOut" }}
            className="relative w-full max-w-sm overflow-hidden rounded-3xl border border-white/10 bg-black p-6 sm:p-8 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_30px_80px_-20px_rgba(0,0,0,0.9)]"
          >
            {/* Streak Freeze pill - paywall bait. Static count (0 for free). */}
            <div className="absolute right-4 top-4 inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-medium text-zinc-300">
              <span aria-hidden="true">❄️</span>
              <span className="tabular-nums">0</span>
              <span className="text-zinc-500">Freezes</span>
            </div>

            <div className="flex flex-col items-center">
              <BreathingFlame streak={streakValue} />

              <h2 className="mt-4 text-3xl font-bold tracking-tight text-white">
                <span className="tabular-nums">{streakValue}</span> Day Streak
              </h2>
              <p className="mt-1 text-sm text-zinc-400">
                {streakValue > 0 ? tier.label : "Study today to light the flame."}
              </p>

              {/* Weekly row */}
              <div className="mt-7 flex w-full items-end justify-between gap-1 sm:gap-1.5">
                {days.map((day, i) => (
                  <DayCell key={day.date} day={day} index={i} />
                ))}
              </div>

              {error ? (
                <p className="mt-6 text-xs font-medium text-red-400">{error}</p>
              ) : (
                <p className="mt-7 text-sm text-zinc-400">
                  Study a deck today to keep your streak going.
                </p>
              )}

              <Link
                href="/pricing"
                onClick={onClose}
                className="mt-4 block text-[11px] font-medium text-zinc-500 transition-colors hover:text-zinc-300"
              >
                Protect your flame. Unlock Streak Freezes with Pro →
              </Link>

              <Link
                href="/ingest"
                onClick={onClose}
                className="mt-5 inline-flex w-full items-center justify-center rounded-full bg-gradient-to-b from-blue-500 to-blue-600 px-6 py-3 text-sm font-semibold text-white ring-1 ring-inset ring-blue-400/40 shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_8px_28px_-6px_rgba(37,99,235,0.55)] transition-all duration-200 hover:from-blue-400 hover:to-blue-500 active:scale-[0.98]"
              >
                Study now
              </Link>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
