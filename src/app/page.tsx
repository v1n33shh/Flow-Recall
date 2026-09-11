"use client";

import { useEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";
import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";
import { getFactCursor, setFactCursor, useSavedDecks } from "@/lib/storage";
import { factAt, nextCursor } from "@/lib/brainFacts";
import { useIsNative } from "@/lib/useIsNative";
import { useHomeProjection } from "@/lib/useHomeProjection";
import { asPercent, CURVE } from "@/lib/forgettingCurve";
import LogoMark from "@/components/LogoMark";
import FilmGrain from "@/components/FilmGrain";
import ExamCountdown from "@/components/ExamCountdown";
import HomeHeroNumber from "@/components/HomeHeroNumber";
import MemoryOverview from "@/components/MemoryOverview";
import RetentionCurve from "@/components/RetentionCurve";
import TodaySession from "@/components/TodaySession";

// A harsh, high-stiffness/low-damping spring so elements snap aggressively
// into place instead of gently fading in - used for every entrance below.
const SNAP = { type: "spring" as const, stiffness: 700, damping: 18 };

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
    "FlowRecall turns any PDF into AI-generated active-recall cards and schedules them with FSRS-6. It also reads your EPUBs and PDFs with any word defined in place, and maps how a deck's concepts depend on each other. Built for college and medical students.",
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "USD",
  },
  // Kept in step with the feature grid below. Every line here is a surface that
  // actually exists - the list was three releases out of date, which is how the
  // reader, the library and the mindmap ended up invisible to both crawlers and
  // students.
  featureList: [
    "PDF and pasted notes to AI-generated flashcards",
    "Active-recall study feed with swipe and type-from-memory formats",
    "FSRS-6 spaced repetition scheduling, on-device and offline",
    "Retention projection - what you will still recall on exam day",
    "EPUB, PDF and plain-text reader with in-place word definitions",
    "Highlights that carry notes, and a warm eye filter for night reading",
    "Concept mindmap of prerequisites, explanations and easily-confused pairs",
    "Deck library with search across titles and concept labels",
    "Explain-it-back grading in your own words",
    "Gamified streaks and daily study sessions",
  ],
  screenshot: `${SITE_URL}/og.png`,
  publisher: {
    "@type": "Organization",
    name: "FlowRecall",
    url: SITE_URL,
  },
};

// ---------------------------------------------------------------------------
// Landing-page marketing sections (SEO + conversion). Kept as module-level
// components with no client state, so they server-render into the initial HTML
// where crawlers and rich-result parsers can read them on first fetch.
//
// Module-level is also a lint requirement, not only a preference:
// react-hooks/static-components is an ERROR in this repo, so none of these may
// be defined inside another component's render body.
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
    q: "What spaced repetition algorithm does FlowRecall use?",
    a: "FSRS-6 — the Free Spaced Repetition Scheduler — ported from its published specification rather than approximated. It keeps a stability and a difficulty for every concept, and schedules the next review for the day your recall is predicted to fall to 90%. It runs on your device, so the feed works offline.",
  },
  {
    q: "Can I read books and PDFs inside FlowRecall?",
    a: "Yes. The Reader opens EPUBs, PDFs and pasted text, remembers your place in each, and lets you long-press any word for a definition without leaving the page. Highlights carry notes, type is serif, sans or hyperlegible, and a warm eye filter takes the glare off late-night reading.",
  },
  {
    q: "What is the concept mindmap for?",
    a: "Isolated facts are harder to retrieve than connected ones. The mindmap draws a deck as a graph — what you need first, what explains what, which pairs get confused — and names the keystone: the weak concept the most others are built on.",
  },
  {
    q: "Is FlowRecall better than Anki for med school?",
    a: "FlowRecall skips Anki's biggest cost: building the deck by hand. Upload your material and FlowRecall's AI writes the flashcards for you in seconds, then serves them as a gamified active-recall feed instead of a static list. For medical students juggling huge volumes of content, that means hours saved on deck-building and more time spent actually reviewing.",
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

/** The mechanism a card implements, named above its own headline.
 *
 * This is the whole editorial move of the feature grid: every surface in this app exists
 * because of a specific, checkable finding about memory, and saying which one converts a
 * feature list into an argument. Mono and tiny on purpose - it should read as a citation,
 * not as a second headline competing with the real one. */
function Effect({ children }: { children: ReactNode }) {
  return (
    <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70">
      {children}
    </p>
  );
}

// ---------------------------------------------------------------------------
// THE FACT
// ---------------------------------------------------------------------------

const subscribeNever = () => () => {};

/** True only after hydration. useSyncExternalStore rather than useState+useEffect
 * because `react-hooks/set-state-in-effect` is an error in this repo - same shape as
 * src/app/library/page.tsx, which the same rule pushed here first. */
function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );
}

