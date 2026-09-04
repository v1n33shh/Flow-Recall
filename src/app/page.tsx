"use client";

import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { startTransition, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import type { Deck } from "@/lib/types";
import {
  appendConceptsToDeck,
  clearProgress,
  deleteDeck,
  getProgress,
  setStudyDeck,
  useSavedDecks,
} from "@/lib/storage";
import { runChunks } from "@/lib/ingestChunks";
import { useIsNative } from "@/lib/useIsNative";
import LogoMark from "@/components/LogoMark";
import DeckExamDate from "@/components/DeckExamDate";
import MemoryOverview from "@/components/MemoryOverview";
import TodaySession from "@/components/TodaySession";

// A harsh, high-stiffness/low-damping spring so elements snap aggressively
// into place instead of gently fading in - used for every entrance below.
const SNAP = { type: "spring" as const, stiffness: 700, damping: 18 };

// How many pending chunks one tap of "Generate Next Section" works through.
// Smaller than /ingest's cap on purpose: this runs from the library, where the
// student is standing in front of a list waiting for a button to come back, not
// watching a deck being built. At the 4500-character chunk size that is ~18,000
// characters a tap. The pacing and retrying inside the batch are runChunks'.
const MAX_CHUNKS = 4;

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
    "Active-recall study feed",
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

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric" });
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
    a: "FlowRecall skips Anki's biggest cost: building the deck by hand. Upload your material and FlowRecall's AI writes the flashcards for you in seconds, then serves them as a gamified active-recall feed instead of a static list. For medical students juggling huge volumes of content, that means hours saved on deck-building and more time spent actually reviewing.",
  },
  {
    q: "What learning science does FlowRecall use?",
    a: "Active recall - deliberately retrieving an answer from memory instead of passively re-reading it, one of the most well-supported study techniques in cognitive science. Every card in FlowRecall's feed makes you attempt a real answer before it reveals the truth, instead of letting you passively scan a static list.",
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
// Deliberately a fixed dark chip in both themes (like the Account avatar) -
// text-zinc-300 stays fixed too, since it's sized for that permanently-dark
// tile rather than the page background around it.
function FeatureIcon({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex h-11 w-11 items-center justify-center rounded-2xl border border-border bg-gradient-to-br from-zinc-800 to-zinc-950 text-zinc-300 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
      {children}
    </div>
  );
}

// Shared card chrome: theme-adaptive glass, hairline ring, inset highlight.
const CARD =
  "group relative flex flex-col overflow-hidden rounded-3xl bg-surface/60 p-8 ring-1 ring-inset ring-border shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur-xl transition-colors duration-300 hover:ring-foreground/20";

function FeaturesSection() {
  // Only the top gap (which abuts the hero's own bottom padding) needs
  // shrinking on native - the two combined otherwise leave up to ~160px of
  // dead space before "Why FlowRecall" even starts. Bottom/desktop spacing
  // is untouched.
  const isNative = useIsNative();
  return (
    <section
      aria-labelledby="features-heading"
      className={`relative z-10 mx-auto w-full max-w-6xl px-6 ${
        isNative ? "pt-10 pb-24" : "py-24 sm:py-32"
      }`}
    >
      <motion.div {...reveal()} className="mx-auto max-w-3xl text-center">
        <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-border bg-foreground/5 px-4 py-1.5 text-xs font-medium uppercase tracking-widest text-foreground md:backdrop-blur-md">
          <span className="h-1.5 w-1.5 rounded-full bg-pulse-accent shadow-[0_0_8px_2px_hsl(var(--pulse-accent)/0.6)]" />
          Why FlowRecall
        </p>
        <h2
          id="features-heading"
          className="font-sans text-3xl font-bold leading-tight tracking-tight text-foreground [text-wrap:balance] sm:text-5xl"
        >
          The ultimate active recall study tool for medical students and polymaths.
        </h2>
        <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-muted-foreground [text-wrap:balance] sm:text-lg">
          Turn any PDF into an AI-generated active-recall study feed. No manual
          flashcards, no deck-building - just upload and start retrieving.
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
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
              Flagship
            </p>
            <FeatureIcon>
              <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden="true">
                <path d="M13 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9l-6-6Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
                <path d="M13 3v6h6" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
              </svg>
            </FeatureIcon>
            <h3 className="mt-6 font-sans text-xl font-semibold leading-snug tracking-tight text-foreground sm:text-2xl">
              PDF to Flashcards in Seconds
            </h3>
            <p className="mt-3 max-w-md text-sm leading-relaxed text-muted-foreground sm:text-base">
              Drop in a lecture slide deck, a textbook chapter, or a research PDF.
              FlowRecall&apos;s AI reads it and spins up hundreds of active-recall
              flashcards in seconds — no manual card-making, no formatting, no busywork.
            </p>
          </div>
          {/* CSS-only monochrome mock: a PDF page transforming into a study card. */}
          <div className="relative mt-10 flex items-center gap-3" aria-hidden="true">
            <div className="h-28 w-20 shrink-0 rounded-lg border border-border bg-foreground/[0.03] p-2">
              <div className="h-1.5 w-3/4 rounded bg-foreground/15" />
              <div className="mt-1.5 h-1.5 w-full rounded bg-foreground/10" />
              <div className="mt-1.5 h-1.5 w-5/6 rounded bg-foreground/10" />
              <div className="mt-1.5 h-1.5 w-full rounded bg-foreground/10" />
              <div className="mt-3 h-1.5 w-1/2 rounded bg-foreground/10" />
            </div>
            <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true">
              <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <div className="relative flex-1">
              <div className="absolute -top-2 left-2 h-24 w-full rotate-[-6deg] rounded-xl border border-border bg-foreground/[0.02]" />
              <div className="relative h-24 w-full rounded-xl border border-border bg-surface/80 p-3">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Recall
                </div>
                <div className="mt-2 h-1.5 w-4/5 rounded bg-foreground/15" />
                <div className="mt-1.5 h-1.5 w-3/5 rounded bg-foreground/10" />
                <div className="mt-3 text-[10px] font-medium text-accent">Tap to reveal</div>
              </div>
            </div>
          </div>
        </motion.article>

        {/* Active recall & gamification */}
        <motion.article {...reveal(0.08)} className={`${CARD} justify-between`}>
          <div>
            <FeatureIcon>
              <svg viewBox="0 0 24 24" className="h-5 w-5 text-accent" aria-hidden="true">
                <path d="M12 2c1.8 3.2 5 5.4 5 9.2a5 5 0 0 1-10 0c0-1.7.7-3.1 1.9-4.2-.1 1.4.7 2.4 1.9 2.4-1.3-2.9-.1-5.7 1.2-7.4z" fill="currentColor" />
              </svg>
            </FeatureIcon>
            <h3 className="mt-6 font-sans text-xl font-semibold leading-snug tracking-tight text-foreground">
              Active Recall &amp; Gamification
            </h3>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground sm:text-base">
              Every card demands a real answer before it reveals the truth,
              forcing your brain to retrieve instead of recognize. Streaks,
              tiers, and a swipe-to-answer feed turn daily review into a habit
              you actually keep.
            </p>
          </div>
          {/* Mini streak-calendar mock - echoes StreakModal.tsx's DayCell
              visual language and previews the real streak feature this same
              home page now surfaces (mobile hero carousel, card 3). */}
          <div className="mt-6 flex items-center gap-1.5" aria-hidden="true">
            {[true, true, true, true, true, false, false].map((filled, i) => (
              <span
                key={i}
                className={`h-5 w-5 rounded ${filled ? "bg-accent" : "border border-border"}`}
              />
            ))}
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
            <h3 className="mt-6 font-sans text-xl font-semibold leading-snug tracking-tight text-foreground">Better than Anki</h3>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground sm:text-base">
              All of Anki&apos;s retention power, none of the friction. No add-ons, no
              template-wrangling, no hours spent building decks — just upload and
              study. The modern Anki alternative, built for how students really work.
            </p>
          </div>
          {/* Compact before/after mock, reinforcing the card's own claim
              instead of repeating another bare text pill. */}
          <div className="mt-6 flex flex-col gap-1.5 text-xs text-muted-foreground" aria-hidden="true">
            <div className="flex items-center gap-2">
              <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5 shrink-0" aria-hidden="true">
                <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.6" />
                <path d="M12 7v5l3 2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
              <span className="line-through decoration-muted-foreground/50">Hours building decks</span>
            </div>
            <div className="flex items-center gap-2 text-foreground">
              <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5 shrink-0 text-accent" aria-hidden="true">
                <path d="M5 12.5l4 4 10-10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span>Seconds, just upload</span>
            </div>
          </div>
        </motion.article>
      </div>
    </section>
  );
}

const HOW_IT_WORKS_STEPS = [
  {
    n: "01",
    title: "Upload anything",
    body: "Drop in a PDF, paste raw notes, or import an EPUB - lecture slides, textbook chapters, and research papers all work.",
  },
  {
    n: "02",
    title: "AI generates the feed",
    body: "FlowRecall reads your material and writes hundreds of active-recall questions in seconds, ready to swipe through the moment they're generated.",
  },
  {
    n: "03",
    title: "Swipe through recall",
    body: "Review in a fast, gamified swipe feed - right before you'd forget, not on some arbitrary daily quota.",
  },
];

// The one deliberately asymmetric, non-centered section on the page - no
// pill badge, left-aligned header, oversized ghost numerals as the sole
// decorative device (echoing the hero marquee's own dim giant-type motif in
// a new context) instead of the pill+centered-heading shape used everywhere
// else. Sits between Features and FAQ specifically to break up what would
// otherwise be three near-identical section openers in a row.
function HowItWorksSection() {
  return (
    <section
      aria-labelledby="how-it-works-heading"
      className="relative z-10 mx-auto w-full max-w-6xl px-6 py-16 sm:py-24"
    >
      <div className="lg:grid lg:grid-cols-[minmax(0,320px)_1fr] lg:gap-16">
        <motion.div {...reveal()} className="lg:sticky lg:top-24 lg:self-start">
          <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
            How it works
          </p>
          <h2
            id="how-it-works-heading"
            className="mt-3 font-sans text-3xl font-bold leading-tight tracking-tight text-foreground [text-wrap:balance] sm:text-4xl"
          >
            From PDF to memorized in three steps.
          </h2>
        </motion.div>

        <div className="mt-10 flex flex-col gap-10 lg:mt-0">
          {HOW_IT_WORKS_STEPS.map((step, i) => (
            <motion.div key={step.n} {...reveal(0.08 * i)} className="relative">
              <span
                aria-hidden="true"
                className="pointer-events-none absolute -left-2 -top-8 select-none font-sans text-7xl font-black leading-none text-foreground/[0.06] sm:text-8xl"
              >
                {step.n}
              </span>
              <div className="relative border-l border-border pl-6">
                <h3 className="text-lg font-semibold text-foreground sm:text-xl">{step.title}</h3>
                <p className="mt-2 max-w-lg text-sm leading-relaxed text-muted-foreground sm:text-base">
                  {step.body}
                </p>
              </div>
            </motion.div>
          ))}
        </div>
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
      {/* FAQ previously had zero decoration anywhere - a single soft glow,
          matching the hero/features' existing one-glow idiom, so the page's
          decorative thread doesn't drop to nothing right before the end. */}
      <div className="pointer-events-none absolute left-1/2 top-0 -z-10 h-72 w-72 -translate-x-1/2 -translate-y-1/4 rounded-full bg-foreground/5 blur-3xl" />
      {/* Fading connector rule, visually bridging from How It Works above. */}
      <div
        aria-hidden="true"
        className="mx-auto mb-8 h-16 w-px bg-gradient-to-b from-transparent via-border to-transparent"
      />
      <motion.h2
        {...reveal()}
        id="faq-heading"
        className="text-center font-sans text-3xl font-bold leading-tight tracking-tight text-foreground sm:text-4xl"
      >
        Frequently asked questions
      </motion.h2>
      <motion.div
        {...reveal(0.05)}
        className="mt-10 divide-y divide-border rounded-3xl bg-surface/60 px-6 ring-1 ring-inset ring-border backdrop-blur-xl sm:mt-12 sm:px-8"
      >
        {FAQ_ITEMS.map(({ q, a }) => (
          <details key={q} className="group py-5">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-1 [&::-webkit-details-marker]:hidden">
              <h3 className="text-base font-medium text-foreground/80 transition-colors group-open:text-foreground sm:text-lg">
                {q}
              </h3>
              <span className="relative flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground transition-transform duration-300 group-open:rotate-45">
                <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5" aria-hidden="true">
                  <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </span>
            </summary>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">
              {a}
            </p>
          </details>
        ))}
      </motion.div>
    </section>
  );
}

// Closing conversion moment - the page previously ended cold on the FAQ
// accordion with nothing after it. Deliberately spacious again (mirrors the
// hero's rhythm) as a closing "breath" after the denser How-It-Works/FAQ
// sections, and reuses the hero's solid-heading treatment so the page
// visually bookends itself (both headings dropped their gradient fade -
// a diagonal fade across a wrapping headline read as "dull" at the tail end).
// Its copy is deliberately a different rhetorical move from the hero's,
// not just different words for the same one - the hero states the solution
// as a punchy imperative ("Stop re-reading. Start recalling."), so a second
// imperative down here read as pure repetition. This one leads with the
// uncomfortable, research-backed problem (the Ebbinghaus forgetting curve -
// see the FAQ's own "research-backed" claim) before naming the fix, which is
// a distinct AIDA-style close instead of an echo.
function FinalCtaSection() {
  return (
    <section
      aria-labelledby="final-cta-heading"
      className="relative z-10 mx-auto w-full max-w-3xl px-6 py-24 text-center sm:py-32"
    >
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute left-1/2 top-1/2 h-[28rem] w-[28rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground/5 blur-3xl" />
      </div>
      <motion.h2
        {...reveal()}
        id="final-cta-heading"
        className="pb-2 font-sans text-3xl font-bold leading-tight tracking-tight text-foreground [text-wrap:balance] sm:text-5xl"
      >
        You&apos;ll forget most of this by tomorrow.
      </motion.h2>
      <motion.p
        {...reveal(0.05)}
        className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-muted-foreground [text-wrap:balance] sm:text-lg"
      >
        That&apos;s the forgetting curve talking, not a guess. FlowRecall&apos;s
        active-recall feed is built to beat it.
      </motion.p>
      <motion.div
        {...reveal(0.1)}
        className="mt-10 flex flex-col items-center gap-3 sm:flex-row sm:justify-center"
      >
        <Link
          href="/pricing"
          className="w-full max-w-xs rounded-full border border-border bg-transparent px-6 py-3.5 text-center text-base font-medium text-foreground backdrop-blur-md transition-all duration-200 hover:scale-[1.03] hover:bg-foreground/5 active:scale-[0.97] sm:w-auto sm:max-w-none sm:py-3 sm:text-sm"
        >
          View Pro Plans
        </Link>
        <Link
          href="/ingest"
          className="w-full max-w-xs rounded-full bg-accent px-6 py-3.5 text-center text-base font-semibold text-accent-foreground ring-1 ring-inset ring-accent/30 shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_8px_28px_-6px_rgba(0,0,0,0.45)] transition-all duration-200 hover:bg-accent/90 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_12px_40px_-6px_rgba(0,0,0,0.55)] hover:scale-[1.03] active:scale-[0.97] sm:w-auto sm:max-w-none sm:py-3 sm:text-sm"
        >
          Start ingesting notes
        </Link>
      </motion.div>
    </section>
  );
}

// The page had no footer at all - kept local to page.tsx (not a shared
// component) since this is a home-page-only fix, not a site-wide footer.
function SiteFooter() {
  return (
    <footer className="relative z-10 mx-auto w-full max-w-6xl border-t border-border px-6 py-10 sm:py-12">
      <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col items-center gap-2 sm:items-start">
          <div className="flex items-center gap-2">
            <div className="relative flex h-7 w-7 items-center justify-center overflow-hidden rounded-[28%] bg-gradient-to-br from-zinc-800 to-zinc-950 text-white">
              <LogoMark sheen className="h-[64%] w-[64%]" />
            </div>
            <span className="font-retro text-lg text-foreground">FlowRecall</span>
          </div>
          <p className="text-xs text-muted-foreground">AI flashcards for active recall.</p>
        </div>
        <nav className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-muted-foreground">
          <Link href="/ingest" className="transition-colors hover:text-foreground">
            Ingest
          </Link>
          <Link href="/reader" className="transition-colors hover:text-foreground">
            Reader
          </Link>
          <Link href="/pricing" className="transition-colors hover:text-foreground">
            Pricing
          </Link>
          <Link href="/privacy" className="transition-colors hover:text-foreground">
            Privacy
          </Link>
        </nav>
      </div>
      <p className="mt-8 text-center text-xs text-muted-foreground sm:text-left">
        © {new Date().getFullYear()} FlowRecall
      </p>
    </footer>
  );
}

export default function Home() {
  const router = useRouter();
  const decks = useSavedDecks();
  // Navbar.tsx hides itself entirely on native (MobileTabBar is its only
  // chrome) - the hero's min-h-[88vh]/justify-center centering was tuned for
  // the web layout, where that floating navbar above it justifies some
  // space. With nothing above it on native, the same centering leaves a
  // large dead zone under the status bar instead of anchoring near the top.
  const isNative = useIsNative();

  const [generatingDeckIds, setGeneratingDeckIds] = useState<Set<string>>(new Set());
  const [jitErrors, setJitErrors] = useState<Record<string, string>>({});
  // What each in-flight continuation is doing, keyed by deck id. "Generating..."
  // for four chunks with a rate-limit wait inside it is up to a minute of a button
  // that looks stuck; this says which part, and what it is waiting for.
  const [jitProgress, setJitProgress] = useState<Record<string, string>>({});

  function handleStudyNow(deck: Deck, isFullyMastered: boolean) {
    // A 100%-mastered session resuming normally would hydrate a queue with
    // nothing left to answer and dump the user straight at the completion
    // slide - clear it so "Review Again" actually starts a fresh pass.
    if (isFullyMastered) {
      clearProgress(deck.id);
    }
    setStudyDeck(deck.id, deck.concepts);
    // Marks the route change (and /study's heavier initial render) as a low
    // priority transition, so the button's own tap feedback isn't blocked
    // waiting for that render to commit - see PageTransition.tsx.
    startTransition(() => {
      router.push("/study");
    });
  }

  /** Same sessionStorage handoff `/study` uses, so the revision sheet needs no
   * dynamic route - which `output: "export"` could not build for localStorage
   * deck ids anyway. */
  function handleRead(deck: Deck) {
    setStudyDeck(deck.id, deck.concepts);
    startTransition(() => {
      router.push("/revise");
    });
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

    try {
      // Sequential, retried, and paced by runChunks - the same runner /ingest
      // uses, so a 429 here costs one chunk's wait rather than the batch. It also
      // never throws, which is what lets a partial batch be kept below.
      //
      // countsFirstChunk: false - this is continuing a deck the user already
      // spent one of their monthly generations on, not starting a new one.
      // Without it the server's allowance gate (which only checks on a first
      // chunk) treats an unmarked request as a first chunk and wrongly re-blocks
      // a free user mid-way through their own already-started deck.
      //
      // model: deck.model - without this an unset model falls back to the free
      // model server-side regardless of plan, silently downgrading a Pro user's
      // continuation chunks to the cheap model they didn't pick.
      const run = await runChunks(batch, {
        model: deck.model,
        countsFirstChunk: false,
        onProgress: ({ current, total, waitingReason }) => {
          setJitProgress((prev) => ({
            ...prev,
            [deck.id]: waitingReason ?? `Generating part ${current} of ${total}...`,
          }));
        },
      });

      // Keep what succeeded even when a later chunk did not. Those cards cost real
      // tokens and are already paid for; discarding them and leaving their text in
      // pendingChunks means the next tap regenerates - and re-pays for - work that
      // has already been done. Requeue only from the chunk that actually failed.
      if (run.concepts.length > 0) {
        appendConceptsToDeck(deck.id, run.concepts, [
          ...batch.slice(run.failedAtIndex),
          ...remaining,
        ]);
      }
      const failure = run.error;
      if (failure) {
        const kept = run.concepts.length;
        setJitErrors((prev) => ({
          ...prev,
          [deck.id]: kept
            ? `${failure} We kept the ${kept} cards that did come through - tap again to carry on.`
            : failure,
        }));
      }
    } catch (err) {
      setJitErrors((prev) => ({
        ...prev,
        [deck.id]: err instanceof Error ? err.message : "Something went wrong.",
      }));
    } finally {
      setJitProgress((prev) => {
        const next = { ...prev };
        delete next[deck.id];
        return next;
      });
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
        className={`relative flex flex-col items-center overflow-hidden px-6 text-center ${
          isNative ? "justify-start pt-6 pb-8" : "min-h-[88vh] justify-center py-16 sm:py-24"
        }`}
      >
        {/* Hero decoration (grid + glow orbs) is web-only. Both were tuned
          for web's tall min-h-[88vh] hero; on native's short, narrow
          content-fit box (no min-height) they don't scale down cleanly -
          the grid's radial fade compresses into a visibly gridded patch,
          and with that gone the bottom-right glow orb (positioned right
          near the CTA buttons) stands out on its own as an isolated grey
          blob instead of blending into a wash. Rather than keep chasing
          individual artifacts, native gets a flat, pure black hero
          background instead - confirmed live on-device as the preferred
          look. Web/desktop keeps the full effect unchanged, where the
          taller hero gives it room to actually work. */}
      {!isNative && (
        <>
          {/* Faded spotlight grid - a fine ruled pattern masked with a radial
            gradient so it dissolves into darkness at the edges, leaving a
            subtle lit "stage" behind the hero copy. */}
          <div className="pointer-events-none absolute inset-0 -z-10 bg-[linear-gradient(to_right,hsl(var(--foreground)/0.03)_1px,transparent_1px),linear-gradient(to_bottom,hsl(var(--foreground)/0.03)_1px,transparent_1px)] bg-[size:3rem_3rem] [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_70%)]" />

          {/* Ambient glow orbs - purely decorative, blurred color washes that
            sit behind the hero to give the page depth. pointer-events-none
            and -z-10 keep them clear of the marquee, cards, and interactive
            content. */}
          <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
            <div className="absolute -top-40 left-1/2 h-72 w-72 -translate-x-1/2 rounded-full bg-foreground/5 blur-3xl md:h-[38rem] md:w-[38rem]" />
            <div className="absolute top-1/3 -left-32 hidden h-[30rem] w-[30rem] rounded-full bg-foreground/[0.03] blur-3xl md:block" />
            <div className="absolute -bottom-24 right-[-8rem] h-64 w-64 rounded-full bg-foreground/5 blur-3xl md:h-[32rem] md:w-[32rem]" />
          </div>
        </>
      )}

      {/* Cinematic film grain - a fixed, whisper-faint noise texture over the
          whole viewport for a physical, filmic surface. A static background-
          image at 3% opacity, no filter/blur animation - negligible cost on
          any device, so it's no longer gated to desktop only. */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-0 opacity-[0.03]"
        style={{ backgroundImage: NOISE_BACKGROUND }}
      />

        <div className="relative z-10 flex w-full flex-col items-center">
        <motion.p
          initial={{ opacity: 0, y: -24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={SNAP}
          className="mb-5 inline-flex items-center gap-1.5 sm:gap-2 rounded-full border border-border bg-foreground/5 px-3 py-1 sm:px-4 sm:py-1.5 text-[10px] sm:text-xs font-medium uppercase tracking-widest text-foreground backdrop-blur-md"
        >
          <span className="h-1.5 w-1.5 rounded-full bg-pulse-accent shadow-[0_0_8px_2px_hsl(var(--pulse-accent)/0.6)]" />
          Active recall, disguised as doomscrolling
        </motion.p>
        <motion.h1
          initial={{ opacity: 0, y: 32 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...SNAP, delay: 0.05 }}
          id="hero-heading"
          className={`max-w-2xl pb-2 font-sans text-4xl sm:text-5xl font-bold leading-tight tracking-tight text-foreground [text-wrap:balance] md:text-7xl ${
            isNative ? "mt-12" : ""
          }`}
        >
          Stop re-reading. Start recalling.
        </motion.h1>
        <motion.p
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...SNAP, delay: 0.1 }}
          className="mt-5 w-full max-w-xl text-lg leading-relaxed text-muted-foreground [text-wrap:balance] sm:text-xl"
        >
          Upload your first PDF and see your first flashcard feed in under a
          minute. No credit card required.
        </motion.p>
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...SNAP, delay: 0.15 }}
          className="mt-8 flex w-full max-w-xs flex-col gap-3 sm:w-auto sm:max-w-none sm:flex-row"
        >
          {/* Secondary CTA - minimalist glassmorphic outline. */}
          <Link
            href="/pricing"
            className="w-full rounded-full border border-border bg-transparent px-6 py-3.5 text-center text-base font-medium text-foreground backdrop-blur-md transition-all duration-200 hover:scale-[1.03] hover:bg-foreground/5 active:scale-[0.97] sm:w-auto sm:py-3 sm:text-sm"
          >
            View Pro Plans
          </Link>
          {/* Primary CTA - Electric Azure: the single accent, a vertical blue
              gradient with an inset top highlight and an ambient glow that
              intensifies on hover so it reads as raised and unmistakably clickable. */}
          <Link
            href="/ingest"
            className="w-full rounded-full bg-accent px-6 py-3.5 text-center text-base font-semibold text-accent-foreground ring-1 ring-inset ring-accent/30 shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_8px_28px_-6px_rgba(0,0,0,0.45)] transition-all duration-200 hover:bg-accent/90 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_12px_40px_-6px_rgba(0,0,0,0.55)] hover:scale-[1.03] active:scale-[0.97] sm:w-auto sm:py-3 sm:text-sm"
          >
            Start ingesting notes
          </Link>
        </motion.div>

        {/* The engine's answer to "what should I study?", above the grid that asks
            the student to decide. Renders nothing when signed out or when there is
            no memory to schedule against yet. */}
        <TodaySession decks={decks} />

        {/* What they will still know later, under what to do tonight. Deliberately
            second: the session offer is the action, and this is the reason it is
            worth taking - a number that only moves because they took it. */}
        <MemoryOverview decks={decks} />

        {decks.length > 0 && (
          <section aria-labelledby="library-heading" className="mt-16 w-full max-w-4xl">
            <h2
              id="library-heading"
              className="text-left text-lg font-semibold tracking-tight text-foreground sm:text-xl"
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
                    className="group relative flex flex-col rounded-2xl border border-border bg-surface/60 p-5 text-left shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] md:backdrop-blur-xl transition-transform hover:-translate-y-0.5"
                  >
                    <button
                      type="button"
                      onClick={(event) => handleDelete(deck.id, event)}
                      aria-label="Delete deck"
                      className="absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-full text-lg leading-none text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
                    >
                      &times;
                    </button>
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      {formatDate(deck.createdAt)}
                    </p>
                    <h3 className="mt-1 truncate pr-6 text-lg font-semibold text-foreground">
                      {deck.title}
                    </h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {deck.concepts.length} concept{deck.concepts.length === 1 ? "" : "s"}
                    </p>

                    {progress && (
                      <div className="mt-3">
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-foreground/10">
                          <div
                            className="h-full bg-accent transition-all"
                            style={{ width: `${pct * 100}%` }}
                          />
                        </div>
                        <p className="mt-1.5 text-xs text-muted-foreground">
                          {masteredCount}/{deck.concepts.length} mastered
                        </p>
                      </div>
                    )}

                    <div className="mt-4 flex gap-2">
                      <button
                        type="button"
                        onClick={() => handleStudyNow(deck, isFullyMastered)}
                        className="flex-1 rounded-full bg-accent ring-1 ring-inset ring-accent/30 shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_8px_24px_-6px_rgba(0,0,0,0.4)] px-4 py-2.5 text-sm font-medium text-accent-foreground transition-all duration-200 hover:bg-accent/90 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_10px_32px_-6px_rgba(0,0,0,0.5)] active:scale-[0.98]"
                      >
                        {buttonLabel}
                      </button>
                      {/* The deck as material rather than as a test. Every concept
                          already carries a full explanation paragraph that was only
                          ever reachable one card at a time, after answering it. */}
                      <button
                        type="button"
                        onClick={() => handleRead(deck)}
                        className="rounded-full border border-border bg-foreground/5 px-4 py-2.5 text-sm font-medium text-foreground transition-all duration-200 hover:bg-foreground/10 active:scale-[0.98]"
                      >
                        Read
                      </button>
                    </div>

                    {/* When the paper is. Not a label - inside three weeks it lifts this
                        deck's retention floor to 0.95, so every interval in it shortens
                        and the home projection anchors to a real date. */}
                    <DeckExamDate deck={deck} />

                    {deck.pendingChunks && deck.pendingChunks.length > 0 && (
                      <>
                        <button
                          type="button"
                          onClick={() => handleGenerateNextSection(deck)}
                          disabled={generatingDeckIds.has(deck.id)}
                          className="mt-2 rounded-full border border-border bg-transparent px-4 py-2.5 text-sm font-medium text-foreground transition-all duration-200 hover:bg-foreground/10 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {generatingDeckIds.has(deck.id)
                            ? jitProgress[deck.id] ?? "Generating..."
                            : `Generate Next Section (${deck.pendingChunks.length} chunks left)`}
                        </button>
                        {jitErrors[deck.id] && (
                          <p className="mt-2 text-xs text-muted-foreground">{jitErrors[deck.id]}</p>
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

      {/* ======================= HOW IT WORKS ========================== */}
      <HowItWorksSection />

      {/* ============================= FAQ ============================ */}
      <FaqSection />

      {/* ========================== FINAL CTA ========================== */}
      <FinalCtaSection />

      {/* ============================ FOOTER ============================ */}
      <SiteFooter />
    </main>
  );
}
