"use client";

import { useRef } from "react";
import Link from "next/link";
import { motion } from "motion/react";
import { useSession } from "next-auth/react";
import { fireCelebration } from "@/lib/confetti";

// Gold/white tones for the "Black Card" celebration on the matte black feed.
const BURST_COLORS = ["#D4AF37", "#ffffff", "#E8C766", "#F5E6C8", "#B8860B"];

export default function CompletionSlide({ total }: { total: number }) {
  const { status, update } = useSession();

  // All feed slides (including this one) are mounted up front, not just when
  // scrolled to - so celebrating on mount would fire immediately when the
  // study session starts. Fire only when the slide actually enters the
  // viewport, and only the first time (scrolling back past it shouldn't
  // re-trigger the whole celebration).
  const hasCelebrated = useRef(false);

  function handleViewportEnter() {
    if (hasCelebrated.current) return;
    hasCelebrated.current = true;
    fireCelebration();
    void trackStreak();
  }

  // Records today's study session so the streak advances, then pushes the new
  // streak into the session so the navbar flame is right the moment the user
  // leaves the immersive study view. Best-effort: streak bookkeeping should
  // never interfere with the celebration, so failures are swallowed silently.
  async function trackStreak() {
    if (status !== "authenticated") return;
    try {
      const res = await fetch("/api/study/track", { method: "POST" });
      if (!res.ok) return;
      const data = (await res.json()) as { currentStreak?: number };
      if (typeof data.currentStreak === "number") {
        await update({ currentStreak: data.currentStreak });
      }
    } catch {
      // Ignore - the deck-complete celebration stands on its own.
    }
  }

  return (
    <motion.section
      onViewportEnter={handleViewportEnter}
      viewport={{ amount: 0.6 }}
      className="flex h-dvh w-full shrink-0 snap-start snap-always items-center justify-center px-6"
    >
      <div className="relative flex w-full max-w-md flex-col items-center text-center">
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          {BURST_COLORS.map((color, i) => {
            const angle = (i / BURST_COLORS.length) * Math.PI * 2;
            return (
              <motion.span
                key={color}
                className="absolute h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: color }}
                initial={{ x: 0, y: 0, opacity: 1, scale: 0.6 }}
                animate={{
                  x: Math.cos(angle) * 90,
                  y: Math.sin(angle) * 90,
                  opacity: 0,
                  scale: 1,
                }}
                transition={{ duration: 0.9, ease: "easeOut", delay: i * 0.04 }}
              />
            );
          })}
        </div>

        <motion.div
          initial={{ scale: 0.7, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 260, damping: 20 }}
          className="flex h-20 w-20 items-center justify-center rounded-full bg-gold/15 text-4xl"
        >
          🔥
        </motion.div>

        <h2 className="mt-6 text-3xl font-bold tracking-tight text-gold">
          Deck complete
        </h2>
        <p className="mt-2 text-zinc-400">
          {`You made it through all ${total} concepts. That's active recall, done.`}
        </p>

        <div className="mt-8 flex gap-3">
          <Link
            href="/ingest"
            className="rounded-full border border-white/10 bg-gold px-6 py-2.5 text-sm font-medium text-matte transition-colors hover:bg-gold/90"
          >
            Ingest more notes
          </Link>
        </div>
      </div>
    </motion.section>
  );
}
