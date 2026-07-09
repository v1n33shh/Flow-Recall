"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { motion } from "motion/react";
import { useSession } from "next-auth/react";
import { fireCelebration } from "@/lib/confetti";

// Mirrors the tier thresholds in StreakCounter / StreakModal so all
// three components stay in visual sync.
type FlameTier = { label: string; from: string; via: string; to: string; core: string };

function getFlameTier(streak: number): FlameTier {
  if (streak >= 14)
    return { label: "God Tier", from: "#FFFFFF", via: "#E2E8F0", to: "#94A3B8", core: "#FFFFFF" };
  if (streak >= 7)
    return { label: "Inferno", from: "#FBBF24", via: "#F59E0B", to: "#EA580C", core: "#FEF3C7" };
  if (streak >= 3)
    return { label: "Heating Up", from: "#C084FC", via: "#9333EA", to: "#7E22CE", core: "#F3E8FF" };
  return { label: "The Spark", from: "#93C5FD", via: "#3B82F6", to: "#2563EB", core: "#DBEAFE" };
}

// Milestone messages shown once when the user hits a key streak day.
function getMilestoneMessage(streak: number): string | null {
  if (streak === 3) return "3 days in — you are officially building a habit.";
  if (streak === 7) return "One week straight. That is real commitment.";
  if (streak === 14) return "14 days. You are in the top 1% of learners.";
  if (streak === 30) return "30-day streak. Absolute legend.";
  return null;
}

/** The large SVG flame shown on the completion screen — same shape as
 *  StreakCounter but bigger, with a gentle entrance scale. */
function CompletionFlame({ streak }: { streak: number }) {
  const tier = getFlameTier(streak);
  return (
    <motion.svg
      viewBox="0 0 24 24"
      className="h-16 w-16"
      initial={{ scale: 0.5, opacity: 0 }}
      animate={{ scale: [1, 1.06, 1], opacity: 1 }}
      transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="cf-grad" x1="12" y1="2" x2="12" y2="22" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={tier.from} />
          <stop offset="0.5" stopColor={tier.via} />
          <stop offset="1" stopColor={tier.to} />
        </linearGradient>
      </defs>
      <path
        d="M12 2c1.8 3.2 5 5.4 5 9.2a5 5 0 0 1-10 0c0-1.7.7-3.1 1.9-4.2-.1 1.4.7 2.4 1.9 2.4-1.3-2.9-.1-5.7 1.2-7.4z"
        fill="url(#cf-grad)"
      />
      <path
        d="M12 21a2.9 2.9 0 0 0 2.9-2.9c0-1.5-1.1-2.5-1.8-3.6-.8 1.1-1.6 1.7-2.2 2.6-.4.6-.7 1-.7 1.6A2.8 2.8 0 0 0 12 21z"
        fill={tier.core}
      />
    </motion.svg>
  );
}