/** One true thing about the brain, different every visit.
 *
 * These are the fourteen unattributed, source-checked lines in src/lib/brainFacts.ts,
 * and they share ONE cursor with the library header - so a student who opens both
 * screens meets two different facts, and meets all fourteen before meeting any twice.
 *
 * This is the page's neuroscience, and it is deliberately the shortest section on it:
 * a single sentence with air around it, no eyebrow, no attribution, no explanation
 * underneath. A paragraph here would defeat the point of the whole rewrite.
 *
 * Renders on native too - it is the one piece of the marketing page worth keeping on
 * a screen a student opens every day, because it changes. */
function BrainFactSection() {
  const hydrated = useHydrated();
  const reduceMotion = useReducedMotion();
  // No tab-bar padding here, deliberately, and it was wrong when I first added it:
  // PageTransition's native scroll container is already sized to EXCLUDE the tab-bar
  // zone (MobileTabBar's in-flow spacer carves --tabbar-h out of the flex-1 slot), so
  // a second --tabbar-h of padding on the last section double-counts it and pushes the
  // final line of a three-line fact underneath the bar.
  // Read once, advance for next time. Not held in state: nothing re-renders because
  // of it, and writing state from an effect is a lint error here.
  const factCursor = useMemo(() => getFactCursor(), []);
  useEffect(() => {
    setFactCursor(nextCursor(factCursor));
  }, [factCursor]);

  // min-h reserves the line's space before hydration fills it, so the swap-in costs no
  // layout shift - the "Zero Layout Shift" rule this page is held to. 11rem is not a
  // round number: the longest fact in the set wraps to three lines at 360dp (84px) and
  // py-10 adds 80, so 176px holds every fact at every length and the box never changes
  // size. The mobile padding is half the desktop figure because this is the LAST section
  // on native - at py-16 a three-line fact pushed 7px past the scroll container and had
  // to be scrolled to reach.
  return (
    <section
      aria-label="About memory"
      className="relative z-10 mx-auto flex min-h-[11rem] w-full max-w-3xl items-center justify-center px-6 py-10 sm:min-h-[15rem] sm:py-24"
    >
      {hydrated && (
        <motion.p
          initial={reduceMotion ? false : { opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ type: "spring", stiffness: 120, damping: 20 }}
          className="text-center font-sans text-xl font-medium leading-snug tracking-tight text-foreground/90 [text-wrap:balance] sm:text-2xl md:text-3xl"
        >
          {factAt(factCursor)}
        </motion.p>
      )}
    </section>
  );
}

// Shared card chrome: theme-adaptive glass, hairline ring, inset highlight.
const CARD =
  "group relative flex flex-col overflow-hidden rounded-3xl bg-surface/60 p-8 ring-1 ring-inset ring-border shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] md:backdrop-blur-xl transition-colors duration-300 hover:ring-foreground/20";

// ---------------------------------------------------------------------------
// THE CURVE
// ---------------------------------------------------------------------------

/** The gaps the scheduler chose between reviews, in whole days: 2 -> 12 -> 50.
 *
 * Derived from CURVE rather than typed out, so the prose beside the chart can never end up
 * quoting numbers the chart is no longer drawing. */
const REVIEW_GAPS = CURVE.reviews.map((review, i) =>
  Math.round(review.day - (i === 0 ? 0 : CURVE.reviews[i - 1].day)),
);

/** The page's evidence, computed instead of claimed.
 *
 * The closing CTA has named the forgetting curve for months with nothing behind it, while
 * src/lib/fsrs.ts sat in the repo able to draw the real one. Both lines here come out of
 * that file at build time - see src/lib/forgettingCurve.ts.
 *
 * Its own section rather than part of the hero: the native hero is a compact action centre
 * (TodaySession/MemoryOverview) and a chart wedged into it would push the one thing a
 * returning student opens the app for below the fold. */
