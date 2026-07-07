"use client";

import type { MouseEvent as ReactMouseEvent } from "react";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion, useMotionValue, useSpring, useTransform, type MotionValue } from "motion/react";
import type { Concept, Deck } from "@/lib/types";
import {
  appendConceptsToDeck,
  clearProgress,
  deleteDeck,
  getProgress,
  setStudyDeck,
  useSavedDecks,
} from "@/lib/storage";

// A harsh, high-stiffness/low-damping spring so elements snap aggressively
// into place instead of gently fading in - used for every entrance below.
const SNAP = { type: "spring" as const, stiffness: 700, damping: 18 };

// Mirrors the Speed-First Cap in ingest/page.tsx: JIT-generating a deck's
// pending chunks processes the same bounded batch size, for the same
// blazing-fast-and-rate-limit-safe reasons.
const MAX_CHUNKS = 4;
const CHUNK_DELAY_MS = 1000;

// Inline fractal-noise SVG for the cinematic film-grain overlay. Kept as a
// data URI applied via inline style rather than a Tailwind arbitrary class so
// the SVG's quotes/percent-signs don't have to survive class-name parsing.
const NOISE_BACKGROUND =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

const MARQUEE_ROWS = [
  {
    text: "ACTIVE RECALL • DOOMSCROLLING • MAX PERFORMANCE • ",
    top: "6%",
    rotate: -8,
    duration: 42,
    reverse: false,
    className: "text-zinc-400/10",
  },
  {
    text: "GROQ POWERED • ZERO FRICTION • STUDY HARDER • ",
    top: "42%",
    rotate: 7,
    duration: 55,
    reverse: true,
    className: "text-zinc-400/[0.07]",
  },
  {
    text: "NO CREDIT CARD • BLAZING FAST • FLOWRECALL • ",
    top: "78%",
    rotate: -5,
    duration: 65,
    reverse: false,
    className: "text-zinc-400/10",
  },
];

type MockCard = {
  className: string;
  depth: number;
  delay: number;
  label: string;
  labelColor: string;
  body: string;
  footer: string;
};

const MOCK_CARDS: MockCard[] = [
  {
    className: "left-[4%] top-[12%] hidden md:block",
    depth: 1,
    delay: 0,
    label: "MITOCHONDRIA",
    labelColor: "text-zinc-400/70",
    body: "What is the powerhouse of the cell?",
    footer: "✕  ✓  Swipe",
  },
  {
    className: "right-[6%] top-[8%] hidden lg:block",
    depth: 1.6,
    delay: 0.1,
    label: "PHOTOSYNTHESIS",
    labelColor: "text-zinc-400/70",
    body: "Plants use ▢▢▢▢▢ to absorb light.",
    footer: "Nailed it.",
  },
  {
    className: "bottom-[10%] right-[10%] hidden md:block",
    depth: 1.2,
    delay: 0.2,
    label: "STREAK",
    labelColor: "text-zinc-400/70",
    body: "🔥  7",
    footer: "You're on fire",
  },
];

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function MarqueeBackground() {
  return (
    <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      {MARQUEE_ROWS.map((row, i) => (
        <div
          key={i}
          className="absolute w-[250vw]"
          style={{ top: row.top, left: "50%", transform: `translateX(-50%) rotate(${row.rotate}deg)` }}
        >
          <motion.div
            className={`flex whitespace-nowrap text-[5rem] font-black uppercase leading-none tracking-tighter sm:text-[7rem] md:text-[9rem] ${row.className}`}
            animate={{ x: row.reverse ? ["-50%", "0%"] : ["0%", "-50%"] }}
            transition={{ duration: row.duration, repeat: Infinity, ease: "linear" }}
          >
            <span>{row.text.repeat(6)}</span>
            <span aria-hidden="true">{row.text.repeat(6)}</span>
          </motion.div>
        </div>
      ))}
    </div>
  );
}

type ParallaxCardProps = {
  card: MockCard;
  mouseX: MotionValue<number>;
  mouseY: MotionValue<number>;
};