export default function CompletionSlide({
  total,
  mastered,
}: {
  total: number;
  mastered: number;
}) {
  const { data: session, status, update } = useSession();
  const isPro = session?.user?.plan === "PRO";

  // newStreak is null until trackStreak() resolves — avoids flashing 0.
  const [newStreak, setNewStreak] = useState<number | null>(null);
  const hasCelebrated = useRef(false);

  const accuracy = total > 0 ? Math.round((mastered / total) * 100) : 0;
  const displayStreak = newStreak ?? session?.user?.currentStreak ?? 0;
  const tier = getFlameTier(displayStreak);
  const milestone = newStreak !== null ? getMilestoneMessage(newStreak) : null;

  function handleViewportEnter() {
    if (hasCelebrated.current) return;
    hasCelebrated.current = true;
    fireCelebration();
    void trackStreak();
  }

  async function trackStreak() {
    if (status !== "authenticated") return;
    try {
      const res = await fetch("/api/study/track", { method: "POST" });
      if (!res.ok) return;
      const data = (await res.json()) as { currentStreak?: number };
      if (typeof data.currentStreak === "number") {
        setNewStreak(data.currentStreak);
        await update({ currentStreak: data.currentStreak });
      }
    } catch {
      // Non-critical — celebration stands on its own.
    }
  }

  return (
    <motion.section
      onViewportEnter={handleViewportEnter}
      viewport={{ amount: 0.6 }}
      className="flex h-dvh w-full shrink-0 snap-start snap-always items-center justify-center px-6"
    >
      <div className="relative flex w-full max-w-md flex-col items-center gap-5 text-center">

        {/* Streak display */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: "spring", stiffness: 300, damping: 24 }}
          className="flex flex-col items-center gap-2"
        >
          <CompletionFlame streak={displayStreak} />
          <div className="mt-1">
            <p className="text-4xl font-bold tracking-tight text-white tabular-nums">
              {displayStreak === 0 ? "Day 1" : `Day ${displayStreak}`}
            </p>
            <p className="mt-0.5 text-sm font-medium text-zinc-400">{tier.label}</p>
          </div>
        </motion.div>

        {/* Milestone banner — only shown on key streak days */}
        {milestone && (
          <motion.div
            initial={{ opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.3, type: "spring", stiffness: 280, damping: 22 }}
            className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3"
          >
            <p className="text-sm font-medium text-zinc-200">{milestone}</p>
          </motion.div>
        )}

        {/* Session accuracy card */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15, type: "spring", stiffness: 280, damping: 24 }}
          className="grid w-full grid-cols-2 gap-3"
        >
          <div className="flex flex-col items-center rounded-2xl border border-white/10 bg-white/[0.03] py-4">
            <span className="text-2xl font-bold tabular-nums text-white">{mastered}</span>
            <span className="mt-0.5 text-xs font-medium uppercase tracking-wide text-zinc-500">
              Mastered
            </span>
          </div>
          <div className="flex flex-col items-center rounded-2xl border border-white/10 bg-white/[0.03] py-4">
            <span
              className={`text-2xl font-bold tabular-nums ${
                accuracy >= 80
                  ? "text-emerald-400"
                  : accuracy >= 50
                  ? "text-amber-400"
                  : "text-rose-400"
              }`}
            >
              {accuracy}%
            </span>
            <span className="mt-0.5 text-xs font-medium uppercase tracking-wide text-zinc-500">
              Accuracy
            </span>
          </div>
        </motion.div>

        {/* Pro upsell — only for free users, at peak dopamine */}
        {!isPro && status === "authenticated" && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.25, type: "spring", stiffness: 260, damping: 24 }}
            className="relative w-full overflow-hidden rounded-2xl border border-accent/30 bg-accent/5 p-4 text-left"
          >
            <div className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full bg-accent/15 blur-2xl" />
            <p className="text-xs font-semibold uppercase tracking-widest text-accent">Pro</p>
            <p className="mt-1.5 text-sm font-medium text-white leading-snug">
              Unlock unlimited decks, Infinite Recall and Streak Freezes.
            </p>
            <Link
              href="/pricing"
              className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-gradient-to-b from-blue-500 to-blue-600 px-4 py-2 text-xs font-semibold text-white ring-1 ring-inset ring-blue-400/40 shadow-[0_4px_16px_-4px_rgba(37,99,235,0.6)] transition-all hover:from-blue-400 hover:to-blue-500 active:scale-[0.98]"
            >
              Upgrade to Pro
              <svg viewBox="0 0 16 16" fill="none" className="h-3 w-3" aria-hidden="true">
                <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </Link>
          </motion.div>
        )}

        {/* Action buttons */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3, type: "spring", stiffness: 260, damping: 24 }}
          className="flex w-full gap-3"
        >
          <Link
            href="/"
            className="flex-1 rounded-full border border-white/10 bg-white/5 px-4 py-2.5 text-center text-sm font-medium text-zinc-300 transition-all hover:bg-white/10 hover:text-white active:scale-[0.98]"
          >
            Library
          </Link>
          <Link
            href="/ingest"
            className="flex-1 rounded-full bg-gradient-to-b from-blue-500 to-blue-600 px-4 py-2.5 text-center text-sm font-semibold text-white ring-1 ring-inset ring-blue-400/40 shadow-[0_6px_20px_-4px_rgba(37,99,235,0.6)] transition-all hover:from-blue-400 hover:to-blue-500 active:scale-[0.98]"
          >
            Study more
          </Link>
        </motion.div>

      </div>
    </motion.section>
  );
}