function CurveSection() {
  const isNative = useIsNative();
  return (
    <section
      aria-labelledby="curve-heading"
      className={`relative z-10 mx-auto w-full max-w-5xl px-6 ${
        isNative ? "pt-4 pb-14" : "py-20 sm:py-28"
      }`}
    >
      <motion.div {...reveal()} className="mx-auto max-w-2xl text-center">
        <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-border bg-foreground/5 px-4 py-1.5 text-xs font-medium uppercase tracking-widest text-foreground md:backdrop-blur-md">
          <span className="h-1.5 w-1.5 rounded-full bg-pulse-accent shadow-[0_0_8px_2px_hsl(var(--pulse-accent)/0.6)]" />
          The forgetting curve
        </p>
        <h2
          id="curve-heading"
          className="font-sans text-3xl font-semibold leading-tight tracking-tight text-foreground [text-wrap:balance] sm:text-5xl"
        >
          Three reviews in six months.{" "}
          <span className="whitespace-nowrap">
            {asPercent(CURVE.endRecall.reviewed)}% instead of{" "}
            {asPercent(CURVE.endRecall.studiedOnce)}%.
          </span>
        </h2>
        <p className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-muted-foreground [text-wrap:balance] sm:text-lg">
          Plotted by the scheduler itself, not drawn.
        </p>
      </motion.div>

      <motion.figure
        {...reveal(0.08)}
        className="mt-12 overflow-hidden rounded-3xl bg-surface/60 p-5 ring-1 ring-inset ring-border shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] md:backdrop-blur-xl sm:mt-14 sm:p-9"
      >
        <figcaption className="mb-6 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-muted-foreground sm:text-sm">
          <span className="flex items-center gap-2">
            <span className="h-[3px] w-6 rounded-full bg-foreground" />
            Reviewed when FlowRecall asks
          </span>
          <span className="flex items-center gap-2">
            <span className="h-[3px] w-6 rounded-full bg-foreground/25" />
            Studied once, never opened again
          </span>
        </figcaption>

        <RetentionCurve />

        <p className="mt-7 border-t border-border pt-5 text-xs text-muted-foreground sm:text-sm">
          Dashed line: 90% recall — where the next review lands.
        </p>
      </motion.figure>

      {/* The spacing effect, as three numbers. Each gap is roughly four times the last,
          and that is not a drawing decision - it falls out of the scheduler's own
          stability term (see src/lib/fsrs.ts's stabilityAfterRecall). */}
      <motion.div {...reveal(0.16)} className="mt-10 sm:mt-12">
        <p className="text-center text-xs font-medium uppercase tracking-widest text-muted-foreground">
          The gap it chose between reviews
        </p>
        <div className="mt-5 flex items-center justify-center gap-2 sm:gap-4">
          {REVIEW_GAPS.map((gap, i) => (
            <div key={`gap-${i}`} className="flex items-center gap-2 sm:gap-4">
              {i > 0 && (
                <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4 shrink-0 text-muted-foreground/50" aria-hidden="true">
                  <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
              <div className="rounded-2xl border border-border bg-foreground/[0.03] px-4 py-3 text-center sm:px-6">
                <div className="font-sans text-2xl font-semibold tabular-nums leading-none text-foreground sm:text-3xl">
                  {gap}
                </div>
                <div className="mt-1.5 text-[10px] uppercase tracking-widest text-muted-foreground sm:text-xs">
                  {gap === 1 ? "day" : "days"}
                </div>
              </div>
            </div>
          ))}
        </div>
      </motion.div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// FEATURES
// ---------------------------------------------------------------------------

function FeaturesSection() {
  // Only the top gap (which abuts the previous section's own bottom padding)
  // needs shrinking on native - the two combined otherwise leave up to ~160px
  // of dead space before "Why FlowRecall" even starts. Bottom/desktop spacing
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
          className="font-sans text-3xl font-semibold leading-tight tracking-tight text-foreground [text-wrap:balance] sm:text-5xl"
        >
          Every screen is one finding about memory, built.
        </h2>
        <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-muted-foreground [text-wrap:balance] sm:text-lg">
          Not a flashcard app with the science in the marketing copy. The mechanism each
          surface is built on is named on the card.
        </p>
      </motion.div>

      <div className="mt-14 grid grid-cols-1 gap-4 sm:mt-16 sm:grid-cols-2 lg:grid-cols-3">
        {/* Flagship — ingest into the recall feed — spans the tall left block. */}
        <motion.article
          {...reveal(0)}
          className={`${CARD} justify-between sm:col-span-2 lg:flex-row lg:items-start lg:gap-8`}
        >
          {/* The one soft ambient wash on the page. Achromatic: --accent has been pure
              white/black since the monochrome migration, not the blue an older comment
              here used to claim. */}
          <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-accent/[0.07] blur-3xl" />
          <div className="relative">
            <Effect>The testing effect</Effect>
            <FeatureIcon>
              <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden="true">
                <path d="M13 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9l-6-6Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
                <path d="M13 3v6h6" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
              </svg>
            </FeatureIcon>
            <h3 className="mt-6 font-sans text-xl font-semibold leading-snug tracking-tight text-foreground sm:text-2xl">
              Answer it before you&apos;re told
            </h3>
            <p className="mt-3 max-w-sm text-sm leading-relaxed text-muted-foreground sm:text-base">
              Drop a PDF in. Swipe a claim true or false — then type it back from memory.
            </p>
          </div>
          {/* CSS-only monochrome mock: one page of source becoming the two things the
              copy above promises - a claim to judge, then a blank to fill from memory.
              Sized to fill this card's tall block rather than leaving the 2x2 flagship
              with a bottom-anchored strip and 250px of dead middle. */}
          <div className="relative mt-10 flex min-h-[13rem] flex-1 items-stretch gap-4 lg:mt-0" aria-hidden="true">
            <div className="flex w-16 shrink-0 flex-col rounded-lg border border-border bg-foreground/[0.03] p-2.5 sm:w-24">
              <div className="h-1.5 w-3/4 rounded bg-foreground/15" />
              <div className="mt-2 h-1.5 w-full rounded bg-foreground/10" />
              <div className="mt-1.5 h-1.5 w-5/6 rounded bg-foreground/10" />
              <div className="mt-1.5 h-1.5 w-full rounded bg-foreground/10" />
              <div className="mt-1.5 h-1.5 w-2/3 rounded bg-foreground/10" />
              <div className="mt-4 h-1.5 w-full rounded bg-foreground/10" />
              <div className="mt-1.5 h-1.5 w-4/5 rounded bg-foreground/10" />
              <div className="mt-auto pt-4 text-center text-[9px] uppercase tracking-widest text-muted-foreground/70">
                source
              </div>
            </div>
            <svg viewBox="0 0 24 24" fill="none" className="my-auto h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true">
              <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {/* min-w-0 throughout: a flex item defaults to min-width:auto, so without it
                this column refuses to shrink below its own min-content and pushes 38px
                past the card at 360dp - clipped rather than scrolling, which is the worst
                kind of bug because the page still looks fine in a width test. */}
            <div className="flex min-w-0 flex-1 flex-col justify-center gap-3">
              {/* Level 1 - recognise: a claim, and two ways to answer it. */}
              <div className="min-w-0 rounded-xl border border-border bg-surface/80 p-3 sm:p-3.5">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  True or false
                </div>
                <div className="mt-2.5 h-1.5 w-4/5 rounded bg-foreground/15" />
                <div className="mt-1.5 h-1.5 w-3/5 rounded bg-foreground/10" />
                <div className="mt-3 flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full border border-border">
                    <svg viewBox="0 0 24 24" fill="none" className="h-3 w-3 text-muted-foreground">
                      <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
                    </svg>
                  </span>
                  <span className="flex h-6 w-6 items-center justify-center rounded-full border border-foreground/60">
                    <svg viewBox="0 0 24 24" fill="none" className="h-3 w-3 text-foreground">
                      <path d="M5 12.5l4 4 10-10" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </span>
                </div>
              </div>
              {/* The two formats are not the same night. The harder one is scheduled for
                  when the memory has had time to decay, which is the point of the whole
                  chart above - so the mock says so rather than stacking them as a menu. */}
              <div className="flex items-center gap-3 py-1 pl-3">
                <span className="h-8 w-px bg-gradient-to-b from-border via-foreground/30 to-border" />
                <span className="text-[10px] uppercase tracking-widest text-muted-foreground/70">
                  days later
                </span>
              </div>
              {/* Level 2 - produce: nothing on screen to recognise. */}
              <div className="min-w-0 rounded-xl border border-border bg-surface/80 p-3 sm:p-3.5">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Type it from memory
                </div>
                {/* The blank is flex-1 rather than a fixed w-20 so it gives way first
                    when the card narrows, instead of forcing the row past the card edge. */}
                <div className="mt-2.5 flex items-center gap-1.5">
                  <span className="h-1.5 w-6 shrink-0 rounded bg-foreground/15" />
                  <span className="h-5 min-w-0 flex-1 rounded border border-dashed border-foreground/30 sm:max-w-[5rem]" />
                  <span className="h-1.5 w-4 shrink-0 rounded bg-foreground/15 sm:w-8" />
                </div>
                <div className="mt-2.5 h-1.5 w-1/2 rounded bg-foreground/10" />
              </div>
            </div>
          </div>
        </motion.article>

        {/* The scheduler. */}
        <motion.article {...reveal(0.06)} className={`${CARD} justify-between`}>
          <div>
            <Effect>Spaced retrieval</Effect>
            <FeatureIcon>
              <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden="true">
                <circle cx="12" cy="13" r="8" stroke="currentColor" strokeWidth="1.8" />
                <path d="M12 9.5V13l2.5 1.5M9 2.5h6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </FeatureIcon>
            <h3 className="mt-6 font-sans text-xl font-semibold leading-snug tracking-tight text-foreground">
              A date per memory, not a daily pile
            </h3>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground sm:text-base">
              FSRS-6 asks again on the day your recall is predicted to hit 90%.
            </p>
          </div>
          {/* Widening intervals, to scale with the real gaps above. */}
          <div className="mt-6 flex items-end gap-1.5" aria-hidden="true">
            {[8, 20, 46, 100].map((width, i) => (
              <span
                key={i}
                className="h-5 rounded bg-foreground/15"
                style={{ flexGrow: width }}
              />
            ))}
          </div>
        </motion.article>

        {/* The mindmap. */}
        <motion.article {...reveal(0.12)} className={`${CARD} justify-between`}>
          <div>
            <Effect>Relational encoding</Effect>
            <FeatureIcon>
              <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden="true">
                <circle cx="12" cy="4.5" r="2.5" stroke="currentColor" strokeWidth="1.8" />
                <circle cx="5.5" cy="18" r="2.5" stroke="currentColor" strokeWidth="1.8" />
                <circle cx="18.5" cy="18" r="2.5" stroke="currentColor" strokeWidth="1.8" />
                <path d="M10.3 6.6 7.2 15.6M13.7 6.6l3.1 9M8 18h8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </FeatureIcon>
            <h3 className="mt-6 font-sans text-xl font-semibold leading-snug tracking-tight text-foreground">
              See what holds the deck up
            </h3>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground sm:text-base">
              Needs, explains, easily confused — and the weak idea the others are built on.
            </p>
          </div>
          <div className="mt-6 flex flex-wrap gap-1.5 text-[10px] font-medium" aria-hidden="true">
            <span className="rounded-full border border-border px-2.5 py-1 text-muted-foreground">needs</span>
            <span className="rounded-full border border-border px-2.5 py-1 text-muted-foreground">explains</span>
            <span className="rounded-full border border-dashed border-border px-2.5 py-1 text-muted-foreground">vs</span>
          </div>
        </motion.article>

        {/* The reader. */}
        <motion.article {...reveal(0.18)} className={`${CARD} justify-between`}>
          <div>
            <Effect>Encoding in context</Effect>
            <FeatureIcon>
              <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden="true">
                <path d="M12 6.5S10 4.5 4.5 4.5V18c5.5 0 7.5 2 7.5 2s2-2 7.5-2V4.5C14 4.5 12 6.5 12 6.5Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
                <path d="M12 6.5v14" stroke="currentColor" strokeWidth="1.8" />
              </svg>
            </FeatureIcon>
            <h3 className="mt-6 font-sans text-xl font-semibold leading-snug tracking-tight text-foreground">
              Read it where it came from
            </h3>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground sm:text-base">
              EPUB, PDF, pasted text. Any word defined in place, without leaving the page.
            </p>
          </div>
          {/* A line of prose with one word looked up in place. */}
          <div className="mt-6 rounded-xl border border-border bg-foreground/[0.03] p-3" aria-hidden="true">
            <div className="h-1.5 w-full rounded bg-foreground/10" />
            <div className="mt-2 flex items-center gap-1.5">
              <span className="h-1.5 w-10 rounded bg-foreground/10" />
              <span className="rounded bg-reader-highlight/25 px-1.5 py-0.5 text-[10px] font-medium text-foreground">
                afferent
              </span>
              <span className="h-1.5 flex-1 rounded bg-foreground/10" />
            </div>
            <div className="mt-2 h-1.5 w-2/3 rounded bg-foreground/10" />
          </div>
        </motion.article>

        {/* Teach it back. */}
        <motion.article {...reveal(0.24)} className={`${CARD} justify-between`}>
          <div>
            <Effect>Production, not recognition</Effect>
            <FeatureIcon>
              <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden="true">
                <path d="M20 14.5a2.5 2.5 0 0 1-2.5 2.5H9l-5 4V5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v9Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
              </svg>
            </FeatureIcon>
            <h3 className="mt-6 font-sans text-xl font-semibold leading-snug tracking-tight text-foreground">
              Explain it back in your own words
            </h3>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground sm:text-base">
              Get back what you left out and what you had wrong. Never a score.
            </p>
          </div>
          <div className="mt-6 flex flex-col gap-1.5 text-xs text-muted-foreground" aria-hidden="true">
            {[
              { mark: "M5 12.5l4 4 10-10", label: "Got right" },
              { mark: "M5 12h14", label: "Left out" },
              { mark: "M6 6l12 12M18 6 6 18", label: "Had wrong" },
            ].map(({ mark, label }) => (
              <div key={label} className="flex items-center gap-2">
                <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5 shrink-0" aria-hidden="true">
                  <path d={mark} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span>{label}</span>
              </div>
            ))}
          </div>
        </motion.article>

        {/* The library. Deliberately the one card with a plain eyebrow rather than a
            borrowed effect name: it is a shelf, not a finding, and dressing it as one
            would be exactly the overclaim the rest of this section exists to avoid. */}
        <motion.article
          {...reveal(0.3)}
          className={`${CARD} justify-between`}
        >
          <div>
            <Effect>Your shelf</Effect>
            <FeatureIcon>
              <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden="true">
                <path d="M4 5.5h16M4 12h16M4 18.5h16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </FeatureIcon>
            <h3 className="mt-6 font-sans text-xl font-semibold leading-snug tracking-tight text-foreground">
              Every deck, still findable in March
            </h3>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground sm:text-base">
              Search titles and concepts, rename in place, undo a delete for six seconds.
            </p>
          </div>
          <div className="mt-6 flex items-center gap-2 rounded-xl border border-border bg-foreground/[0.03] px-3 py-2.5" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true">
              <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.8" />
              <path d="m16 16 4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
            <span className="h-1.5 w-24 rounded bg-foreground/15" />
            <span className="h-3.5 w-px animate-pulse bg-foreground/40" />
          </div>
        </motion.article>

        {/* Closing band. Full-width on purpose: spacing is the only finding on this page
            that the app cannot deliver on its own - it needs the student to come back -
            so the card that admits that gets the last word and its own row. */}
        <motion.article
          {...reveal(0.36)}
          className={`${CARD} lg:col-span-2 lg:flex-row lg:items-center lg:justify-between lg:gap-10`}
        >
          <div className="lg:max-w-2xl">
            <Effect>Showing up</Effect>
            <h3 className="mt-1 font-sans text-xl font-semibold leading-snug tracking-tight text-foreground sm:text-2xl">
              The part no scheduler can do
            </h3>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground sm:text-base">
              Ten, twenty or forty minutes, built from whatever is closest to slipping.
            </p>
          </div>
          {/* Mini streak calendar - echoes StreakModal.tsx's DayCell visual language and
              previews the real counter sitting in the navbar above. */}
          <div
            className="mt-6 flex shrink-0 items-center gap-1.5 lg:mt-0"
            aria-hidden="true"
          >
            {[true, true, true, true, true, false, false].map((filled, i) => (
              <span
                key={i}
                className={`h-6 w-6 rounded sm:h-7 sm:w-7 ${
                  filled ? "bg-accent" : "border border-border"
                }`}
              />
            ))}
          </div>
        </motion.article>
      </div>
    </section>
  );
}

const HOW_IT_WORKS_STEPS = [
  { n: "01", title: "Upload", body: "A PDF, or notes you paste in." },
  { n: "02", title: "Map", body: "See what depends on what." },
  { n: "03", title: "Recall", body: "Swipe, then type it from memory." },
  { n: "04", title: "Hold", body: "Watch the projection move." },
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
      <motion.div {...reveal()}>
        <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
          How it works
        </p>
        <h2
          id="how-it-works-heading"
          className="mt-3 max-w-xl font-sans text-3xl font-semibold leading-tight tracking-tight text-foreground [text-wrap:balance] sm:text-4xl"
        >
          From a PDF to still knowing it, in four steps.
        </h2>
      </motion.div>

      {/* Four across rather than the old sticky two-column stack: at six words a
          step, that layout was a 320px sidebar beside four short lines with 40px
          of air between them, which is how a section with 24 words of copy ended
          up as tall as the feature grid. */}
      <div className="mt-12 grid grid-cols-2 gap-x-6 gap-y-10 sm:mt-14 lg:grid-cols-4 lg:gap-x-8">
        {HOW_IT_WORKS_STEPS.map((step, i) => (
          <motion.div key={step.n} {...reveal(0.06 * i)} className="relative">
            {/* The one weight above 600 left in the app, and deliberately: at 6% opacity
                this is texture behind a heading, not type anybody reads. The "display
                never appears at 700/800" rule the rest of this file now follows is about
                type. */}
            <span
              aria-hidden="true"
              className="pointer-events-none absolute -left-1 -top-7 select-none font-sans text-6xl font-black leading-none text-foreground/[0.06] sm:text-7xl"
            >
              {step.n}
            </span>
            <div className="relative border-l border-border pl-4 sm:pl-5">
              <h3 className="text-base font-semibold text-foreground sm:text-lg">{step.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{step.body}</p>
            </div>
          </motion.div>
        ))}
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
        className="text-center font-sans text-3xl font-semibold leading-tight tracking-tight text-foreground sm:text-4xl"
      >
        Frequently asked questions
      </motion.h2>
      <motion.div
        {...reveal(0.05)}
        className="mt-10 divide-y divide-border rounded-3xl bg-surface/60 px-6 ring-1 ring-inset ring-border md:backdrop-blur-xl sm:mt-12 sm:px-8"
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
// uncomfortable, research-backed problem before naming the fix, which is a
// distinct AIDA-style close instead of an echo. It is no longer an assertion
// either: CurveSection above now draws the curve this paragraph names.
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
        className="pb-2 font-sans text-3xl font-semibold leading-tight tracking-tight text-foreground [text-wrap:balance] sm:text-5xl"
      >
        You&apos;ll forget most of this by tomorrow.
      </motion.h2>
      <motion.p
        {...reveal(0.05)}
        className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-muted-foreground [text-wrap:balance] sm:text-lg"
      >
        That&apos;s the curve above, not a guess.
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
          <Link href="/library" className="transition-colors hover:text-foreground">
            Library
          </Link>
          <Link href="/reader" className="transition-colors hover:text-foreground">
            Reader
          </Link>
          <Link href="/map" className="transition-colors hover:text-foreground">
            Mindmap
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
  const decks = useSavedDecks();
  // One read, shared by the two components that render the number. See useHomeProjection.
  const projection = useHomeProjection(decks);
  // Navbar.tsx hides itself entirely on native (MobileTabBar is its only
  // chrome) - the hero's min-h-[88vh]/justify-center centering was tuned for
  // the web layout, where that floating navbar above it justifies some
  // space. With nothing above it on native, the same centering leaves a
  // large dead zone under the status bar instead of anchoring near the top.
  const isNative = useIsNative();

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

          {/* Ambient glow orbs - purely decorative, blurred achromatic washes
            that sit behind the hero to give the page depth.
            pointer-events-none and -z-10 keep them clear of the cards and
            interactive content. */}
          <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
            <div className="absolute -top-40 left-1/2 h-72 w-72 -translate-x-1/2 rounded-full bg-foreground/5 blur-3xl md:h-[38rem] md:w-[38rem]" />
            <div className="absolute top-1/3 -left-32 hidden h-[30rem] w-[30rem] rounded-full bg-foreground/[0.03] blur-3xl md:block" />
            <div className="absolute -bottom-24 right-[-8rem] h-64 w-64 rounded-full bg-foreground/5 blur-3xl md:h-[32rem] md:w-[32rem]" />
          </div>
        </>
      )}

      <FilmGrain />

        <div className="relative z-10 flex w-full flex-col items-center">
        {/* THE PITCH - WEB ONLY. A badge, a headline and a subhead are how you introduce
            an app to a stranger; they are not how you open one somebody installed. On
            native the screen now leads with a number instead (see HomeHeroNumber and
            MemoryOverview), which is the readiness-dashboard shape: one figure, one
            action, nothing else competing for the top of the screen. */}
        {!isNative && (
          <>
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
              className={`max-w-2xl pb-2 font-sans text-4xl sm:text-5xl font-semibold leading-tight tracking-tight text-foreground [text-wrap:balance] md:text-7xl ${
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
              Upload a PDF. Read it, map it, and review it right before you&apos;d forget.
            </motion.p>
          </>
        )}
        {/* WEB ONLY. On native the primary action is now the hero's own button - study
            what is in front of you - and Ingest is one tap away in the tab bar. A
            returning student does not open a study app to be told to add more material. */}
        {!isNative && (
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...SNAP, delay: 0.15 }}
          className="mt-8 flex w-full max-w-xs flex-col gap-3 sm:w-auto sm:max-w-none sm:flex-row"
        >
          {/* Secondary CTA - minimalist glassmorphic outline. WEB ONLY: on the installed
              app this was the first thing a student met, above the button that actually
              does something, before they had made a single deck. Nobody should be sold a
              plan before they have used the free thing once. The web keeps it, because
              the web is where a purchase can actually happen (see Navbar's own note). */}
          {!isNative && (
            <Link
              href="/pricing"
              className="w-full rounded-full border border-border bg-transparent px-6 py-3.5 text-center text-base font-medium text-foreground backdrop-blur-md transition-all duration-200 hover:scale-[1.03] hover:bg-foreground/5 active:scale-[0.97] sm:w-auto sm:py-3 sm:text-sm"
            >
              View Pro Plans
            </Link>
          )}
          {/* Primary CTA - the achromatic accent token (brilliant white in dark
              mode, pitch black in light), which under "Pure Monochrome" is the
              only thing on the page allowed to pop. An inset top highlight and
              an ambient shadow that deepens on hover make it read as raised
              and unmistakably clickable without introducing a hue. */}
          <Link
            href="/ingest"
            className="w-full rounded-full bg-accent px-6 py-3.5 text-center text-base font-semibold text-accent-foreground ring-1 ring-inset ring-accent/30 shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_8px_28px_-6px_rgba(0,0,0,0.45)] transition-all duration-200 hover:bg-accent/90 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_12px_40px_-6px_rgba(0,0,0,0.55)] hover:scale-[1.03] active:scale-[0.97] sm:w-auto sm:py-3 sm:text-sm"
          >
            Start ingesting notes
          </Link>
        </motion.div>
        )}

        {/* THE DASHBOARD, in the order a student actually needs it.
            This used to run session-then-projection, both beneath a marketing hero, with
            the best number in the app at 30px and fourth on the screen. Reordered on the
            readiness-dashboard model: the stake, then the one figure, then the one action.

            1. How long until the paper. Needs no account and no history - just a deck
               with an exam date - so it is the only line here that can greet a student on
               their first evening.
            2. The number. MemoryOverview when the engine has a projection to make;
               HomeHeroNumber's honest smaller version when it does not. Exactly one of
               them renders - both read the same `hasProjection` so they cannot disagree. */}
        {/* THE APP'S ONLY FACE ON NATIVE.
            Navbar returns null here, the footer is web-only and MobileTabBar carries no
            brand, so a signed-in student saw the FlowRecall mark precisely nowhere - and
            cutting the badge and headline for the dashboard removed the last accidental
            trace of it. This is not a new pattern: Library, Mindmap, Reader and Ingest all
            open with a top-left title, and Home was the only tab without one.

            The chip is Navbar's, verbatim, so it reads as the same lockup rather than a
            second one - minus the hover transforms, since nothing here is a link. */}
        {isNative && (
          <div className="mb-10 flex w-full items-center gap-2 self-start">
            <div className="relative flex h-8 w-8 items-center justify-center overflow-hidden rounded-[28%] bg-gradient-to-br from-zinc-800 to-zinc-950 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]">
              <LogoMark sheen className="h-[64%] w-[64%]" />
              <div className="pointer-events-none absolute inset-0 rounded-[28%] ring-1 ring-inset ring-white/10" />
            </div>
            <span className="font-retro mt-0.5 text-lg text-foreground">FlowRecall</span>
          </div>
        )}

        <div className="mt-8 flex w-full flex-col items-center gap-6">
          {/* NATIVE ONLY, both of them. On the web these sit under a marketing hero that
              is already doing the job of a first impression, so a visitor got two heroes
              stacked - a headline telling them what the app is, and a dashboard telling
              them where they are in a deck they have never opened. The web keeps its
              landing page; the dashboard is what replaces one on the installed app. */}
          {isNative && (
            <>
              {/* Only when there is no projection. MemoryOverview's own eyebrow already
                  names the exam ("On exam day (11 days)") when it renders, so showing both
                  stacked two countdowns for the same date - which is how I found that they
                  were computing it differently and disagreeing by a day. */}
              {!projection.hasProjection && <ExamCountdown decks={decks} />}
              <HomeHeroNumber
                decks={decks}
                hasProjection={projection.hasProjection}
                signedIn={projection.signedIn}
              />
            </>
          )}
          {/* Web and native alike: a signed-in student with history should see their
              projection on either. */}
          <MemoryOverview overview={projection.overview} show={projection.hasProjection} />
          {/* 3. The action. Renders nothing signed out, which is why HomeHeroNumber
                 carries its own button. */}
          <TodaySession decks={decks} />
        </div>

        </div>
      </section>

      {/* ============================ THE FACT ========================= */}
      {/* The one piece of the page below the hero that native keeps: it is a
          single sentence, and it is different every time the app is opened. */}
      <BrainFactSection />

      {/* ======================= WEB-ONLY MARKETING ===================== */}
      {/* Everything below is the pitch, and an installed app is past being
          pitched to - a student who opens FlowRecall to study should not scroll
          a landing page to reach the end of their own home screen. Native stops
          at the fact above; MobileTabBar is the chrome from there, and Privacy
          stays reachable from the Account tab.

          Gated on the DEFAULT-FALSE useIsNative() on purpose, the same way the
          hero's grid and glow orbs already are. useIsNative<boolean|null>(null)
          would render none of this during the server/export pass, which would
          hide the entire marketing page - headings, FAQ, JSON-LD - from every
          crawler. Web renders it; native drops it a microtask after mount. */}
      {!isNative && (
        <>
          <CurveSection />
          <FeaturesSection />
          <HowItWorksSection />
          <FaqSection />
          <FinalCtaSection />
          <SiteFooter />
        </>
      )}
    </main>
  );
}
