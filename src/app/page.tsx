"use client";

import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";
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

// Keep in sync with layout.tsx's metadataBase.
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://flowrecall.app";

// Google Rich Results structured data. Even though this is a Client Component,
// Next still server-renders it into the initial HTML, so crawlers see the
// JSON-LD on first fetch — no JS execution required.
// NOTE: deliberately NO `aggregateRating` — Google issues manual actions for
// fabricated review stars. Add it only once wired to real, on-page ratings.
const SOFTWARE_APP_JSONLD = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "FlowRecall",
  applicationCategory: "EducationalApplication",
  operatingSystem: "Web, iOS, Android",
  url: SITE_URL,
  description:
    "FlowRecall turns any PDF into hundreds of AI-generated flashcards and serves them as a gamified active-recall feed. Built for college and medical students.",
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "USD",
  },
  featureList: [
    "PDF to flashcards",
    "AI active-recall question generation",
    "Gamified streaks and progress tracking",
    "Spaced-repetition study feed",
  ],
  screenshot: `${SITE_URL}/og.png`,
  publisher: {
    "@type": "Organization",
    name: "FlowRecall",
    url: SITE_URL,
  },
};

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

// ---------------------------------------------------------------------------
// Landing-page marketing sections (SEO + conversion). Kept as module-level
// components with no client state, so they server-render into the initial HTML
// where crawlers and rich-result parsers can read them on first fetch.
// ---------------------------------------------------------------------------

// Single source of truth for the FAQ: drives BOTH the visible accordion and the
// FAQPage JSON-LD, so the structured data always matches the on-page text
// (Google requires the answer to be present on the page).
const FAQ_ITEMS = [
  {
    q: "What is an active recall app?",
    a: "An active recall app makes you retrieve answers from memory instead of passively re-reading notes — the most effective, research-backed way to study. FlowRecall turns your notes into an endless feed of active-recall questions, so you practise retrieval every time you open it.",
  },
  {
    q: "Can I generate flashcards from a PDF?",
    a: "Yes. Upload any PDF — lecture slides, a textbook chapter, or research papers — and FlowRecall's AI automatically generates hundreds of flashcards in seconds. No manual typing or formatting required.",
  },
  {
    q: "Is FlowRecall better than Anki for med school?",
    a: "FlowRecall gives you Anki's spaced-repetition power without the setup. There are no add-ons to install or templates to build — just upload your material and start studying. For medical students juggling huge volumes of content, that means hours saved on deck-building and more time spent actually reviewing.",
  },
  {
    q: "Does FlowRecall use spaced repetition?",
    a: "Yes. Every card is scheduled with a spaced-repetition algorithm that resurfaces material right before you are likely to forget it, moving knowledge into long-term memory with the fewest possible reviews.",
  },
  {
    q: "Is FlowRecall free?",
    a: "FlowRecall is free to start, with no credit card required. It is powered by Groq for blazing-fast card generation on any device, with optional Pro plans for power users.",
  },
];

const FAQPAGE_JSONLD = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: FAQ_ITEMS.map(({ q, a }) => ({
    "@type": "Question",
    name: q,
    acceptedAnswer: { "@type": "Answer", text: a },
  })),
};