function ParallaxCard({ card, mouseX, mouseY }: ParallaxCardProps) {
  // Shift opposite to the cursor, scaled by each card's own "depth" so they
  // don't all move in lockstep - and tilt in 3D toward the cursor for a
  // physical, responsive feel instead of a flat drag.
  const x = useTransform(mouseX, [-1, 1], [card.depth * 24, card.depth * -24]);
  const y = useTransform(mouseY, [-1, 1], [card.depth * 24, card.depth * -24]);
  const rotateY = useTransform(mouseX, [-1, 1], [-14, 14]);
  const rotateX = useTransform(mouseY, [-1, 1], [14, -14]);

  return (
    <motion.div
      style={{ x, y, rotateX, rotateY }}
      initial={{ opacity: 0, scale: 0.5, rotate: 0 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ ...SNAP, delay: card.delay }}
      className={`absolute w-44 rounded-2xl border border-white/10 bg-surface p-3 text-left ${card.className}`}
    >
      <p className={`text-[10px] font-semibold uppercase tracking-wide ${card.labelColor}`}>
        {card.label}
      </p>
      <p className="mt-2 text-xs leading-snug text-zinc-300">{card.body}</p>
      <p className="mt-2 text-[10px] text-zinc-500">{card.footer}</p>
    </motion.div>
  );
}

