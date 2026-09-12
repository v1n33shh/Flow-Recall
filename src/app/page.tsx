"use client";

import { useEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";
import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";
import { getFactCursor, setFactCursor, useSavedDecks } from "@/lib/storage";
import { factAt, nextCursor } from "@/lib/brainFacts";
import { useIsNative } from "@/lib/useIsNative";
import { asPercent, CURVE } from "@/lib/forgettingCurve";
import LogoMark from "@/components/LogoMark";
import FilmGrain from "@/components/FilmGrain";
import RetentionCurve from "@/components/RetentionCurve";
import TodaySession from "@/components/TodaySession";

// ---------------------------------------------------------------------------
// THE SHELL: A STACK OF OVERLAPPING GLASS SLABS ON PITCH BLACK
// ---------------------------------------------------------------------------
// Every word on this page is the copy that was here before. Nothing below is a
// rewrite of the argument - it is the same argument re-set, in the layout
// language a Cuberto/Locomotive-shaped site uses: a black ground, one static
// backlight, and a column of enormous rounded slabs that overlap by ~56px so
// the page reads as a deck of cards being dealt rather than as a scroll of
// stacked sections.
//
// WHY THE OVERLAP IS BUILT FROM MARGIN + Z-INDEX + ONE SHADOW, AND NOT FROM JS:
// each slab pulls up into its predecessor with a negative top margin, sits one
// step higher in z, and casts a shadow UPWARD (negative y-offset). That upward
// shadow is the whole trick - it darkens the slab beneath at the exact line
// where they meet, which is what turns two translucent panes into a legible
// layer order. It costs one paint. There is no scroll listener on this page.
//
// NO backdrop-blur ON THE SLABS, DELIBERATELY. The brief's recipe is
// `bg-white/[0.02] border border-white/10 rounded-[40px]` and it is right to
// stop there: a backdrop-filter is re-evaluated while the page scrolls, and
// seven full-viewport blurred panes is the single most reliable way to turn a
// smooth scroll into a slideshow on the cheap Android panels this ships to.
// Blur survives only on the small pills, which are a few hundred pixels each.
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// THE SLAB
// ---------------------------------------------------------------------------

/** One Bento slab: the recipe from the brief, plus the two things that make an
 * overlap read as an overlap rather than as a tinting accident.
 *
 * `z` climbs with each slab so later ones sit on top, and the upward shadow
 * (`0 -40px 80px -40px black`) lands on the slab behind at the seam. Both are
 * static - this page has no scroll handler and no JS-driven layering.
 *
 * The radius is 32px on a phone and the briefed 40px from `sm` up: 40px of
 * corner on a 360dp-wide slab eats into the first and last line of every
 * paragraph it contains, which is a rounding decision the copy pays for. */
function Bento({
  children,
  className = "",
  z,
  overlap = true,
}: {
  children: ReactNode;
  className?: string;
  z: number;
  overlap?: boolean;
}) {
  return (
    <div
      style={{ zIndex: z }}
      className={`relative mx-auto w-full max-w-[88rem] overflow-hidden rounded-[32px] border border-white/10 bg-white/[0.02] shadow-[0_-40px_80px_-40px_rgba(0,0,0,0.95)] sm:rounded-[40px] ${
        overlap ? "-mt-8 sm:-mt-14" : ""
      } ${className}`}
    >
      {children}
    </div>
  );
}

/** A key phrase, lifted out of a muted paragraph in pure white.
 *
 * The paragraphs on this page are set at `text-white/50` so the headings keep
 * the contrast, and this is how a long line still hands the eye the two or
 * three words worth carrying away from it. It is a span rather than <strong>
 * on purpose: this is a typographic emphasis, not a semantic one, and a screen
 * reader announcing "PDF" with stress adds nothing. */
function Hi({ children }: { children: ReactNode }) {
  return <span className="font-medium text-white">{children}</span>;
}

/** The page's ground: pitch black, one static silver backlight, and grain.
 *
 * TWO RADIAL GRADIENTS, PAINTED ONCE, NEVER ANIMATED. `fixed` rather than
 * absolute so the light stays put while the slabs travel past it - which is
 * what makes the stack look lit from a fixed source in the room rather than
 * carrying its own glow around with it.
 *
 * The grain is not decoration here. A gradient falling from 4% white to
 * nothing across most of a viewport spans roughly one 8-bit step, and without
 * a dither it bands into visible rings on exactly the panels this ships to. */
function Backlight() {
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 bg-black">
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            "radial-gradient(90% 55% at 50% -5%, rgba(255,255,255,0.075) 0%, rgba(255,255,255,0.03) 30%, rgba(255,255,255,0.008) 52%, transparent 70%)",
        }}
      />
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            "radial-gradient(70% 45% at 110% 62%, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.014) 34%, transparent 62%)",
        }}
      />
      <FilmGrain />
    </div>
  );
}