// Gentle scroll-reveal. Softer than the hero's aggressive SNAP — marketing
// content should ease in, not snap. transform/opacity only (GPU-composited).
const reveal = (delay = 0) => ({
  initial: { opacity: 0, y: 24 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-80px" },
  transition: { type: "spring" as const, stiffness: 120, damping: 20, delay },
});

// Logo-matched icon tile: zinc gradient chip with an inset top highlight.
function FeatureIcon({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-gradient-to-br from-zinc-800 to-zinc-950 text-zinc-300 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
      {children}
    </div>
  );
}

// Shared card chrome: deep zinc glass, hairline ring, inset highlight.
const CARD =
  "group relative flex flex-col overflow-hidden rounded-3xl bg-zinc-950/60 p-8 ring-1 ring-inset ring-white/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur-xl transition-colors duration-300 hover:ring-white/20";

function FeaturesSection() {
  return (
    <section
      aria-labelledby="features-heading"
      className="relative z-10 mx-auto w-full max-w-6xl px-6 py-24 sm:py-32"
    >
      <motion.div {...reveal()} className="mx-auto max-w-3xl text-center">
        <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-1.5 text-xs font-medium uppercase tracking-widest text-zinc-300 md:backdrop-blur-md">
          <span className="h-1.5 w-1.5 rounded-full bg-accent shadow-[0_0_8px_2px_rgba(59,130,246,0.7)]" />
          Why FlowRecall
        </p>
        <h2
          id="features-heading"
          className="font-sans text-3xl font-bold leading-tight tracking-tight text-zinc-100 [text-wrap:balance] sm:text-5xl"
        >
          The ultimate active recall study tool for medical students and polymaths.
        </h2>
        <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-zinc-400 [text-wrap:balance] sm:text-lg">
          Turn any PDF into an AI-generated, spaced-repetition study feed — all the
          retention science of Anki, rebuilt for how students actually study today.
        </p>
      </motion.div>

      <div className="mt-14 grid grid-cols-1 gap-4 sm:mt-16 sm:grid-cols-2 lg:grid-cols-3 lg:grid-rows-2">
        {/* Primary card — PDF → flashcards — spans the tall left block. */}
        <motion.article
          {...reveal(0)}
          className={`${CARD} justify-between sm:col-span-2 lg:row-span-2`}
        >
          {/* The single splash of electric blue — a soft ambient accent glow. */}
          <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-accent/10 blur-3xl" />
          <div className="relative">
            <FeatureIcon>
              <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden="true">
                <path d="M13 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9l-6-6Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
                <path d="M13 3v6h6" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
              </svg>
            </FeatureIcon>
            <h3 className="mt-6 font-sans text-xl font-semibold leading-snug tracking-tight text-zinc-100 sm:text-2xl">
              PDF to Flashcards in Seconds
            </h3>
            <p className="mt-3 max-w-md text-sm leading-relaxed text-zinc-400 sm:text-base">
              Drop in a lecture slide deck, a textbook chapter, or a research PDF.
              FlowRecall&apos;s AI reads it and spins up hundreds of active-recall
              flashcards in seconds — no manual card-making, no formatting, no busywork.
            </p>
          </div>
          {/* CSS-only monochrome mock: a PDF page transforming into a study card. */}
          <div className="relative mt-10 flex items-center gap-3" aria-hidden="true">
            <div className="h-28 w-20 shrink-0 rounded-lg border border-white/10 bg-white/[0.03] p-2">
              <div className="h-1.5 w-3/4 rounded bg-white/15" />
              <div className="mt-1.5 h-1.5 w-full rounded bg-white/10" />
              <div className="mt-1.5 h-1.5 w-5/6 rounded bg-white/10" />
              <div className="mt-1.5 h-1.5 w-full rounded bg-white/10" />
              <div className="mt-3 h-1.5 w-1/2 rounded bg-white/10" />
            </div>
            <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5 shrink-0 text-zinc-600" aria-hidden="true">
              <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <div className="relative flex-1">
              <div className="absolute -top-2 left-2 h-24 w-full rotate-[-6deg] rounded-xl border border-white/10 bg-white/[0.02]" />
              <div className="relative h-24 w-full rounded-xl border border-white/10 bg-zinc-900/80 p-3">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                  Recall
                </div>
                <div className="mt-2 h-1.5 w-4/5 rounded bg-white/15" />
                <div className="mt-1.5 h-1.5 w-3/5 rounded bg-white/10" />
                <div className="mt-3 text-[10px] font-medium text-accent">Tap to reveal</div>
              </div>
            </div>
          </div>
        </motion.article>

        {/* Spaced repetition & gamification */}
        <motion.article {...reveal(0.08)} className={`${CARD} justify-between`}>
          <div>
            <FeatureIcon>
              <svg viewBox="0 0 24 24" className="h-5 w-5 text-accent" aria-hidden="true">
                <path d="M12 2c1.8 3.2 5 5.4 5 9.2a5 5 0 0 1-10 0c0-1.7.7-3.1 1.9-4.2-.1 1.4.7 2.4 1.9 2.4-1.3-2.9-.1-5.7 1.2-7.4z" fill="currentColor" />
              </svg>
            </FeatureIcon>
            <h3 className="mt-6 font-sans text-xl font-semibold leading-snug tracking-tight text-zinc-100">
              Spaced Repetition &amp; Gamification
            </h3>
            <p className="mt-3 text-sm leading-relaxed text-zinc-400 sm:text-base">
              Every card is scheduled with spaced repetition, so you review right
              before you&apos;d forget. Streaks, tiers, and a swipe-to-answer feed
              turn daily review into a habit you actually keep.
            </p>
          </div>
          <div className="mt-6 inline-flex w-fit items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-xs text-zinc-400">
            <span className="h-1 w-1 rounded-full bg-accent" />
            Spaced repetition &middot; Streaks
          </div>
        </motion.article>

        {/* Better than Anki */}
        <motion.article {...reveal(0.16)} className={`${CARD} justify-between`}>
          <div>
            <FeatureIcon>
              <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden="true">
                <path d="M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z" stroke="currentColor" strokeWidth="1.8" />
                <path d="m8.5 12 2.4 2.4 4.6-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </FeatureIcon>
            <h3 className="mt-6 font-sans text-xl font-semibold leading-snug tracking-tight text-zinc-100">Better than Anki</h3>
            <p className="mt-3 text-sm leading-relaxed text-zinc-400 sm:text-base">
              All of Anki&apos;s retention power, none of the friction. No add-ons, no
              template-wrangling, no hours spent building decks — just upload and
              study. The modern Anki alternative, built for how students really work.
            </p>
          </div>
          <div className="mt-6 inline-flex w-fit items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-xs text-zinc-400">
            <span className="h-1 w-1 rounded-full bg-accent" />
            Anki alternative
          </div>
        </motion.article>
      </div>
    </section>
  );
}

function FaqSection() {
  return (
    <section
      aria-labelledby="faq-heading"
      className="relative z-10 mx-auto w-full max-w-3xl px-6 pb-24 pt-8 sm:pb-32"
    >
      {/* Google Rich Results: FAQPage — surfaces Q&As directly in search. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(FAQPAGE_JSONLD) }}
      />
      <motion.h2
        {...reveal()}
        id="faq-heading"
        className="text-center font-sans text-3xl font-bold leading-tight tracking-tight text-zinc-100 sm:text-4xl"
      >
        Frequently asked questions
      </motion.h2>
      <motion.div
        {...reveal(0.05)}
        className="mt-10 divide-y divide-white/10 rounded-3xl bg-zinc-950/60 px-6 ring-1 ring-inset ring-white/10 backdrop-blur-xl sm:mt-12 sm:px-8"
      >
        {FAQ_ITEMS.map(({ q, a }) => (
          <details key={q} className="group py-5">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-1 [&::-webkit-details-marker]:hidden">
              <h3 className="text-base font-medium text-zinc-200 transition-colors group-open:text-white sm:text-lg">
                {q}
              </h3>
              <span className="relative flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-white/10 text-zinc-400 transition-transform duration-300 group-open:rotate-45">
                <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5" aria-hidden="true">
                  <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </span>
            </summary>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-zinc-400 sm:text-base">
              {a}
            </p>
          </details>
        ))}
      </motion.div>
    </section>
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
    <main className="relative flex flex-1 flex-col">
      {/* Google Rich Results: SoftwareApplication (Educational Application). */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(SOFTWARE_APP_JSONLD) }}
      />

      {/* ============================ HERO ============================ */}
      <section
        aria-labelledby="hero-heading"
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        className="relative flex min-h-[88vh] flex-col items-center justify-center overflow-hidden px-6 py-16 text-center [perspective:1200px] sm:py-24"
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
          id="hero-heading"
          className="max-w-2xl bg-gradient-to-br from-white via-zinc-200 to-zinc-500 bg-clip-text pb-2 font-sans text-5xl font-bold leading-tight tracking-tight text-transparent [text-wrap:balance] md:text-7xl"
        >
          The AI Flashcards App That Turns PDFs Into Active Recall
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
          <section aria-labelledby="library-heading" className="mt-16 w-full max-w-4xl">
            <h2
              id="library-heading"
              className="text-left text-lg font-semibold tracking-tight text-zinc-300 sm:text-xl"
            >
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
          </section>
        )}
        </div>
      </section>

      {/* ========================== FEATURES ========================== */}
      <FeaturesSection />

      {/* ============================= FAQ ============================ */}
      <FaqSection />
    </main>
  );
}
