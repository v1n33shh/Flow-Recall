"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { motion } from "motion/react";
import { useSession } from "next-auth/react";
import { fireCelebration } from "@/lib/confetti";
import { apiUrl, API_FETCH_CREDENTIALS } from "@/lib/apiUrl";
import { summariseDeck, type DeckSummary } from "@/lib/recallStorage";

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
  deckId,
  total,
  cleared,
}: {
  /** Null when the engine built this session across decks: there is no single deck
   * to summarise, so the "your memory of this deck" block is simply not shown. A
   * library-wide summary is the honest replacement and is a later move. */
  deckId: string | null;
  total: number;
  /** What the "Cleared" tile counts, and the numerator of the accuracy figure.
   *
   * Deck mode passes concepts MASTERED - both formats answered right - because a
   * deck session asks every concept both ways, so mastery is the honest summary of
   * it. An engine-built session asks each concept ONE way deliberately, which puts
   * mastery out of reach inside it; it passes cards answered correctly instead.
   * Both are "what you got through tonight", which is what this tile claims. */
  cleared: number;
}) {
  const { data: session, status, update } = useSession();
  const isPro = session?.user?.plan === "PRO";

  // newStreak is null until trackStreak() resolves — avoids flashing 0.
  const [newStreak, setNewStreak] = useState<number | null>(null);
  // What the recall engine knows about this deck, read once the student actually
  // reaches this slide rather than in an effect - it costs two IndexedDB reads
  // and there is no reason to pay them for a session nobody finishes.
  const [memoryOfDeck, setMemoryOfDeck] = useState<DeckSummary | null>(null);
  const hasCelebrated = useRef(false);

  const accuracy = total > 0 ? Math.round((cleared / total) * 100) : 0;
  const displayStreak = newStreak ?? session?.user?.currentStreak ?? 0;
  const tier = getFlameTier(displayStreak);
  const milestone = newStreak !== null ? getMilestoneMessage(newStreak) : null;

  function handleViewportEnter() {
    if (hasCelebrated.current) return;
    hasCelebrated.current = true;
    fireCelebration();
    void trackStreak();
    const userId = session?.user?.id;
    // deckId is null for an engine-built session, which spans decks and so has no
    // single one to summarise - the block below is skipped rather than fed an id
    // that would read as an empty deck.
    if (userId && deckId) {
      // Best-effort: the celebration stands on its own if the engine has
      // nothing to say yet, or fails to answer.
      summariseDeck(userId, deckId)
        .then(setMemoryOfDeck)
        .catch((error) => console.error("summariseDeck failed", error));
    }
  }

  async function trackStreak() {
    if (status !== "authenticated") return;
    try {
      const res = await fetch(apiUrl("/api/study/track"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Lets the server compute "today" in this user's own timezone
        // instead of the server process's (see src/lib/localDay.ts).
        body: JSON.stringify({ timezoneOffsetMinutes: new Date().getTimezoneOffset() }),
        credentials: API_FETCH_CREDENTIALS,
      });
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
            <p className="text-4xl font-bold tracking-tight text-foreground tabular-nums">
              {displayStreak === 0 ? "Day 1" : `Day ${displayStreak}`}
            </p>
            <p className="mt-0.5 text-sm font-medium text-muted-foreground">{tier.label}</p>
          </div>
        </motion.div>

        {/* Milestone banner — only shown on key streak days */}
        {milestone && (
          <motion.div
            initial={{ opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.3, type: "spring", stiffness: 280, damping: 22 }}
            className="w-full rounded-2xl border border-border bg-foreground/5 px-4 py-3"
          >
            <p className="text-sm font-medium text-foreground">{milestone}</p>
          </motion.div>
        )}

        {/* What the recall engine knows — the part that outlives this session, and
             the first thing shown for exactly that reason. The accuracy card below
             is about tonight; this is about whether the knowledge is durable. */}
        {memoryOfDeck && memoryOfDeck.units > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15, type: "spring", stiffness: 280, damping: 24 }}
            className="w-full rounded-2xl border border-border bg-foreground/[0.03] p-4 text-left"
          >
            <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
              Your memory of this deck
            </p>

            <div className="mt-3 flex items-baseline gap-5">
              <span className="flex flex-col">
                <span className="text-2xl font-bold tabular-nums text-accent">{memoryOfDeck.solid}</span>
                <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Solid
                </span>
              </span>
              <span className="flex flex-col">
                <span className="text-2xl font-bold tabular-nums text-pending">{memoryOfDeck.fading}</span>
                <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Fading
                </span>
              </span>
              <span className="flex flex-col">
                <span className="text-2xl font-bold tabular-nums text-foreground">
                  {memoryOfDeck.holding + memoryOfDeck.familiar + memoryOfDeck.met}
                </span>
                <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Still building
                </span>
              </span>
            </div>

            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
              {memoryOfDeck.resting > 0
                ? `${memoryOfDeck.resting} ${memoryOfDeck.resting === 1 ? "concept is" : "concepts are"} resting — you have ${memoryOfDeck.resting === 1 ? "it" : "these"} solidly, so reviewing ${memoryOfDeck.resting === 1 ? "it" : "them"} tonight would have bought you almost nothing.`
                : "A concept turns solid once you've answered it two different ways, including once after a week away. That gap is the part that proves it stuck."}
            </p>
          </motion.div>
        )}

        {/* Tonight's score, deliberately SECOND. It used to lead, which taught the
             student that the session was the point - and the whole thesis of the
             engine is that the block above it is. */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2, type: "spring", stiffness: 280, damping: 24 }}
          className="grid w-full grid-cols-2 gap-3"
        >
          <div className="flex flex-col items-center rounded-2xl border border-border bg-foreground/[0.03] py-4">
            <span className="text-2xl font-bold tabular-nums text-foreground">{cleared}</span>
            <span className="mt-0.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Cleared
            </span>
          </div>
          <div className="flex flex-col items-center rounded-2xl border border-border bg-foreground/[0.03] py-4">
            <span
              className={`text-2xl font-bold tabular-nums ${
                accuracy >= 80
                  ? "text-success"
                  : accuracy >= 50
                    ? "text-pending"
                    : "text-danger"
              }`}
            >
              {accuracy}%
            </span>
            <span className="mt-0.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
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
            <p className="mt-1.5 text-sm font-medium text-foreground leading-snug">
              Unlock unlimited decks, Infinite Recall and Streak Freezes.
            </p>
            <Link
              href="/pricing"
              className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-accent px-4 py-2 text-xs font-semibold text-accent-foreground ring-1 ring-inset ring-accent/30 shadow-[0_4px_16px_-4px_rgba(0,0,0,0.4)] transition-all hover:bg-accent/90 active:scale-[0.98]"
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
            className="flex-1 rounded-full border border-border bg-foreground/5 px-4 py-2.5 text-center text-sm font-medium text-foreground transition-all hover:bg-foreground/10 active:scale-[0.98]"
          >
            Library
          </Link>
          <Link
            href="/ingest"
            className="flex-1 rounded-full bg-accent px-4 py-2.5 text-center text-sm font-semibold text-accent-foreground ring-1 ring-inset ring-accent/30 shadow-[0_6px_20px_-4px_rgba(0,0,0,0.4)] transition-all hover:bg-accent/90 active:scale-[0.98]"
          >
            Study more
          </Link>
        </motion.div>

      </div>
    </motion.section>
  );
}