// Logo-matched icon tile: zinc gradient chip with an inset top highlight.
// Deliberately a fixed dark chip in both themes (like the Account avatar) -
// text-zinc-300 stays fixed too, since it's sized for that permanently-dark
// tile rather than the page background around it.
function FeatureIcon({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-gradient-to-br from-zinc-800 to-zinc-950 text-zinc-300 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
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
    <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.18em] text-white/40">
      {children}
    </p>
  );
}

/** The section eyebrow: a hairline glass pill. One of the two places on this
 * page still allowed a backdrop-filter, because it is 200px wide. */
function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-1.5 text-[10px] font-medium uppercase tracking-[0.2em] text-white/80 backdrop-blur-md sm:text-xs">
      <span className="h-1.5 w-1.5 rounded-full bg-white shadow-[0_0_10px_2px_rgba(255,255,255,0.55)]" />
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
 * These are the twenty-four unattributed, source-checked lines in src/lib/brainFacts.ts,
 * and they share ONE cursor with the library header - so a student who opens both
 * screens meets two different facts, and meets all twenty-four before meeting any twice.
 *
 * This is the page's neuroscience, and it is deliberately the shortest section on it:
 * a single sentence with air around it, no eyebrow, no attribution, no explanation
 * underneath. A paragraph here would defeat the point of the whole rewrite.
 *
 * Renders on native too - it is the one piece of the marketing page worth keeping on
 * a screen a student opens every day, because it changes.
 *
 * IT IS THE ONE SLAB SET IN SERIF, and that is the argument for the whole treatment:
 * this is the only sentence on the page nobody at FlowRecall wrote about FlowRecall.
 * Giving it a different voice is how a reader can tell at a glance that the page has
 * stopped selling for a moment. */
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
      className="relative mx-auto flex min-h-[11rem] w-full max-w-3xl items-center justify-center px-6 py-10 sm:min-h-[15rem] sm:py-24"
    >
      <p
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-6 -translate-x-1/2 select-none font-editorial text-[9rem] leading-none text-white/[0.05] sm:text-[13rem]"
      >
        &ldquo;
      </p>
      {hydrated && (
        <motion.p
          initial={reduceMotion ? false : { opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ type: "spring", stiffness: 120, damping: 20 }}
          className="relative text-center font-editorial text-2xl leading-[1.25] tracking-tight text-white/90 [text-wrap:balance] sm:text-4xl md:text-[2.75rem]"
        >
          {factAt(factCursor)}
        </motion.p>
      )}
    </section>
  );
}

