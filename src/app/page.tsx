"use client";

import { useEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";
import Link from "next/link";
import { getFactCursor, setFactCursor, useSavedDecks } from "@/lib/storage";
import { factAt, nextCursor } from "@/lib/brainFacts";
import { useIsNative } from "@/lib/useIsNative";
import { asPercent, CURVE } from "@/lib/forgettingCurve";
import LogoMark from "@/components/LogoMark";
import FilmGrain from "@/components/FilmGrain";
import RetentionCurve from "@/components/RetentionCurve";
import TodaySession from "@/components/TodaySession";

// ---------------------------------------------------------------------------
// ONE BENTO GRID ON OLED BLACK
// ---------------------------------------------------------------------------
// Every word on this page is the copy that was here before. Nothing below is a
// rewrite of the argument - it is the same argument re-set.
//
// WHY IT IS A GRID AND NOT A STACK OF SECTIONS: the page was seven full-width
// slabs dealt down a column, which is a vertical scroll of sections wearing
// rounded corners. A 12-column grid of cells at uneven spans
// (7/5 · 12 · 8/4 · 5/7 · 7/5 · 5/7 · 12) gives every piece of content a size
// that means something - the hero and the recall loop are equals at the top,
// the chart is twice its own commentary, and the page opens and closes on a
// full-bleed twelve. Reading order is exactly the order it always was: hero,
// the fact, the curve, the product, the four steps, FAQ, close.
//
// TWELVE CELLS, DOWN FROM FIFTEEN, AND NOT ONE WORD LESS. The brief that
// prompted this asked to prune the copy, so the copy was measured first: every
// body paragraph on this page put together is 189 words, and the longest single
// one is 23. There was nothing left to cut - three earlier passes had already
// done it. What made the page feel cluttered was the furniture around the
// words. Six product cards, each a bordered pane carrying a mono label, a
// heading, one line of prose and a small drawn mock, stacked into six identical
// full-width boxes on a phone. Five of those mocks restated their own captions
// (see ReaderCell), and four of the cards were a list pretending to be a
// gallery (see MechanismsCell). The words all survive; the repetition does not.
//
// NO JAVASCRIPT ANIMATION ON THIS ROUTE AT ALL. motion/react is gone from this
// file. It drove one spring entrance per section - nine of them, all identical,
// which is not a design, it is a default - plus a scroll-reveal on every block.
// There is now exactly ONE authored moment, the hero, and it is a CSS keyframe
// (.fr-rise). Everything below the fold is simply present when you arrive.
// That is both the better design decision and the cheaper one: no spring
// integrator on the main thread of a mid-range Android phone, and no element
// anywhere on the page whose visibility depends on JS having run.
//
// TWO THICKNESSES OF GLASS, AND THE SPLIT IS MEASURED RATHER THAN DECORATIVE -
// see GLASS_SMALL / GLASS_LARGE below.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// THE CELL
// ---------------------------------------------------------------------------

/** Every cell in the grid shares this chrome: a hairline, a large radius, and
 * nothing else. 28px on a phone and 32px from `sm`, because 40px of corner on a
 * 360dp-wide cell eats into the first and last line of every paragraph it
 * holds - a rounding decision the copy pays for. */
const CELL = "relative overflow-hidden rounded-[28px] border border-white/10 sm:rounded-[32px]";

/** SMALL CELLS GET REAL FROSTED GLASS.
 *
 * `backdrop-blur-3xl` is a 64px filter, and a filter costs the area it covers,
 * re-sampled whenever what is behind it moves - which on a scrolling page is
 * every frame. At a third of a viewport or less that is affordable, and it is
 * where the material is most legible anyway: a small pane beside a large one
 * reads as frost because its edges are close enough together to see the
 * gradient bend.
 *
 * There IS something behind these panes to refract, which is the usual catch
 * with glass on pure black: the film grain and the backlight both sit at
 * -z-10 under the whole grid. */
const GLASS_SMALL = `${CELL} bg-white/[0.02] backdrop-blur-3xl`;

/** LARGE CELLS GET THE SAME FILL, RAISED ONE STEP, AND NO FILTER.
 *
 * Seven full-width blurred panes re-sampling on every scroll frame is the
 * single most reliable way to turn a smooth scroll into a slideshow on the
 * cheap Android panels this ships to. That was measured on this page's own
 * predecessor, which is why the slab version carried no filter at all.
 *
 * 3% fill instead of 2% is the compensation: a blurred pane picks up light from
 * what it is blurring, so an unfiltered one needs slightly more of its own to
 * read as the same material sitting beside it. The two are indistinguishable in
 * place, which is the test that matters. */
const GLASS_LARGE = `${CELL} bg-white/[0.03]`;

/** The hover lift, `transform` only, on the compositor, 500ms.
 *
 * `.fr-lift` (globals.css) gates it behind `(hover: hover) and (pointer: fine)`
 * rather than Tailwind's `hover:`, and that gate is load-bearing on this
 * platform: Android WebView can latch `:hover` on a tap, which would leave a
 * cell scaled up until the next tap elsewhere - and a scale on a
 * backdrop-filtered pane re-samples the blur for every frame it runs. */
const LIFT = "fr-lift";

/** The page's one accent, and it is luminance rather than hue.
 *
 * White spill, not a coloured halo, and only on things you can press. A
 * saturated accent was tried on this page and reverted: at the low alpha a glow
 * needs, chroma carries where luminance does not, so an azure wash tinted the
 * whole upper page where the same value in white stayed a glow. */
const GLOW = "shadow-[0_8px_36px_-6px_rgba(255,255,255,0.35)]";
const GLOW_HOVER = "hover:shadow-[0_14px_48px_-6px_rgba(255,255,255,0.5)]";

/** The cell's own padding. One value, so the grid has a single gutter rhythm. */
const PAD = "p-6 sm:p-8";

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
  // Kept in step with the product cells below. Every line here is a surface
  // that actually exists - the list was three releases out of date, which is
  // how the reader, the library and the mindmap ended up invisible to both
  // crawlers and students.
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
// Content cells (SEO + conversion). Kept as module-level components with no
// client state, so they server-render into the initial HTML where crawlers and
// rich-result parsers can read them on first fetch.
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

/** A key phrase, lifted out of a muted paragraph in pure white.
 *
 * The paragraphs on this page are set at `text-white/60` so the headings keep
 * the contrast, and this is how a long line still hands the eye the two or
 * three words worth carrying away from it. It is a span rather than <strong>
 * on purpose: this is a typographic emphasis, not a semantic one, and a screen
 * reader announcing "PDF" with stress adds nothing.
 *
 * WHY /50 AND NOT /40: white at 40% over black composites to #666, which is
 * 3.7:1 - under the 4.5:1 floor for body text. /50 is #808080 and 5.3:1. The
 * two are a hair apart on screen and only one of them is readable, so the
 * muted end of this page's ramp stops at /50. /40 survives only on aria-hidden
 * decoration, where there is nothing to read. */
function Hi({ children }: { children: ReactNode }) {
  return <span className="font-medium text-white">{children}</span>;
}

/** THE SERIF TAIL. Instrument Serif italic, and it is a rule rather than a
 * sprinkle: it always carries the CLOSING clause of a line, never a phrase in
 * the middle of one.
 *
 * That constraint is what keeps it editorial instead of decorative. A serif
 * that can appear anywhere is a second body font and reads as indecision; a
 * serif that only ever lands on the last few words reads as a cadence - the
 * sentence changes voice as it finishes, the way a pull-quote does. `<Hi>`
 * owns the middle of a sentence and `<Em>` owns its end, so the two never
 * compete for the same words.
 *
 * It is set at /70 rather than pure white on purpose. The tail is the quiet
 * half of the sentence - if it outweighs the phrase `<Hi>` lifted, the
 * emphasis order inverts and the line reads backwards. */
function Em({ children }: { children: ReactNode }) {
  return <span className="font-editorial text-[1.06em] italic text-white/70">{children}</span>;
}

/** The mechanism a cell implements, named above its own headline.
 *
 * This is the whole editorial move of the product cells: every surface in this
 * app exists because of a specific, checkable finding about memory, and saying
 * which one converts a feature list into an argument. The statement cell's own
 * copy makes that promise out loud - "the mechanism each surface is built on is
 * named on the card" - so these labels are the claim rather than decoration on
 * it. Mono and tiny so it reads as a citation, not as a second headline.
 *
 * /60 rather than /40: it is real text that carries meaning, so it belongs
 * above the contrast floor (7.4:1) rather than in the decoration band. */
function Effect({ children }: { children: ReactNode }) {
  return (
    <p className="mb-4 font-mono text-[10px] uppercase tracking-[0.18em] text-white/60">
      {children}
    </p>
  );
}

/** The ground: pitch black, one static backlight, and grain.
 *
 * TWO RADIAL GRADIENTS, PAINTED ONCE, NEVER ANIMATED. `fixed` rather than
 * absolute so the light stays put while the grid travels past it - which is
 * what makes the cells look lit from a fixed source in the room rather than
 * carrying their own glow around with them.
 *
 * THIS IS THE ONLY LIGHT ON THE PAGE NOW. The version before it also carried a
 * masked 4rem ruled grid behind the hero, three blurred orbs, a 28rem wash
 * behind the closing CTA, another behind the FAQ, and a fourth inside the
 * flagship product card - six full-viewport-class blurred washes in total. They
 * are gone: a glow belongs on something you can press, not behind four
 * different headings, and each one was a large blurred paint on a phone.
 *
 * The grain is not decoration here. A gradient falling from 7% white to nothing
 * across most of a viewport spans roughly one 8-bit step, and without a dither
 * it bands into visible rings on exactly the panels this ships to. */
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

// ---------------------------------------------------------------------------
// THE HERO
// ---------------------------------------------------------------------------

/** THE CONTROL. One height, one radius, one text size, and the height is fixed
 * rather than derived from padding.
 *
 * The pills before these were `px-6 py-3.5 text-base` and full-bleed on a phone,
 * which is 52px of button whose height moved with its font - so the two CTAs and
 * the tab bar's own controls never quite agreed, and at 16px type on a 336px-wide
 * pill the shape read as a balloon rather than as a control. `h-14` is 56px: it
 * is the same figure on every breakpoint, it clears the 44px touch floor with
 * room, and it makes the pair a matched set instead of two similar shapes. */
const CTA_BASE =
  "inline-flex h-14 items-center justify-center rounded-full px-8 text-[15px] tracking-[-0.01em] transition-[transform,box-shadow,background-color] duration-300 ease-out active:scale-[0.97] motion-reduce:transition-none motion-reduce:hover:scale-100";

/** The primary action, and the only element on the page wearing the accent. */
function PrimaryCta({ className = "" }: { className?: string }) {
  return (
    <Link
      href="/ingest"
      className={`${CTA_BASE} bg-white font-semibold text-black hover:scale-[1.02] ${GLOW} ${GLOW_HOVER} ${className}`}
    >
      Start ingesting notes
    </Link>
  );
}

/** The secondary action: a hairline, no fill, no glow. The blur here is a pill a
 * few hundred pixels wide, which is the size at which a filter is free. */
function SecondaryCta({ className = "" }: { className?: string }) {
  return (
    <Link
      href="/pricing"
      className={`${CTA_BASE} border border-white/15 font-medium text-white backdrop-blur-md hover:scale-[1.02] hover:bg-white/10 ${className}`}
    >
      View Pro Plans
    </Link>
  );
}

// ---------------------------------------------------------------------------
// THE HERO CLUSTER
// ---------------------------------------------------------------------------
// The hero was ONE cell holding six things: an eyebrow pill, the headline, the
// subhead, two buttons, the proof line and the session link. At 678px tall with
// its contents centred, most of it was air - which is what "floating in a void"
// describes, and it was a fair description.
//
// It is four slabs now, in a nested twelve-column grid that spans the outer
// one, so the gap rhythm is identical and the seams line up with every other
// cell on the page:
//
//     ┌───────────────────────────┬───────────────┐
//     │  headline + subhead  (7)  │               │
//     ├─────────────┬─────────────┤   loop  (5)   │
//     │  CTAs  (4)  │  proof (3)  │   rows 1-2    │
//     └─────────────┴─────────────┴───────────────┘
//
// PLACEMENT IS EXPLICIT ON `lg` BECAUSE DOM ORDER AND VISUAL ORDER DISAGREE ON
// PURPOSE. Stacked on a phone the buttons have to come directly under the
// headline - a primary action below a tall product panel is a primary action
// nobody reaches - so the DOM runs headline, CTAs, proof, loop. On `lg` the loop
// belongs beside the headline, which auto-flow cannot express from that order.
// `col-start`/`row-start` says it in four lines instead.
// ---------------------------------------------------------------------------

/** The nested grid the four hero slabs live in. Same twelve columns and the same
 * gap as the page grid, so it reads as part of it rather than as a panel. */
function HeroCluster({
  decks,
  isNative,
}: {
  decks: ReturnType<typeof useSavedDecks>;
  isNative: boolean;
}) {
  return (
    <div className="col-span-1 grid grid-cols-1 gap-4 sm:col-span-6 sm:gap-6 lg:col-span-12 lg:grid-cols-12">
      {/* THE HEADLINE SLAB. A reading block, so it is left-aligned at every
          width - centred display type over a left-aligned subhead is the tell
          of a hero assembled rather than set.

          `justify-between`, NOT `justify-center`, AND THAT IS THE WHOLE FIX FOR
          "floating in a void". The loop slab beside this one spans both rows, so
          grid stretches this one to match it: 678px of slab holding 240px of
          content. Centred, that put 219px of nothing above the eyebrow and 219
          below the subhead, and an element centred in empty space is exactly
          what reads as floating. Pushed apart, the same height becomes a
          composition - label pinned to the top edge, the sentence sitting on the
          bottom one, the air between them deliberate. It is the cover of a
          magazine rather than a slide. */}
      <section
        aria-labelledby="hero-heading"
        className={`${GLASS_LARGE} ${PAD} flex flex-col justify-between gap-12 sm:p-12 lg:col-span-7 lg:col-start-1 lg:row-start-1 lg:p-14 ${
          isNative ? "" : "lg:min-h-[26rem]"
        }`}
      >
        {/* THE PITCH, ON BOTH PLATFORMS. This was web-only for six commits on the
            argument that an installed app is past being introduced, and that was
            the root of everything that followed: with it gone the app stopped
            saying what it was. */}
        <p
          className="fr-rise inline-flex w-fit items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-[10px] font-medium uppercase tracking-[0.2em] text-white/80 backdrop-blur-md sm:gap-2 sm:px-4 sm:py-1.5 sm:text-xs"
          style={{ "--fr-d": "0ms" } as React.CSSProperties}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-white shadow-[0_0_10px_2px_rgba(255,255,255,0.55)]" />
          Active recall, disguised as doomscrolling
        </p>

        {/* THE SENTENCE, BROKEN WHERE ITS OWN FULL STOP ALREADY BREAKS IT. Two
            clauses, two lines, the second in the editorial serif: the headline
            argues by contrast and the type now carries that contrast instead of
            leaving it to the words. Not one word changed.

            THE SIZE IS CAPPED BY THE SENTENCE, AND EVERY NUMBER WAS MEASURED IN
            THE BROWSER WITH THE WEBFONT LOADED. "Stop re-reading." costs about
            7.1px of width per px of type, so it needs 312px at 44px. The columns
            it occupies are 286px at 360dp and 462px at the lg breakpoint, which
            is what 6vw with a 2.4rem floor and a 5rem cap clears. At the 7.5rem
            an earlier revision used it broke at its own hyphen - "Stop re- /
            reading." - three lines where two were authored. */}
        <div>
        <h1
          id="hero-heading"
          className="fr-rise pb-1 font-sans text-[clamp(2.4rem,6vw,5rem)] font-semibold leading-[0.92] tracking-[-0.04em] text-white [text-wrap:balance]"
          style={{ "--fr-d": "90ms" } as React.CSSProperties}
        >
          <span className="block text-white/45">Stop re-reading.</span>
          <span className="block font-editorial italic">Start recalling.</span>
        </h1>

        <p
          className="fr-rise mt-7 max-w-xl text-lg leading-relaxed text-white/60 [text-wrap:balance] sm:text-xl"
          style={{ "--fr-d": "180ms" } as React.CSSProperties}
        >
          <Hi>Upload a PDF.</Hi> Read it, map it, and review it{" "}
          <Hi>right before you&apos;d forget</Hi>.
        </p>
        </div>
      </section>

      {/* THE ACTION SLAB, AND IT HAS TWO FACES BECAUSE ITS AUDIENCE DOES.
          
          A stranger reading an introduction needs the two CTAs. A signed-in
          student with something due tonight needs exactly one thing - the door
          back into the session - and two white pills above it were competing
          with the only action that matters. So the session card is the primary
          action when it exists, and the CTAs demote to text links beneath it.

          THE SWITCH IS CSS, NOT STATE, AND THAT IS THE ONLY WAY IT IS HONEST.
          Whether TodaySession renders depends on four things it resolves
          asynchronously and privately: a user id, at least one deck, a plan the
          scheduler has finished building, and something actually being due. The
          page cannot know any of that at render time, and guessing from
          `decks.length` would demote the CTAs to a text link on a screen where
          the session card then declines to appear - leaving no primary action at
          all. `group-has-[#tonight-heading]` keys off the card that actually
          rendered, so the two can never disagree.

          Both forms ship in the markup and CSS picks one. The hidden branch is
          `display:none`, so it is not announced and not tabbable.

          NO `.fr-rise` ON THIS SLAB OR THE PROOF SLAB, AND THAT WAS A BUG BEFORE
          IT WAS A DECISION. Putting an entrance on a whole pane meant the primary
          action did not exist for the first second of the page. The slabs are
          present at first paint; only the words move. */}
      <section
        aria-label="Get started"
        className={`${GLASS_LARGE} ${PAD} group/action flex flex-col justify-center gap-6 sm:p-10 lg:col-span-4 lg:col-start-1 lg:row-start-2`}
      >
        <TodaySession decks={decks} />

        {/* No session: the pair of pills, full-width, one left edge. */}
        <div className="flex flex-col gap-3 group-has-[#tonight-heading]/action:hidden">
          <PrimaryCta className="w-full" />
          <SecondaryCta className="w-full" />
        </div>

        {/* Session present: the same two destinations, demoted to what they are -
            somewhere to go afterwards. */}
        <div className="hidden flex-wrap items-center gap-x-6 gap-y-2 group-has-[#tonight-heading]/action:flex">
          <Link
            href="/ingest"
            className="text-sm text-white/40 underline-offset-4 transition-colors hover:text-white hover:underline"
          >
            Start ingesting notes
          </Link>
          <Link
            href="/pricing"
            className="text-sm text-white/40 underline-offset-4 transition-colors hover:text-white hover:underline"
          >
            View Pro Plans
          </Link>
        </div>
      </section>

      {/* THE PROOF SLAB. A visual block rather than a reading block, so it is
          centred - the one place on this page where centring is right, because
          there is no second line to align a ragged edge against.

          It stays a sentence rather than becoming a big-number tile. Both
          figures come from CURVE, computed by the same FSRS-6 scheduler that
          will schedule whoever reads them, and a number lifted out of the
          sentence that qualifies it is a statistic without its own conditions. */}
      <section
        aria-label="What the scheduler predicts"
        className={`${GLASS_LARGE} ${PAD} flex flex-col items-center justify-center text-center sm:p-10 lg:col-span-3 lg:col-start-5 lg:row-start-2`}
      >
        <p className="max-w-xs text-[15px] leading-relaxed text-white/60 [text-wrap:balance] sm:text-base">
          Three reviews in six months.{" "}
          <span className="font-medium tabular-nums text-white">
            {asPercent(CURVE.endRecall.reviewed)}% recalled
          </span>{" "}
          instead of{" "}
          <span className="tabular-nums">{asPercent(CURVE.endRecall.studiedOnce)}%</span>.
        </p>
      </section>

      <LoopCell />
    </div>
  );
}

// ---------------------------------------------------------------------------
// THE LOOP
// ---------------------------------------------------------------------------

/** THE RECALL LOOP, five columns beside the hero, and the reason the grid is
 * asymmetric rather than a row of thirds.
 *
 * This is the flagship product cell, and it used to be a card with a headline, a
 * paragraph, and a drawn mock of two study formats stacked under them. The mock
 * was doing the most important work on the page and reading as filler, because
 * nothing said what the three pieces of it were.
 *
 * They are three beats now - question, think, answer - on a hairline rhythm, in
 * that order, at the top of the page beside the headline. "Show, don't tell"
 * means the loop this app runs on should be legible before any copy about it.
 *
 * The labels under each beat are the mock's own words. "True or false" and
 * "Type it from memory" are the formats' real names in the study feed, and
 * "days later" was already the divider between them - because the two formats
 * are not the same night. The harder one is scheduled for when the memory has
 * had time to decay, which is the entire point of the chart two cells down.
 *
 * The answer beat carries the page's only other white glow. That is the accent
 * spent where the loop pays off, and it is the same luminance as the CTA. */
function LoopCell() {
  return (
    <article
      // Explicitly placed: the loop is the right-hand column of the hero
      // cluster and spans BOTH its rows, so the action and proof tiles sit
      // under the headline rather than under the loop. Without the row-span it
      // auto-placed into row 1 only and left columns 8-12 of row 2 as a hole in
      // the grid - which is the same "floating in a void" the cluster exists to
      // remove, just relocated.
      className={`${GLASS_LARGE} ${PAD} col-span-1 flex flex-col sm:col-span-6 sm:p-10 lg:col-span-5 lg:col-start-8 lg:row-span-2 lg:row-start-1`}
    >
      <Effect>The testing effect</Effect>
      <h2 className="font-sans text-[clamp(1.75rem,4.4vw,2.5rem)] font-semibold leading-[1.02] tracking-[-0.035em] text-white">
        Answer it before you&apos;re told
      </h2>
      <p className="mt-4 max-w-sm text-sm leading-relaxed text-white/60 sm:text-base">
        Drop a PDF in. <Hi>Swipe a claim true or false</Hi> — then{" "}
        <Hi>type it back from memory</Hi>.
      </p>

      {/* The loop itself. min-w-0 throughout: a flex item defaults to
          min-width:auto, so without it a column refuses to shrink below its own
          min-content and pushes past the cell at 360dp - clipped rather than
          scrolling, which is the worst kind of bug because the page still looks
          fine in a width test. */}
      <div className="mt-9 flex flex-1 flex-col justify-end" aria-hidden="true">
        {/* BEAT ONE — the question. A claim, and two ways to answer it. */}
        <div className="border-t border-white/10 pt-5">
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/60">Question</p>
          <div className="mt-3 min-w-0 rounded-2xl border border-white/10 bg-white/[0.05] p-3.5">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-white/60">
              True or false
            </div>
            <div className="mt-2.5 h-1.5 w-4/5 rounded bg-white/15" />
            <div className="mt-1.5 h-1.5 w-3/5 rounded bg-white/10" />
            <div className="mt-3.5 flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full border border-white/10">
                <svg viewBox="0 0 24 24" fill="none" className="h-3 w-3 text-white/60">
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
        </div>

        {/* BEAT TWO — the think. It is a wait, not a screen, so it is drawn as
            one: a gap with a hairline running through it and the scheduler's own
            word for what happens in it. */}
        <div className="mt-5 flex items-center gap-3 border-t border-white/10 pt-5">
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/60">Think</p>
          <span className="h-px flex-1 bg-gradient-to-r from-white/25 to-transparent" />
          <span className="font-editorial text-sm italic text-white/60">days later</span>
        </div>

        {/* BEAT THREE — the answer. Nothing on screen to recognise, and the one
            element in the loop lit from the front. */}
        <div className="mt-5 border-t border-white/10 pt-5">
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/60">Answer</p>
          <div className={`mt-3 min-w-0 rounded-2xl border border-white/20 bg-white/[0.07] p-3.5 ${GLOW}`}>
            <div className="text-[10px] font-semibold uppercase tracking-wide text-white">
              Type it from memory
            </div>
            {/* The blank is flex-1 rather than a fixed width so it gives way
                first when the cell narrows, instead of forcing the row past the
                cell edge. */}
            <div className="mt-2.5 flex items-center gap-1.5">
              <span className="h-1.5 w-6 shrink-0 rounded bg-white/20" />
              <span className="h-5 min-w-0 flex-1 rounded border border-dashed border-white/40 sm:max-w-[6rem]" />
              <span className="h-1.5 w-4 shrink-0 rounded bg-white/20 sm:w-8" />
            </div>
            <div className="mt-2.5 h-1.5 w-1/2 rounded bg-white/10" />
          </div>
        </div>
      </div>
    </article>
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

/** One true thing about the brain, different every visit. Full width, and the
 * shortest cell in the grid.
 *
 * These are the twenty-four unattributed, source-checked lines in
 * src/lib/brainFacts.ts, and they share ONE cursor with the library header - so
 * a student who opens both screens meets two different facts, and meets all
 * twenty-four before meeting any twice.
 *
 * This is the page's neuroscience, and it is deliberately the shortest cell on
 * it: a single sentence with air around it, no label, no attribution, no
 * explanation underneath. A paragraph here would defeat the point.
 *
 * Renders on native too - it is the one piece of the introduction worth keeping
 * on a screen a student opens every day, because it changes.
 *
 * IT IS THE ONE CELL SET IN SERIF, and that is the argument for the whole
 * treatment: this is the only sentence on the page nobody at FlowRecall wrote
 * about FlowRecall. Giving it a different voice is how a reader can tell at a
 * glance that the page has stopped selling for a moment.
 *
 * min-h reserves the line's space before hydration fills it, so the swap-in
 * costs no layout shift - the "Zero Layout Shift" rule this page is held to.
 * 11rem is not a round number: the longest fact in the set wraps to three lines
 * at 360dp (84px) and the padding adds the rest, so every fact at every length
 * leaves the box the same size. */
function FactCell() {
  const hydrated = useHydrated();
  // Read once, advance for next time. Not held in state: nothing re-renders
  // because of it, and writing state from an effect is a lint error here.
  const factCursor = useMemo(() => getFactCursor(), []);
  useEffect(() => {
    setFactCursor(nextCursor(factCursor));
  }, [factCursor]);

  return (
    <section
      aria-label="About memory"
      className={`${GLASS_LARGE} col-span-1 flex min-h-[11rem] items-center justify-center px-6 py-10 sm:col-span-6 sm:min-h-[14rem] sm:px-10 lg:col-span-12`}
    >
      <p
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-2 -translate-x-1/2 select-none font-editorial text-[9rem] leading-none text-white/10 sm:text-[13rem]"
      >
        &ldquo;
      </p>
      {/* Italic, and it was not until now - the cell has been set in Instrument
          Serif roman since the serif was introduced, which is why it read as a
          quiet heading rather than as a quotation. Italic is what makes a
          pull-quote read as someone else's voice, and this is the one sentence
          on the page nobody at FlowRecall wrote about FlowRecall. */}
      {hydrated && (
        <p className="relative max-w-4xl text-center font-editorial text-2xl italic leading-[1.3] tracking-tight text-white/90 [text-wrap:balance] sm:text-4xl md:text-[2.75rem]">
          {factAt(factCursor)}
        </p>
      )}
    </section>
  );
}

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

const LONGEST_GAP = Math.max(...REVIEW_GAPS);

/** The page's evidence, computed instead of claimed. Eight columns - twice its
 * own commentary, because the chart is the argument and the prose is a caption.
 *
 * The closing CTA named the forgetting curve for months with nothing behind it,
 * while src/lib/fsrs.ts sat in the repo able to draw the real one. Both lines
 * here come out of that file at build time - see src/lib/forgettingCurve.ts.
 *
 * The heading lost its "The forgetting curve" label in the move to cells. A
 * label that names the section above a heading that already says it is a
 * caption on a caption; the heading carries its own weight. */
function CurveCell() {
  return (
    <section
      aria-labelledby="curve-heading"
      className={`${GLASS_LARGE} ${PAD} col-span-1 sm:col-span-6 sm:p-12 lg:col-span-8`}
    >
      <h2
        id="curve-heading"
        className="max-w-2xl font-sans text-[clamp(2rem,4.6vw,3.25rem)] font-semibold leading-[0.97] tracking-[-0.04em] text-white [text-wrap:balance]"
      >
        Three reviews in six months.{" "}
        <span className="whitespace-nowrap text-white/35">
          {asPercent(CURVE.endRecall.reviewed)}% instead of{" "}
          {asPercent(CURVE.endRecall.studiedOnce)}%.
        </span>
      </h2>
      <p className="mt-5 max-w-xl text-base leading-relaxed text-white/60 sm:text-lg">
        <Hi>Plotted by the scheduler itself</Hi>, <Em>not drawn</Em>.
      </p>

      <figure className="mt-10">
        <figcaption className="mb-6 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-white/60 sm:text-sm">
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

        <p className="mt-7 border-t border-white/10 pt-5 text-xs text-white/60 sm:text-sm">
          Dashed line: 90% recall — where the next review lands.
        </p>
      </figure>
    </section>
  );
}

/** The spacing effect, as three numbers. Four columns beside the chart.
 *
 * Each gap is roughly four times the last, and that is not a drawing decision -
 * it falls out of the scheduler's own stability term (see
 * src/lib/fsrs.ts's stabilityAfterRecall). The bar beside each number draws it
 * to scale against the longest of the three, so the fourfold growth is visible
 * instead of being arithmetic the reader has to do.
 *
 * A small cell, so it gets the real frosted glass. */
function GapsCell() {
  return (
    <aside
      className={`${GLASS_SMALL} ${LIFT} ${PAD} col-span-1 flex flex-col justify-center sm:col-span-6 lg:col-span-4`}
    >
      <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/60 sm:text-xs">
        The gap it chose between reviews
      </p>
      <div className="mt-8 flex flex-col">
        {REVIEW_GAPS.map((gap, i) => (
          <div
            key={`gap-${i}`}
            className="flex items-baseline gap-4 border-t border-white/10 py-4 first:border-t-0 first:pt-0 last:pb-0"
          >
            <div className="font-sans text-[2.5rem] font-semibold tabular-nums leading-none tracking-[-0.04em] text-white sm:text-[3rem]">
              {gap}
            </div>
            <div className="text-[10px] uppercase tracking-[0.2em] text-white/60 sm:text-xs">
              {gap === 1 ? "day" : "days"}
            </div>
            <span
              aria-hidden="true"
              className="ml-auto h-1.5 max-w-[45%] self-center rounded-full bg-white/20"
              style={{ width: `${(gap / LONGEST_GAP) * 100}%` }}
            />
          </div>
        ))}
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// THE PRODUCT
// ---------------------------------------------------------------------------

/** The statement that frames the product cells. Four columns, so it reads as
 * one of them rather than as a banner over them.
 *
 * Its "Why FlowRecall" label is gone for the same reason the curve's was. */
function StatementCell() {
  return (
    <section
      aria-labelledby="features-heading"
      className={`${GLASS_SMALL} ${LIFT} ${PAD} col-span-1 flex flex-col justify-center sm:col-span-6 lg:col-span-5`}
    >
      <h2
        id="features-heading"
        className="font-sans text-[clamp(1.9rem,3.6vw,2.6rem)] font-semibold leading-[1.02] tracking-[-0.035em] text-white [text-wrap:balance]"
      >
        Every screen is one finding about memory,{" "}
        <span className="font-editorial italic">built</span>.
      </h2>
      <p className="mt-5 max-w-prose text-sm leading-relaxed text-white/60 sm:text-base">
        Not a flashcard app with the science in the marketing copy.{" "}
        <Hi>The mechanism each surface is built on is named on the card.</Hi>
      </p>
    </section>
  );
}

/** THE READER, and the one product cell that keeps a drawing.
 *
 * Six of the seven product cards used to carry a small aria-hidden mock each -
 * widening bars, three relationship pills, a tick list, a search field. Five of
 * them are gone, and the reason is what they were saying: the tick list read
 * "Got right / Left out / Had wrong" directly under a sentence containing the
 * words "what you left out and what you had wrong", the pills read
 * "needs / explains / vs" under a sentence naming all three, and the bars drew
 * the same widening interval the 2/12/50 cell draws to scale two rows above. A
 * diagram that repeats its own caption is not evidence, it is furniture - and
 * seven of them stacked into one column on a phone is most of what made this
 * page feel busy.
 *
 * This one survives because it shows something no sentence here can: a word
 * looked up without leaving the line it sits in. `--reader-highlight` keeps its
 * blue, and that is not an inconsistency with a monochrome page - a highlight
 * painted in white is not a highlight, it is emphasis. */
function ReaderCell() {
  return (
    <article
      className={`${GLASS_SMALL} ${LIFT} ${PAD} col-span-1 flex flex-col justify-center gap-8 sm:col-span-6 lg:col-span-7`}
    >
      <div className="max-w-md">
        <Effect>Encoding in context</Effect>
        <h3 className="font-sans text-[clamp(1.5rem,3vw,2rem)] font-semibold leading-[1.06] tracking-[-0.03em] text-white">
          Read it where it came from
        </h3>
        <p className="mt-4 max-w-prose text-sm leading-relaxed text-white/60 sm:text-base">
          EPUB, PDF, pasted text. <Hi>Any word defined in place</Hi>,{" "}
          <Em>without leaving the page</Em>.
        </p>
      </div>
      <div aria-hidden="true" className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
        <div className="h-1.5 w-full rounded bg-white/10" />
        <div className="mt-2.5 flex items-center gap-1.5">
          <span className="h-1.5 w-10 rounded bg-white/10" />
          <span className="rounded bg-reader-highlight/25 px-1.5 py-0.5 text-[10px] font-medium text-white">
            afferent
          </span>
          <span className="h-1.5 flex-1 rounded bg-white/10" />
        </div>
        <div className="mt-2.5 h-1.5 w-2/3 rounded bg-white/10" />
      </div>
    </article>
  );
}

/** THE OTHER FOUR MECHANISMS, AS ONE CELL RATHER THAN FOUR.
 *
 * Every word of all four cards survives - the mechanism name, the headline and
 * the line under it. What is gone is the repetition around them: four separate
 * bordered panes, four separate paddings, four drawings that restated their own
 * captions. On a phone those were four full-width boxes in a row, each shaped
 * exactly like the last, which is the shape a reader stops reading.
 *
 * A hairline list says the same things in one pane and reads as a contents page
 * rather than as a carousel of identical cards. It is also the honest structure:
 * these four are a list of mechanisms, and they always were. */
const MECHANISMS = [
  {
    effect: "Spaced retrieval",
    title: "A date per memory, not a daily pile",
    body: (
      <>
        FSRS-6 asks again <Hi>on the day your recall is predicted to hit 90%</Hi>.
      </>
    ),
  },
  {
    effect: "Relational encoding",
    title: "See what holds the deck up",
    body: (
      <>
        Needs, explains, easily confused — and <Em>the weak idea the others are built on</Em>.
      </>
    ),
  },
  {
    effect: "Production, not recognition",
    title: "Explain it back in your own words",
    body: (
      <>
        Get back <Hi>what you left out and what you had wrong</Hi>. <Em>Never a score.</Em>
      </>
    ),
  },
  {
    // The library is the one entry with a plain label rather than a borrowed
    // effect name: it is a shelf, not a finding, and dressing it as one would be
    // exactly the overclaim the statement cell exists to avoid.
    effect: "Your shelf",
    title: "Every deck, still findable in March",
    body: (
      <>
        <Hi>Search titles and concepts</Hi>, rename in place,{" "}
        <Em>undo a delete for six seconds</Em>.
      </>
    ),
  },
];

function MechanismsCell() {
  return (
    <section
      className={`${GLASS_SMALL} ${LIFT} ${PAD} col-span-1 sm:col-span-6 lg:col-span-7`}
      aria-label="What each screen is built on"
    >
      {/* Two up from `sm`, and that is a row decision rather than a taste one:
          as a single column of four this cell ran 635px against the 300px of
          the "Showing up" cell beside it, and grid stretches both to the taller
          - so its neighbour had to spend 335px on nothing. Two columns bring
          the pair within a hairline of each other. */}
      <ul className="grid grid-cols-1 gap-x-10 sm:grid-cols-2">
        {MECHANISMS.map(({ effect, title, body }) => (
          <li
            key={effect}
            className="border-t border-white/10 py-6 first:border-t-0 first:pt-0 sm:py-7 sm:[&:nth-child(2)]:border-t-0 sm:[&:nth-child(2)]:pt-0"
          >
            <Effect>{effect}</Effect>
            <h3 className="font-sans text-[clamp(1.35rem,2.4vw,1.7rem)] font-semibold leading-[1.08] tracking-[-0.03em] text-white">
              {title}
            </h3>
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-white/60 sm:text-base">
              {body}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The closing product cell, seven columns wide on purpose: spacing is the only
 * finding on this page that the app cannot deliver on its own - it needs the
 * student to come back - so the cell that admits that gets the widest span in
 * its row.
 *
 * The mini streak calendar echoes StreakModal.tsx's DayCell visual language.
 * It is hardcoded decoration, aria-hidden, in the same family as the page's
 * other mocks, and not a claim about anybody's real streak.
 *
 * IT IS A FULL-WIDTH BAND AT THE BOTTOM, NOT A CHIP BESIDE THE COPY. Grid
 * stretches every cell to its row's tallest member, and this one shares a row
 * with the four-step list - so a `lg:flex-row items-center` arrangement left
 * roughly 380px of dead air above and below a headline and seven small squares
 * floating in the middle of it. A column that pushes the band to the floor of
 * the cell spends the same height on purpose: the squares grow into a week you
 * can read at a glance, which is what the copy above them is about. */
function ShowingUpCell() {
  return (
    <article
      className={`${GLASS_LARGE} ${PAD} col-span-1 flex flex-col justify-between gap-10 sm:col-span-6 sm:p-12 lg:col-span-5`}
    >
      <div className="max-w-xl">
        <Effect>Showing up</Effect>
        <h3 className="font-sans text-[clamp(1.6rem,3.4vw,2.25rem)] font-semibold leading-[1.05] tracking-[-0.035em] text-white">
          The part no scheduler can do
        </h3>
        <p className="mt-4 max-w-prose text-sm leading-relaxed text-white/60 sm:text-base">
          <Hi>Ten, twenty or forty minutes</Hi>, built from <Em>whatever is closest to slipping</Em>.
        </p>
      </div>
      {/* `flex-1` on each square rather than a fixed size, so the band is the
          cell's width at every breakpoint instead of seven fixed chips with a
          ragged right edge. `aspect-square` caps how tall they grow. */}
      <div className="flex items-stretch gap-2 sm:gap-3" aria-hidden="true">
        {[true, true, true, true, true, false, false].map((filled, i) => (
          <span
            key={i}
            className={`aspect-square flex-1 rounded-lg sm:rounded-2xl ${
              filled ? "bg-white" : "border border-white/15"
            }`}
          />
        ))}
      </div>
    </article>
  );
}

// ---------------------------------------------------------------------------
// THE FOUR STEPS
// ---------------------------------------------------------------------------

const HOW_IT_WORKS_STEPS = [
  { n: "01", title: "Upload", body: "A PDF, or notes you paste in." },
  { n: "02", title: "Map", body: "See what depends on what." },
  { n: "03", title: "Recall", body: "Swipe, then type it from memory." },
  { n: "04", title: "Hold", body: "Watch the projection move." },
];

/** Five columns beside "Showing up".
 *
 * The numerals stay because the sequence is the information here - this is the
 * one place on the page where order is the content. They are mono and small
 * instead of the 7xl `font-black` ghosts they were: at 6% opacity those were
 * texture behind a heading, and in a five-column cell there is no room for
 * texture that large. It also retires the last weight above 600 on the page.
 *
 * TWO BY TWO RATHER THAN A LIST OF FOUR, AND THAT IS A ROW DECISION RATHER THAN
 * A TASTE ONE. Grid stretches every cell to its row's tallest member, and four
 * stacked steps made this the tallest by roughly 300px - which its neighbour
 * then had to spend on nothing. Folding the steps into two rows brings the two
 * cells to within a hairline of each other's natural height, so the row reads
 * as a pair rather than as one cell with a hole beside it. The reading order
 * survives it: 01 and 02 on the first row, 03 and 04 under them. */
function StepsCell() {
  return (
    <section
      aria-labelledby="how-it-works-heading"
      className={`${GLASS_LARGE} ${PAD} col-span-1 flex flex-col sm:col-span-6 sm:p-12 lg:col-span-5`}
    >
      <h2
        id="how-it-works-heading"
        className="font-sans text-[clamp(1.75rem,3.4vw,2.4rem)] font-semibold leading-[1.02] tracking-[-0.035em] text-white [text-wrap:balance]"
      >
        From a PDF to still knowing it, in four steps.
      </h2>
      <ol className="mt-8 grid grid-cols-1 gap-x-8 sm:grid-cols-2">
        {HOW_IT_WORKS_STEPS.map((step) => (
          <li key={step.n} className="border-t border-white/10 py-5">
            <span className="font-mono text-[10px] tabular-nums tracking-[0.2em] text-white/60">
              {step.n}
            </span>
            <h3 className="mt-3 text-lg font-semibold tracking-[-0.02em] text-white">
              {step.title}
            </h3>
            <p className="mt-1.5 max-w-prose text-sm leading-relaxed text-white/60">{step.body}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

// ---------------------------------------------------------------------------
// FAQ AND THE CLOSE
// ---------------------------------------------------------------------------

/** Seven columns. Every answer ships in the markup whether or not its
 * `<details>` is open, because FAQPAGE_JSONLD declares seven Q&A pairs and
 * Google requires the answer text to be present on the page for the rich
 * result - a schema block whose answers are absent is what earns a manual
 * action. */
function FaqCell() {
  return (
    <section
      aria-labelledby="faq-heading"
      className={`${GLASS_LARGE} ${PAD} col-span-1 sm:col-span-6 sm:p-12 lg:col-span-7`}
    >
      {/* Google Rich Results: FAQPage — surfaces Q&As directly in search. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(FAQPAGE_JSONLD) }}
      />
      <h2
        id="faq-heading"
        className="font-sans text-[clamp(1.75rem,3.4vw,2.4rem)] font-semibold leading-[1.02] tracking-[-0.035em] text-white"
      >
        Frequently asked questions
      </h2>
      <div className="mt-8 divide-y divide-white/10 border-t border-white/10">
        {FAQ_ITEMS.map(({ q, a }) => (
          <details key={q} className="group py-4">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-1 [&::-webkit-details-marker]:hidden">
              <h3 className="text-base font-medium tracking-[-0.01em] text-white/70 transition-colors group-open:text-white group-hover:text-white sm:text-lg">
                {q}
              </h3>
              <span className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-white/15 text-white/60 transition-transform duration-300 group-open:rotate-45 motion-reduce:transition-none">
                <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5" aria-hidden="true">
                  <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </span>
            </summary>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-white/60 sm:text-base">{a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

/** The close, five columns beside the FAQ.
 *
 * Its copy is deliberately a different rhetorical move from the hero's, not
 * just different words for the same one: the hero states the solution as a
 * punchy imperative ("Stop re-reading. Start recalling."), so a second
 * imperative here read as pure repetition. This one leads with the
 * uncomfortable, research-backed problem before naming the fix. It is not an
 * assertion either - CurveCell above draws the curve this paragraph names.
 *
 * Its 28rem blurred wash is gone with the page's other background glows. The
 * only glow on this cell is the CTA's own spill, which is the thing a reader is
 * meant to press. */
function CloseCell() {
  return (
    <section
      aria-labelledby="final-cta-heading"
      className={`${GLASS_LARGE} ${PAD} col-span-1 flex flex-col items-center justify-center text-center sm:col-span-6 sm:p-12 lg:col-span-12 lg:py-24`}
    >
      <h2
        id="final-cta-heading"
        className="pb-1 font-sans text-[clamp(2rem,4.6vw,3rem)] font-semibold leading-[0.97] tracking-[-0.04em] text-white [text-wrap:balance]"
      >
        You&apos;ll forget most of this{" "}
        <span className="font-editorial italic">by tomorrow</span>.
      </h2>
      <p className="mt-5 max-w-md text-base leading-relaxed text-white/60 sm:text-lg">
        That&apos;s <Hi>the curve above</Hi>, <Em>not a guess</Em>.
      </p>
      <div className="mt-9 flex w-full max-w-xs flex-col gap-3 sm:max-w-none sm:flex-row">
        <PrimaryCta className="w-full sm:w-auto" />
        <SecondaryCta className="w-full sm:w-auto" />
      </div>
    </section>
  );
}

/** Kept local to page.tsx (not a shared component) since this is a
 * home-page-only footer, not a site-wide one. Outside the grid: a footer is not
 * a cell, and giving it the same glass would make the page look like it has one
 * more thing to say. */
function SiteFooter() {
  return (
    <footer className="mx-auto mt-3 w-full max-w-[88rem] border-t border-white/10 px-6 py-12 sm:mt-4 sm:px-8 sm:py-14">
      <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col items-center gap-2 sm:items-start">
          <div className="flex items-center gap-2">
            <div className="relative flex h-7 w-7 items-center justify-center overflow-hidden rounded-[28%] bg-gradient-to-br from-zinc-800 to-zinc-950 text-white">
              <LogoMark sheen className="h-[64%] w-[64%]" />
            </div>
            <span className="font-retro text-lg text-white">FlowRecall</span>
          </div>
          <p className="text-xs text-white/60">AI flashcards for active recall.</p>
        </div>
        <nav className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-white/60">
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
      <p className="mt-10 text-center text-xs text-white/60 sm:text-left">
        © {new Date().getFullYear()} FlowRecall
      </p>
    </footer>
  );
}

export default function Home() {
  const decks = useSavedDecks();
  // `useIsNative<boolean>(false)` rather than a bare call: the hook's generic
  // widens to `boolean | null` when it has nothing to infer from, and the
  // tri-state is for src/app/account/page.tsx, which must render neither branch
  // until Capacitor answers. Here the web branch IS the right answer before it
  // resolves - that is what keeps the static export and the SEO payload intact.
  const isNative = useIsNative<boolean>(false);

  return (
    // `aw-page` pins the dark token values for this page's subtree
    // (globals.css). The cells are hard-coded white-on-black, but
    // RetentionCurve and TodaySession draw themselves from
    // --foreground/--accent - without this scope, a visitor in light mode gets
    // a near-black chart line on a black cell. It also carries this page's
    // ::selection, focus ring and scrollbar.
    <main className="aw-page relative flex flex-1 flex-col bg-black pb-px">
      <Backlight />

      {/* Google Rich Results: SoftwareApplication (Educational Application). */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(SOFTWARE_APP_JSONLD) }}
      />

      {/* THE GRID. Twelve columns on lg, six on sm, one on a phone. Every row is
          uneven by design: 7/5 · 12 · 8/4 · 4/4/4 · 5/4/3 · 7/5 · 7/5. The gap
          is the only spacing between cells - no section padding, no vertical
          rhythm to keep in sync, and nothing that needs a margin collapse to
          behave. */}
      <div
        className={`mx-auto grid w-full max-w-[88rem] grid-cols-1 gap-4 px-3 pb-32 sm:grid-cols-6 sm:gap-6 sm:px-5 sm:pb-40 lg:grid-cols-12 ${
          isNative ? "pt-2" : "pt-4 sm:pt-6"
        }`}
      >
        <HeroCluster decks={decks} isNative={isNative} />

        <FactCell />

        <CurveCell />
        <GapsCell />

        <StatementCell />
        <ReaderCell />

        <MechanismsCell />
        <ShowingUpCell />

        <StepsCell />
        <FaqCell />

        <CloseCell />
      </div>

      <SiteFooter />
    </main>
  );
}