export default function Home() {
  const router = useRouter();
  const decks = useSavedDecks();

  const [generatingDeckIds, setGeneratingDeckIds] = useState<Set<string>>(new Set());
  const [jitErrors, setJitErrors] = useState<Record<string, string>>({});

  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);
  const smoothMouseX = useSpring(mouseX, { stiffness: 150, damping: 20, mass: 0.5 });
  const smoothMouseY = useSpring(mouseY, { stiffness: 150, damping: 20, mass: 0.5 });

  function handleMouseMove(event: ReactMouseEvent<HTMLElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    mouseX.set(((event.clientX - rect.left) / rect.width) * 2 - 1);
    mouseY.set(((event.clientY - rect.top) / rect.height) * 2 - 1);
  }

  function handleMouseLeave() {
    mouseX.set(0);
    mouseY.set(0);
  }

  function handleStudyNow(deck: Deck, isFullyMastered: boolean) {
    // A 100%-mastered session resuming normally would hydrate a queue with
    // nothing left to answer and dump the user straight at the completion
    // slide - clear it so "Review Again" actually starts a fresh pass.
    if (isFullyMastered) {
      clearProgress(deck.id);
    }
    setStudyDeck(deck.id, deck.concepts);
    router.push("/study");
  }

  function handleDelete(id: string, event: ReactMouseEvent) {
    event.stopPropagation();
    if (window.confirm("Delete this deck? This can't be undone.")) {
      deleteDeck(id);
    }
  }

  async function handleGenerateNextSection(deck: Deck) {
    const pending = deck.pendingChunks;
    if (!pending || pending.length === 0) return;

    setGeneratingDeckIds((prev) => new Set(prev).add(deck.id));
    setJitErrors((prev) => {
      const next = { ...prev };
      delete next[deck.id];
      return next;
    });

    const batch = pending.slice(0, MAX_CHUNKS);
    const remaining = pending.slice(MAX_CHUNKS);
    const newConcepts: Concept[] = [];

    try {
      // Sequential, not Promise.all - same rate-limit reasoning as the
      // original ingest flow applies here too.
      for (let i = 0; i < batch.length; i++) {
        const res = await fetch("/api/ingest", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: batch[i] }),
        });

        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.error ?? `Something went wrong on part ${i + 1} of ${batch.length}.`);
        }

        newConcepts.push(...data.concepts);

        if (i < batch.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, CHUNK_DELAY_MS));
        }
      }

      appendConceptsToDeck(deck.id, newConcepts, remaining);
    } catch (err) {
      setJitErrors((prev) => ({
        ...prev,
        [deck.id]: err instanceof Error ? err.message : "Something went wrong.",
      }));
    } finally {
      setGeneratingDeckIds((prev) => {
        const next = new Set(prev);
        next.delete(deck.id);
        return next;
      });
    }
  }

  return (
    <main
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      className="relative flex flex-1 flex-col items-center justify-center overflow-hidden px-6 py-16 text-center [perspective:1200px] sm:py-24"
    >
      <MarqueeBackground />

      {/* Faded spotlight grid - a fine ruled pattern masked with a radial
          gradient so it dissolves into darkness at the edges, leaving a subtle
          lit "stage" behind the hero copy. */}
      <div className="pointer-events-none absolute inset-0 -z-10 bg-[linear-gradient(to_right,#ffffff08_1px,transparent_1px),linear-gradient(to_bottom,#ffffff08_1px,transparent_1px)] bg-[size:3rem_3rem] [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_70%)]" />

      {/* Ambient glow orbs - purely decorative, blurred color washes that sit
          behind the hero to give the dark page depth. pointer-events-none and
          -z-10 keep them clear of the marquee, cards, and interactive content. */}
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden hidden md:block">
        <div className="absolute -top-40 left-1/2 h-[38rem] w-[38rem] -translate-x-1/2 rounded-full bg-white/5 blur-3xl" />
        <div className="absolute top-1/3 -left-32 h-[30rem] w-[30rem] rounded-full bg-white/[0.03] blur-3xl" />
        <div className="absolute -bottom-24 right-[-8rem] h-[32rem] w-[32rem] rounded-full bg-white/5 blur-3xl" />
      </div>

      {/* Cinematic film grain - a fixed, whisper-faint noise texture over the
          whole viewport for a physical, filmic surface. */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-0 opacity-[0.03] hidden md:block"
        style={{ backgroundImage: NOISE_BACKGROUND }}
      />

      {MOCK_CARDS.map((card, i) => (
        <ParallaxCard key={i} card={card} mouseX={smoothMouseX} mouseY={smoothMouseY} />
      ))}

      <div className="relative z-10 flex flex-col items-center">
        <motion.p
          initial={{ opacity: 0, y: -24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={SNAP}
          className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-1.5 text-xs font-medium uppercase tracking-widest text-zinc-300 md:backdrop-blur-md"
        >
          <span className="h-1.5 w-1.5 rounded-full bg-accent shadow-[0_0_8px_2px_rgba(59,130,246,0.7)]" />
          Active recall, disguised as doomscrolling
        </motion.p>
        <motion.h1
          initial={{ opacity: 0, y: 32 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...SNAP, delay: 0.05 }}
          className="font-retro max-w-2xl text-white pb-4 text-4xl leading-tight [text-wrap:balance] sm:text-6xl"
        >
          Drop your notes in. Scroll your way to remembering everything.
        </motion.h1>
        <motion.p
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...SNAP, delay: 0.1 }}
          className="mt-6 max-w-xl text-lg leading-relaxed text-zinc-300/90 [text-wrap:balance] sm:text-xl"
        >
          Upload any lecture PDF, and FlowRecall instantly generates an
          addictive, gamified active-recall feed. Stop passively re-reading
          notes and start hard-wiring knowledge into your brain. Master a
          semester&apos;s worth of material in half the time.
        </motion.p>
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...SNAP, delay: 0.15 }}
          className="mt-10 flex w-full max-w-xs flex-col gap-3 sm:w-auto sm:max-w-none sm:flex-row"
        >
          {/* Secondary CTA - minimalist glassmorphic outline. */}
          <Link
            href="/pricing"
            className="w-full rounded-full border border-white/10 bg-transparent px-6 py-3.5 text-center text-base font-medium text-zinc-300 md:backdrop-blur-md transition-all duration-200 hover:scale-[1.03] hover:bg-white/5 active:scale-[0.97] sm:w-auto sm:py-3 sm:text-sm"
          >
            View Pro Plans
          </Link>
          {/* Primary CTA - Electric Azure: the single accent, a vertical blue
              gradient with an inset top highlight and an ambient glow that
              intensifies on hover so it reads as raised and unmistakably clickable. */}
          <Link
            href="/ingest"
            className="w-full rounded-full bg-gradient-to-b from-blue-500 to-blue-600 px-6 py-3.5 text-center text-base font-semibold text-white ring-1 ring-inset ring-blue-400/40 shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_8px_28px_-6px_rgba(37,99,235,0.55)] transition-all duration-200 hover:from-blue-400 hover:to-blue-500 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_12px_40px_-6px_rgba(59,130,246,0.75)] hover:scale-[1.03] active:scale-[0.97] sm:w-auto sm:py-3 sm:text-sm"
          >
            Start ingesting notes
          </Link>
        </motion.div>

        {decks.length > 0 && (
          <div className="mt-16 w-full max-w-4xl">
            <h2 className="text-left text-lg font-semibold tracking-tight text-zinc-300 sm:text-xl">
              Your Library
            </h2>
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
              {decks.map((deck) => {
                const progress = getProgress(deck.id);
                const masteredCount = progress?.masteredIds.length ?? 0;
                const pct =
                  deck.concepts.length > 0 ? Math.min(masteredCount / deck.concepts.length, 1) : 0;
                const isFullyMastered = Boolean(progress) && pct >= 1;
                const buttonLabel = !progress ? "Study Now" : isFullyMastered ? "Review Again" : "Resume";

                return (
                  <div
                    key={deck.id}
                    className="group relative flex flex-col rounded-2xl border border-white/10 bg-white/[0.02] p-5 text-left shadow-[inset_0_1px_0_rgba(255,255,255,0.1)] md:backdrop-blur-xl transition-transform hover:-translate-y-0.5"
                  >
                    <button
                      type="button"
                      onClick={(event) => handleDelete(deck.id, event)}
                      aria-label="Delete deck"
                      className="absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-full text-lg leading-none text-zinc-500 transition-colors hover:bg-white/5 hover:text-zinc-300"
                    >
                      &times;
                    </button>
                    <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                      {formatDate(deck.createdAt)}
                    </p>
                    <h3 className="mt-1 truncate pr-6 text-lg font-semibold text-zinc-300">
                      {deck.title}
                    </h3>
                    <p className="mt-1 text-sm text-zinc-400">
                      {deck.concepts.length} concept{deck.concepts.length === 1 ? "" : "s"}
                    </p>

                    {progress && (
                      <div className="mt-3">
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                          <div
                            className="h-full bg-accent transition-all"
                            style={{ width: `${pct * 100}%` }}
                          />
                        </div>
                        <p className="mt-1.5 text-xs text-zinc-500">
                          {masteredCount}/{deck.concepts.length} mastered
                        </p>
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={() => handleStudyNow(deck, isFullyMastered)}
                      className="mt-4 rounded-full bg-gradient-to-b from-blue-500 to-blue-600 ring-1 ring-inset ring-blue-400/40 shadow-[inset_0_1px_0_rgba(255,255,255,0.15),0_8px_24px_-6px_rgba(37,99,235,0.55)] px-4 py-2.5 text-sm font-medium text-white transition-all duration-200 hover:from-blue-400 hover:to-blue-500 active:scale-[0.98]"
                    >
                      {buttonLabel}
                    </button>

                    {deck.pendingChunks && deck.pendingChunks.length > 0 && (
                      <>
                        <button
                          type="button"
                          onClick={() => handleGenerateNextSection(deck)}
                          disabled={generatingDeckIds.has(deck.id)}
                          className="mt-2 rounded-full border border-white/10 bg-transparent px-4 py-2.5 text-sm font-medium text-zinc-300 transition-all duration-200 hover:bg-white/10 hover:text-white active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {generatingDeckIds.has(deck.id)
                            ? "Generating..."
                            : `Generate Next Section (${deck.pendingChunks.length} chunks left)`}
                        </button>
                        {jitErrors[deck.id] && (
                          <p className="mt-2 text-xs text-zinc-400">{jitErrors[deck.id]}</p>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