// Shared card chrome inside the slabs: a lighter pane than the slab itself, so
// the nesting reads as depth rather than as a border drawn on a border.
const CARD =
  "group relative flex flex-col overflow-hidden rounded-3xl bg-white/[0.03] p-7 ring-1 ring-inset ring-white/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] transition-colors duration-300 hover:ring-white/25 sm:p-8";

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
      className={`relative mx-auto w-full max-w-5xl ${isNative ? "pt-2 pb-4" : ""}`}
    >
      <motion.div {...reveal()} className="mx-auto max-w-3xl text-center">
        <Eyebrow>The forgetting curve</Eyebrow>
        <h2
          id="curve-heading"
          className="font-sans text-[clamp(2.15rem,6.2vw,4.25rem)] font-semibold leading-[0.95] tracking-tighter text-white [text-wrap:balance]"
        >
          Three reviews in six months.{" "}
          <span className="whitespace-nowrap text-white/35">
            {asPercent(CURVE.endRecall.reviewed)}% instead of{" "}
            {asPercent(CURVE.endRecall.studiedOnce)}%.
          </span>
        </h2>
        <p className="mx-auto mt-6 max-w-xl text-base leading-relaxed text-white/50 [text-wrap:balance] sm:text-lg">
          <Hi>Plotted by the scheduler itself</Hi>, not drawn.
        </p>
      </motion.div>

      <motion.figure
        {...reveal(0.08)}
        className="mt-12 overflow-hidden rounded-[28px] bg-white/[0.03] p-5 ring-1 ring-inset ring-white/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] sm:mt-14 sm:p-9"
      >
        <figcaption className="mb-6 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-white/50 sm:text-sm">
          <span className="flex items-center gap-2">
            <span className="h-[3px] w-6 rounded-full bg-white" />
            Reviewed when FlowRecall asks
          </span>
          <span className="flex items-center gap-2">
            <span className="h-[3px] w-6 rounded-full bg-white/25" />
            Studied once, never opened again
          </span>
        </figcaption>

        <RetentionCurve />

        <p className="mt-7 border-t border-white/10 pt-5 text-xs text-white/50 sm:text-sm">
          Dashed line: 90% recall — where the next review lands.
        </p>
      </motion.figure>

      {/* The spacing effect, as three numbers. Each gap is roughly four times the last,
          and that is not a drawing decision - it falls out of the scheduler's own
          stability term (see src/lib/fsrs.ts's stabilityAfterRecall). */}
      <motion.div {...reveal(0.16)} className="mt-10 sm:mt-12">
        <p className="text-center font-mono text-[10px] uppercase tracking-[0.2em] text-white/40 sm:text-xs">
          The gap it chose between reviews
        </p>
        <div className="mt-6 flex items-center justify-center gap-2 sm:gap-4">
          {REVIEW_GAPS.map((gap, i) => (
            <div key={`gap-${i}`} className="flex items-center gap-2 sm:gap-4">
              {i > 0 && (
                <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4 shrink-0 text-white/30" aria-hidden="true">
                  <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-center sm:px-7 sm:py-4">
                <div className="font-sans text-[2rem] font-semibold tabular-nums leading-none tracking-tighter text-white sm:text-[2.75rem]">
                  {gap}
                </div>
                <div className="mt-2 text-[10px] uppercase tracking-[0.2em] text-white/40 sm:text-xs">
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
  return (
    <section aria-labelledby="features-heading" className="relative mx-auto w-full max-w-6xl">
      <motion.div {...reveal()} className="mx-auto max-w-3xl text-center">
        <Eyebrow>Why FlowRecall</Eyebrow>
        <h2
          id="features-heading"
          className="font-sans text-[clamp(2.15rem,6.2vw,4.25rem)] font-semibold leading-[0.95] tracking-tighter text-white [text-wrap:balance]"
        >
          Every screen is one finding about memory, built.
        </h2>
        <p className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-white/50 [text-wrap:balance] sm:text-lg">
          Not a flashcard app with the science in the marketing copy.{" "}
          <Hi>The mechanism each surface is built on is named on the card.</Hi>
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
          <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-white/[0.07] blur-3xl" />
          <div className="relative">
            <Effect>The testing effect</Effect>
            <FeatureIcon>
              <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden="true">
                <path d="M13 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9l-6-6Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
                <path d="M13 3v6h6" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
              </svg>
            </FeatureIcon>
            <h3 className="mt-6 font-sans text-2xl font-semibold leading-[1.05] tracking-tighter text-white sm:text-3xl">
              Answer it before you&apos;re told
            </h3>
            <p className="mt-4 max-w-sm text-sm leading-relaxed text-white/50 sm:text-base">
              Drop a PDF in. <Hi>Swipe a claim true or false</Hi> — then{" "}
              <Hi>type it back from memory</Hi>.
            </p>
          </div>
          {/* CSS-only monochrome mock: one page of source becoming the two things the
              copy above promises - a claim to judge, then a blank to fill from memory.
              Sized to fill this card's tall block rather than leaving the 2x2 flagship
              with a bottom-anchored strip and 250px of dead middle. */}
          <div className="relative mt-10 flex min-h-[13rem] flex-1 items-stretch gap-4 lg:mt-0" aria-hidden="true">
            <div className="flex w-16 shrink-0 flex-col rounded-lg border border-white/10 bg-white/[0.03] p-2.5 sm:w-24">
              <div className="h-1.5 w-3/4 rounded bg-white/15" />
              <div className="mt-2 h-1.5 w-full rounded bg-white/10" />
              <div className="mt-1.5 h-1.5 w-5/6 rounded bg-white/10" />
              <div className="mt-1.5 h-1.5 w-full rounded bg-white/10" />
              <div className="mt-1.5 h-1.5 w-2/3 rounded bg-white/10" />
              <div className="mt-4 h-1.5 w-full rounded bg-white/10" />
              <div className="mt-1.5 h-1.5 w-4/5 rounded bg-white/10" />
              <div className="mt-auto pt-4 text-center text-[9px] uppercase tracking-widest text-white/40">
                source
              </div>
            </div>
            <svg viewBox="0 0 24 24" fill="none" className="my-auto h-5 w-5 shrink-0 text-white/50" aria-hidden="true">
              <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {/* min-w-0 throughout: a flex item defaults to min-width:auto, so without it
                this column refuses to shrink below its own min-content and pushes 38px
                past the card at 360dp - clipped rather than scrolling, which is the worst
                kind of bug because the page still looks fine in a width test. */}
            <div className="flex min-w-0 flex-1 flex-col justify-center gap-3">
              {/* Level 1 - recognise: a claim, and two ways to answer it. */}
              <div className="min-w-0 rounded-xl border border-white/10 bg-white/[0.05] p-3 sm:p-3.5">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-white/50">
                  True or false
                </div>
                <div className="mt-2.5 h-1.5 w-4/5 rounded bg-white/15" />
                <div className="mt-1.5 h-1.5 w-3/5 rounded bg-white/10" />
                <div className="mt-3 flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full border border-white/10">
                    <svg viewBox="0 0 24 24" fill="none" className="h-3 w-3 text-white/50">
                      <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
                    </svg>
                  </span>
                  <span className="flex h-6 w-6 items-center justify-center rounded-full border border-white/60">
                    <svg viewBox="0 0 24 24" fill="none" className="h-3 w-3 text-white">
                      <path d="M5 12.5l4 4 10-10" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </span>
                </div>
              </div>
              {/* The two formats are not the same night. The harder one is scheduled for
                  when the memory has had time to decay, which is the point of the whole
                  chart above - so the mock says so rather than stacking them as a menu. */}
              <div className="flex items-center gap-3 py-1 pl-3">
                <span className="h-8 w-px bg-gradient-to-b from-transparent via-white/30 to-transparent" />
                <span className="text-[10px] uppercase tracking-widest text-white/40">
                  days later
                </span>
              </div>
              {/* Level 2 - produce: nothing on screen to recognise. */}
              <div className="min-w-0 rounded-xl border border-white/10 bg-white/[0.05] p-3 sm:p-3.5">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-white/50">
                  Type it from memory
                </div>
                {/* The blank is flex-1 rather than a fixed w-20 so it gives way first
                    when the card narrows, instead of forcing the row past the card edge. */}
                <div className="mt-2.5 flex items-center gap-1.5">
                  <span className="h-1.5 w-6 shrink-0 rounded bg-white/15" />
                  <span className="h-5 min-w-0 flex-1 rounded border border-dashed border-white/30 sm:max-w-[5rem]" />
                  <span className="h-1.5 w-4 shrink-0 rounded bg-white/15 sm:w-8" />
                </div>
                <div className="mt-2.5 h-1.5 w-1/2 rounded bg-white/10" />
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
            <h3 className="mt-6 font-sans text-2xl font-semibold leading-[1.05] tracking-tighter text-white">
              A date per memory, not a daily pile
            </h3>
            <p className="mt-4 text-sm leading-relaxed text-white/50 sm:text-base">
              FSRS-6 asks again <Hi>on the day your recall is predicted to hit 90%</Hi>.
            </p>
          </div>
          {/* Widening intervals, to scale with the real gaps above. */}
          <div className="mt-6 flex items-end gap-1.5" aria-hidden="true">
            {[8, 20, 46, 100].map((width, i) => (
              <span
                key={i}
                className="h-5 rounded bg-white/15"
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
            <h3 className="mt-6 font-sans text-2xl font-semibold leading-[1.05] tracking-tighter text-white">
              See what holds the deck up
            </h3>
            <p className="mt-4 text-sm leading-relaxed text-white/50 sm:text-base">
              Needs, explains, easily confused — and{" "}
              <Hi>the weak idea the others are built on</Hi>.
            </p>
          </div>
          <div className="mt-6 flex flex-wrap gap-1.5 text-[10px] font-medium" aria-hidden="true">
            <span className="rounded-full border border-white/10 px-2.5 py-1 text-white/50">needs</span>
            <span className="rounded-full border border-white/10 px-2.5 py-1 text-white/50">explains</span>
            <span className="rounded-full border border-dashed border-white/10 px-2.5 py-1 text-white/50">vs</span>
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
            <h3 className="mt-6 font-sans text-2xl font-semibold leading-[1.05] tracking-tighter text-white">
              Read it where it came from
            </h3>
            <p className="mt-4 text-sm leading-relaxed text-white/50 sm:text-base">
              EPUB, PDF, pasted text. <Hi>Any word defined in place</Hi>, without leaving
              the page.
            </p>
          </div>
          {/* A line of prose with one word looked up in place. */}
          <div className="mt-6 rounded-xl border border-white/10 bg-white/[0.03] p-3" aria-hidden="true">
            <div className="h-1.5 w-full rounded bg-white/10" />
            <div className="mt-2 flex items-center gap-1.5">
              <span className="h-1.5 w-10 rounded bg-white/10" />
              <span className="rounded bg-reader-highlight/25 px-1.5 py-0.5 text-[10px] font-medium text-white">
                afferent
              </span>
              <span className="h-1.5 flex-1 rounded bg-white/10" />
            </div>
            <div className="mt-2 h-1.5 w-2/3 rounded bg-white/10" />
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
            <h3 className="mt-6 font-sans text-2xl font-semibold leading-[1.05] tracking-tighter text-white">
              Explain it back in your own words
            </h3>
            <p className="mt-4 text-sm leading-relaxed text-white/50 sm:text-base">
              Get back <Hi>what you left out and what you had wrong</Hi>. Never a score.
            </p>
          </div>
          <div className="mt-6 flex flex-col gap-1.5 text-xs text-white/50" aria-hidden="true">
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
            <h3 className="mt-6 font-sans text-2xl font-semibold leading-[1.05] tracking-tighter text-white">
              Every deck, still findable in March
            </h3>
            <p className="mt-4 text-sm leading-relaxed text-white/50 sm:text-base">
              <Hi>Search titles and concepts</Hi>, rename in place, undo a delete for six
              seconds.
            </p>
          </div>
          <div className="mt-6 flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5 shrink-0 text-white/50" aria-hidden="true">
              <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.8" />
              <path d="m16 16 4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
            <span className="h-1.5 w-24 rounded bg-white/15" />
            <span className="h-3.5 w-px animate-pulse bg-white/40" />
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
            <h3 className="mt-1 font-sans text-2xl font-semibold leading-[1.05] tracking-tighter text-white sm:text-3xl">
              The part no scheduler can do
            </h3>
            <p className="mt-4 text-sm leading-relaxed text-white/50 sm:text-base">
              <Hi>Ten, twenty or forty minutes</Hi>, built from whatever is closest to
              slipping.
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
                  filled ? "bg-white" : "border border-white/15"
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
    <section aria-labelledby="how-it-works-heading" className="relative mx-auto w-full max-w-6xl">
      <motion.div {...reveal()}>
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/40 sm:text-xs">
          How it works
        </p>
        <h2
          id="how-it-works-heading"
          className="mt-4 max-w-2xl font-sans text-[clamp(2rem,5.5vw,3.75rem)] font-semibold leading-[0.95] tracking-tighter text-white [text-wrap:balance]"
        >
          From a PDF to still knowing it, in four steps.
        </h2>
      </motion.div>

      {/* Four across rather than the old sticky two-column stack: at six words a
          step, that layout was a 320px sidebar beside four short lines with 40px
          of air between them, which is how a section with 24 words of copy ended
          up as tall as the feature grid. */}
      <div className="mt-14 grid grid-cols-2 gap-x-6 gap-y-12 sm:mt-16 lg:grid-cols-4 lg:gap-x-8">
        {HOW_IT_WORKS_STEPS.map((step, i) => (
          <motion.div key={step.n} {...reveal(0.06 * i)} className="relative">
            {/* The one weight above 600 left in the app, and deliberately: at 6% opacity
                this is texture behind a heading, not type anybody reads. The "display
                never appears at 700/800" rule the rest of this file now follows is about
                type. */}
            <span
              aria-hidden="true"
              className="pointer-events-none absolute -left-1 -top-8 select-none font-sans text-7xl font-black leading-none tracking-tighter text-white/[0.07] sm:text-8xl"
            >
              {step.n}
            </span>
            <div className="relative border-l border-white/15 pl-4 sm:pl-5">
              <h3 className="text-lg font-semibold tracking-tight text-white sm:text-xl">{step.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-white/50">{step.body}</p>
            </div>
          </motion.div>
        ))}
      </div>
    </section>
  );
}

function FaqSection() {
  return (
    <section aria-labelledby="faq-heading" className="relative mx-auto w-full max-w-3xl">
      {/* Google Rich Results: FAQPage — surfaces Q&As directly in search. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(FAQPAGE_JSONLD) }}
      />
      {/* FAQ previously had zero decoration anywhere - a single soft glow,
          matching the hero/features' existing one-glow idiom, so the page's
          decorative thread doesn't drop to nothing right before the end. */}
      <div className="pointer-events-none absolute left-1/2 top-0 -z-10 h-72 w-72 -translate-x-1/2 -translate-y-1/4 rounded-full bg-white/5 blur-3xl" />
      <motion.h2
        {...reveal()}
        id="faq-heading"
        className="text-center font-sans text-[clamp(2rem,5.5vw,3.75rem)] font-semibold leading-[0.95] tracking-tighter text-white"
      >
        Frequently asked questions
      </motion.h2>
      <motion.div
        {...reveal(0.05)}
        className="mt-12 divide-y divide-white/10 rounded-[28px] bg-white/[0.03] px-6 ring-1 ring-inset ring-white/10 sm:mt-14 sm:px-8"
      >
        {FAQ_ITEMS.map(({ q, a }) => (
          <details key={q} className="group py-5">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-1 [&::-webkit-details-marker]:hidden">
              <h3 className="text-base font-medium tracking-tight text-white/70 transition-colors group-open:text-white group-hover:text-white sm:text-lg">
                {q}
              </h3>
              <span className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-white/15 text-white/50 transition-transform duration-300 group-open:rotate-45">
                <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5" aria-hidden="true">
                  <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </span>
            </summary>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-white/50 sm:text-base">
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
      className="relative mx-auto w-full max-w-3xl text-center"
    >
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute left-1/2 top-1/2 h-[28rem] w-[28rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/5 blur-3xl" />
      </div>
      <motion.h2
        {...reveal()}
        id="final-cta-heading"
        className="pb-2 font-sans text-[clamp(2.25rem,7vw,5rem)] font-semibold leading-[0.92] tracking-tighter text-white [text-wrap:balance]"
      >
        You&apos;ll forget most of this by tomorrow.
      </motion.h2>
      <motion.p
        {...reveal(0.05)}
        className="mx-auto mt-6 max-w-xl text-base leading-relaxed text-white/50 [text-wrap:balance] sm:text-lg"
      >
        That&apos;s <Hi>the curve above</Hi>, not a guess.
      </motion.p>
      <motion.div
        {...reveal(0.1)}
        className="mt-10 flex flex-col items-center gap-3 sm:flex-row sm:justify-center"
      >
        <Link
          href="/pricing"
          className="w-full max-w-xs rounded-full border border-white/15 bg-transparent px-6 py-3.5 text-center text-base font-medium text-white backdrop-blur-md transition-all duration-300 ease-out hover:scale-[1.03] hover:bg-white/10 active:scale-[0.97] sm:w-auto sm:max-w-none sm:py-3 sm:text-sm"
        >
          View Pro Plans
        </Link>
        <Link
          href="/ingest"
          className="w-full max-w-xs rounded-full bg-white px-6 py-3.5 text-center text-base font-semibold text-black shadow-[0_8px_36px_-6px_rgba(255,255,255,0.35)] transition-all duration-300 ease-out hover:scale-[1.03] hover:shadow-[0_14px_48px_-6px_rgba(255,255,255,0.5)] active:scale-[0.97] sm:w-auto sm:max-w-none sm:py-3 sm:text-sm"
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
    <footer className="relative z-[80] mx-auto w-full max-w-[88rem] border-t border-white/10 px-6 py-12 sm:px-10 sm:py-14">
      <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col items-center gap-2 sm:items-start">
          <div className="flex items-center gap-2">
            <div className="relative flex h-7 w-7 items-center justify-center overflow-hidden rounded-[28%] bg-gradient-to-br from-zinc-800 to-zinc-950 text-white">
              <LogoMark sheen className="h-[64%] w-[64%]" />
            </div>
            <span className="font-retro text-lg text-white">FlowRecall</span>
          </div>
          <p className="text-xs text-white/40">AI flashcards for active recall.</p>
        </div>
        <nav className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-white/50">
          <Link href="/ingest" className="transition-colors hover:text-white">
            Ingest
          </Link>
          <Link href="/library" className="transition-colors hover:text-white">
            Library
          </Link>
          <Link href="/reader" className="transition-colors hover:text-white">
            Reader
          </Link>
          <Link href="/map" className="transition-colors hover:text-white">
            Mindmap
          </Link>
          <Link href="/pricing" className="transition-colors hover:text-white">
            Pricing
          </Link>
          <Link href="/privacy" className="transition-colors hover:text-white">
            Privacy
          </Link>
        </nav>
      </div>
      <p className="mt-10 text-center text-xs text-white/40 sm:text-left">
        © {new Date().getFullYear()} FlowRecall
      </p>
    </footer>
  );
}

export default function Home() {
  const decks = useSavedDecks();
  // Navbar.tsx hides itself entirely on native (MobileTabBar is its only
  // chrome) - the hero's min-h-[88vh]/justify-center centering was tuned for
  // the web layout, where that floating navbar above it justifies some
  // space. With nothing above it on native, the same centering leaves a
  // large dead zone under the status bar instead of anchoring near the top.
  const isNative = useIsNative();

  return (
    // `aw-page` pins the dark token values for this page's subtree (globals.css).
    // The slabs are hard-coded white-on-black per the brief, but RetentionCurve
    // and TodaySession draw themselves from --foreground/--accent - without this
    // scope, a visitor in light mode gets a near-black chart line on a black
    // slab. The page is a fixed dark surface now; the tokens have to agree.
    <main className="aw-page relative flex flex-1 flex-col bg-black px-3 pb-px sm:px-5">
      <Backlight />

      {/* Google Rich Results: SoftwareApplication (Educational Application). */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(SOFTWARE_APP_JSONLD) }}
      />

      {/* ============================ HERO ============================ */}
      <Bento z={10} overlap={false} className="mt-3 sm:mt-5">
        <section
          aria-labelledby="hero-heading"
          className={`relative flex flex-col items-center px-6 text-center sm:px-10 ${
            isNative ? "justify-start pb-14 pt-10" : "min-h-[86vh] justify-center py-20 sm:py-28"
          }`}
        >
          {/* Hero decoration (grid + glow orbs) is web-only. Both were tuned
            for web's tall hero; on native's short, narrow content-fit box they
            don't scale down cleanly - the grid's radial fade compresses into a
            visibly gridded patch, and with that gone the bottom-right glow orb
            (positioned right near the CTA buttons) stands out on its own as an
            isolated grey blob instead of blending into a wash. Rather than keep
            chasing individual artifacts, native gets a flat, pure black hero
            background instead - confirmed live on-device as the preferred look.
            Web/desktop keeps the full effect unchanged, where the taller hero
            gives it room to actually work. */}
          {!isNative && (
            <>
              {/* Faded spotlight grid - a fine ruled pattern masked with a radial
                gradient so it dissolves into darkness at the edges, leaving a
                subtle lit "stage" behind the hero copy. */}
              <div className="pointer-events-none absolute inset-0 -z-10 bg-[linear-gradient(to_right,rgba(255,255,255,0.035)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.035)_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_at_center,black_25%,transparent_68%)]" />

              {/* Ambient glow orbs - purely decorative, blurred achromatic washes
                that sit behind the hero to give the page depth.
                pointer-events-none and -z-10 keep them clear of the cards and
                interactive content. */}
              <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
                <div className="absolute -top-40 left-1/2 h-72 w-72 -translate-x-1/2 rounded-full bg-white/5 blur-3xl md:h-[38rem] md:w-[38rem]" />
                <div className="absolute top-1/3 -left-32 hidden h-[30rem] w-[30rem] rounded-full bg-white/[0.03] blur-3xl md:block" />
                <div className="absolute -bottom-24 right-[-8rem] h-64 w-64 rounded-full bg-white/5 blur-3xl md:h-[32rem] md:w-[32rem]" />
              </div>
            </>
          )}

          <div className="relative z-10 flex w-full flex-col items-center">
            {/* THE PITCH, ON BOTH PLATFORMS AGAIN. This was web-only for six commits on my
                argument that an installed app is past being introduced, and that was the root
                of everything that followed: with it gone the app stopped saying what it was.
                The home page IS the introduction to FlowRecall, and the app and the website
                show the same one. */}
            <motion.p
              initial={{ opacity: 0, y: -24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={SNAP}
              className="mb-7 inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-[10px] font-medium uppercase tracking-[0.2em] text-white/80 backdrop-blur-md sm:gap-2 sm:px-4 sm:py-1.5 sm:text-xs"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-white shadow-[0_0_10px_2px_rgba(255,255,255,0.55)]" />
              Active recall, disguised as doomscrolling
            </motion.p>

            {/* THE SENTENCE, BROKEN WHERE ITS OWN FULL STOP ALREADY BREAKS IT. Two
                clauses, two lines, and the second set in the editorial serif: the
                headline argues by contrast ("stop this / start that") and the type
                now carries that contrast instead of leaving it to the words alone.
                Not one word changed. */}
            <motion.h1
              initial={{ opacity: 0, y: 32 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...SNAP, delay: 0.05 }}
              id="hero-heading"
              className={`max-w-[16ch] pb-2 font-sans text-[clamp(2.75rem,10.5vw,7.5rem)] font-semibold leading-[0.9] tracking-tighter text-white [text-wrap:balance] ${
                isNative ? "mt-6" : ""
              }`}
            >
              <span className="block text-white/40">Stop re-reading.</span>
              <span className="block font-editorial italic">Start recalling.</span>
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...SNAP, delay: 0.1 }}
              className="mt-7 w-full max-w-xl text-lg leading-relaxed text-white/50 [text-wrap:balance] sm:text-xl"
            >
              <Hi>Upload a PDF.</Hi> Read it, map it, and review it{" "}
              <Hi>right before you&apos;d forget</Hi>.
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...SNAP, delay: 0.15 }}
              className="mt-9 flex w-full max-w-xs flex-col gap-3 sm:w-auto sm:max-w-none sm:flex-row"
            >
              {/* Secondary CTA - minimalist glassmorphic outline. */}
              <Link
                href="/pricing"
                className="w-full rounded-full border border-white/15 bg-transparent px-6 py-3.5 text-center text-base font-medium text-white backdrop-blur-md transition-all duration-300 ease-out hover:scale-[1.03] hover:bg-white/10 active:scale-[0.97] sm:w-auto sm:py-3 sm:text-sm"
              >
                View Pro Plans
              </Link>
              {/* Primary CTA - pure white, which under "Pure Monochrome" is the only
                  thing on the page allowed to pop. The ambient shadow is white rather
                  than black now: on a pitch-black ground a dark shadow is invisible,
                  and what makes a white pill read as raised here is the light it
                  spills onto the slab underneath it. */}
              <Link
                href="/ingest"
                className="w-full rounded-full bg-white px-6 py-3.5 text-center text-base font-semibold text-black shadow-[0_8px_36px_-6px_rgba(255,255,255,0.35)] transition-all duration-300 ease-out hover:scale-[1.03] hover:shadow-[0_14px_48px_-6px_rgba(255,255,255,0.5)] active:scale-[0.97] sm:w-auto sm:py-3 sm:text-sm"
              >
                Start ingesting notes
              </Link>
            </motion.div>

            {/* THE PROOF, in the hero. The research on landing-page copy is blunt that a
                claim without a number reads as fluff, and this app computes its own proof and
                then buries it three sections down. Both figures come from CURVE, which is
                plotted by the same FSRS-6 scheduler that will schedule the reader - so this is
                evidence rather than encouragement, which is the only kind of motivation worth
                putting on a page for students. */}
            <motion.p
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...SNAP, delay: 0.2 }}
              className="mt-8 text-sm text-white/50"
            >
              Three reviews in six months.{" "}
              <span className="font-medium tabular-nums text-white">
                {asPercent(CURVE.endRecall.reviewed)}% recalled
              </span>{" "}
              instead of{" "}
              <span className="tabular-nums">{asPercent(CURVE.endRecall.studiedOnce)}%</span>.
            </motion.p>

            {/* The one thing an introduction owes a returning student: a way back into
                tonight's study. One line and a button, no counts - see TodaySession. Renders
                nothing at all when signed out, which is the right answer for a stranger who is
                here to read an introduction. */}
            <TodaySession decks={decks} />
          </div>
        </section>
      </Bento>

      {/* ============================ THE FACT ========================= */}
      {/* One true thing about the brain, different every time the page is opened. */}
      <Bento z={20} className="px-4 py-6 sm:px-10 sm:py-10">
        <BrainFactSection />
      </Bento>

      {/* THE INTRODUCTION, on the app and the website alike. These were web-only for six
          commits and that was the mistake this whole rewrite undoes: it left the installed
          app with nothing that said what FlowRecall is. */}
      <Bento z={30} className="px-5 py-16 sm:px-10 sm:py-24 lg:px-16">
        <CurveSection />
      </Bento>

      <Bento z={40} className="px-5 py-16 sm:px-10 sm:py-24 lg:px-16">
        <FeaturesSection />
      </Bento>

      <Bento z={50} className="px-5 py-16 sm:px-10 sm:py-24 lg:px-16">
        <HowItWorksSection />
      </Bento>

      <Bento z={60} className="px-5 py-16 sm:px-10 sm:py-24 lg:px-16">
        <FaqSection />
      </Bento>

      <Bento z={70} className="px-5 py-20 sm:px-10 sm:py-28 lg:px-16">
        <FinalCtaSection />
      </Bento>

      <SiteFooter />
    </main>
  );
}
