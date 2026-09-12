"use client";

import { useEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";
import Link from "next/link";
import { getFactCursor, setFactCursor, useSavedDecks } from "@/lib/storage";
import { factAt, nextCursor } from "@/lib/brainFacts";
import { useIsNative } from "@/lib/useIsNative";
// The Reader's OWN type stacks, imported rather than retyped. `READER_FONTS_HREF`
// is already linked globally (layout.tsx), so Inter and Atkinson Hyperlegible are
// on this page today - the specimens below cost no additional bytes, and the mock
// renders in literally the face the Reader renders in.
import { FONT_FAMILY_CSS } from "@/lib/readerPreferences";
// The eye filter's OWN computation, not an impression of it. `eyeFilterColor` is
// the same pure function EyeFilterOverlay.tsx calls to paint the real reader, so
// the swatches below are the shipped colours rather than hand-picked ambers.
//
// Importing is cheap here and that was checked: eyeFilter.ts is ~6KB, most of it
// docblocks, and its only non-React dependency is readerPreferences - already in
// this file's import graph for the serif stack above. (Contrast starterDeck.ts,
// which LOOP_CARD copies from by hand precisely because it is 20.9KB in one const.)
import { eyeFilterColor, WARMTH_IDS, WARMTH_LABELS } from "@/lib/eyeFilter";
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

/** A NOTE ON backdrop-filter ON THIS ROUTE, BECAUSE IT SHIPPED A VISIBLE BUG.
 *
 * On a real Android phone the FAQ card rendered with a hard horizontal seam across
 * it: flat luminance 8 above, flat 16 below, no ramp between. `bg-white/[0.03]` over
 * black computes to 7.65 - so 16 is that fill composited TWICE, and the dark region
 * overhung the card's own rounded corner, which no CSS box can do. It did not
 * reproduce headless at the same width and scroll offset, where the card measured a
 * uniform 8 throughout. A compositor tile boundary, not a stylesheet mistake.
 *
 * The trigger was volume: ELEVEN elements on this page carried `backdrop-filter`,
 * four of them `blur(64px)`, over a `position: fixed` backdrop (Backlight). Chrome
 * snapshots the backdrop root per tile, and with that many layers a tile edge becomes
 * a seam.
 *
 * FOUR OF THOSE BLURS WERE BUYING NOTHING, which is what made this cheap to fix. The
 * docblock below already says it: a blur over flat #000 is a no-op because there is
 * nothing behind it to blur. The loop panes, the reader passage and the definition
 * popover all sit INSIDE a card, on a black page - they were paying a compositing
 * layer each to blur nothing. They keep their fill and their lit edge, which is what
 * the material was always made of, and look identical.
 *
 * THE RULE THIS LEAVES: `backdrop-filter` on this route only where something real is
 * behind the element - the sticky Navbar over scrolling content, the tab bar, the
 * upload sheet. Not on a pane that sits on a card. If a seam ever returns, the next
 * lever is making Backlight `absolute` rather than `fixed`; that is held back because
 * a fixed backlight is why the glow stays put while the grid travels past it. */
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
/** The three shelves the questions sit on, in the order a stranger asks them:
 * what is this, how does it work, should I pick it. The array is the render
 * order - `FaqCell` walks it and filters, rather than each group knowing its own
 * position - so re-ordering the section is a one-line edit here.
 *
 * A GROUP IS A FIELD ON THE ITEM, NOT A NESTED ARRAY, AND THAT IS DELIBERATE.
 * `FAQPAGE_JSONLD` maps over `FAQ_ITEMS` destructuring `{ q, a }`; nesting the
 * items one level deeper would have rewritten that schema, and a FAQPage whose
 * answers move is exactly the thing Google issues manual actions over. A extra
 * key is invisible to the destructure, so the emitted JSON-LD is byte-identical
 * to what it was before this section was reorganised. Verified, not assumed. */
const FAQ_GROUPS = ["Starting out", "How it works", "Choosing it"] as const;

const FAQ_ITEMS = [
  {
    group: "Starting out",
    q: "What is an active recall app?",
    a: "An active recall app makes you retrieve answers from memory instead of passively re-reading notes — the most effective, research-backed way to study. FlowRecall turns your notes into an endless feed of active-recall questions, so you practise retrieval every time you open it.",
  },
  {
    group: "Starting out",
    q: "Can I generate flashcards from a PDF?",
    a: "Yes. Upload any PDF — lecture slides, a textbook chapter, or research papers — and FlowRecall's AI automatically generates hundreds of flashcards in seconds. No manual typing or formatting required.",
  },
  {
    group: "How it works",
    q: "What spaced repetition algorithm does FlowRecall use?",
    a: "FSRS-6 — the Free Spaced Repetition Scheduler — ported from its published specification rather than approximated. It keeps a stability and a difficulty for every concept, and schedules the next review for the day your recall is predicted to fall to 90%. It runs on your device, so the feed works offline.",
  },
  {
    group: "How it works",
    q: "Can I read books and PDFs inside FlowRecall?",
    a: "Yes. The Reader opens EPUBs, PDFs and pasted text, remembers your place in each, and lets you long-press any word for a definition without leaving the page. Highlights carry notes, type is serif, sans or hyperlegible, and a warm eye filter takes the glare off late-night reading.",
  },
  {
    group: "Choosing it",
    q: "Is FlowRecall better than Anki for med school?",
    a: "FlowRecall skips Anki's biggest cost: building the deck by hand. Upload your material and FlowRecall's AI writes the flashcards for you in seconds, then serves them as a gamified active-recall feed instead of a static list. For medical students juggling huge volumes of content, that means hours saved on deck-building and more time spent actually reviewing.",
  },
  {
    group: "Choosing it",
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
          {/* THE ONE HUE ON THIS PAGE, AND IT IS THE ONE THE SYSTEM ALREADY OWNS.
              `hsl(217 91% 60%)` is `--reader-highlight` - globals.css's single
              sanctioned exception to "no hue anywhere", and the only colour in this
              codebase that does NOT invert between themes, because the same azure
              reads on a near-black and a near-white ground alike.

              WHY IT IS WRITTEN OUT RATHER THAN READ FROM A TOKEN. Two reasons, and
              the second is the real one. First, `.aw-page` re-declares its palette
              as literals by design (see globals.css) - this page does not follow
              the theme, so a token here would be the odd one out. Second, the token
              that *should* fit, `--pulse-accent`, is defined for exactly this job
              ("is this alive" signal colour) and was this exact blue before being
              retired to white - but it currently has ZERO call sites anywhere in
              the app. Routing through it would not make this dot configurable, it
              would revive a dead token to serve one element, and the next reader
              would reasonably assume changing it does something elsewhere.

              THE GLOW IS BRIGHTER THAN THE WHITE ONE IT REPLACES, AND THAT IS
              ARITHMETIC RATHER THAN TASTE. White spills at luma 255; this blue
              computes to rgb(60,131,246), luma ~124 - a little under half. At the
              old 10px/0.55 the dot stopped reading as lit and started reading as a
              blue disc with a smudge, so the bloom is widened and lifted to carry
              the same presence. */}
          <span className="h-1.5 w-1.5 rounded-full bg-[hsl(217_91%_60%)] shadow-[0_0_12px_3px_rgba(60,131,246,0.7)]" />
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

          NO `.fr-rise` ON THIS SLAB, AND THAT WAS A BUG BEFORE IT WAS A DECISION.
          Putting an entrance on a whole pane meant the primary action did not
          exist for the first second of the page. The slab is present at first
          paint; only the words move. (This rule used to name a second pane, the
          proof slab that sat beside this one at columns 5-7 - that cell is gone
          and this row now belongs to this slab alone.) */}
      <section
        aria-label="Get started"
        className={`${GLASS_LARGE} ${PAD} group/action flex flex-col justify-center gap-6 sm:p-10 lg:col-span-7 lg:col-start-1 lg:row-start-2`}
      >
        <TodaySession decks={decks} />

        {/* No session: the pair of pills. Stacked and full-width on a phone, side
            by side from `lg` - which is new, and it is the width change forcing it
            rather than a restyle. This slab was four columns and is now seven, so
            two stacked `w-full` pills went from a tidy column to a pair of ~800px
            lozenges at the page's max width, which is the shape of a form field,
            not of a call to action. `sm:flex-row` + `sm:w-auto` is the same pattern
            CloseCell already uses for the same pair; it is keyed at `lg` here
            because that is where the slab actually widens. */}
        <div className="flex flex-col gap-3 group-has-[#tonight-heading]/action:hidden lg:flex-row lg:items-center">
          <PrimaryCta className="w-full lg:w-auto" />
          <SecondaryCta className="w-full lg:w-auto" />
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
      // cluster and spans BOTH its rows, so the action tile sits under the
      // headline rather than under the loop. Without the row-span it auto-placed
      // into row 1 only and left columns 8-12 of row 2 as a hole in the grid -
      // which is the same "floating in a void" the cluster exists to remove,
      // just relocated.
      className={`${GLASS_LARGE} ${PAD} col-span-1 flex flex-col sm:col-span-6 sm:p-10 lg:col-span-5 lg:col-start-8 lg:row-span-2 lg:row-start-1`}
    >
      {/* THE HEADLINE BREAKS ACROSS TWO VOICES, WHICH IS THIS PAGE'S OWN MOVE
          RATHER THAN A NEW ONE. The hero sets "Stop re-reading." in the sans and
          hands "Start recalling." to the serif; CloseCell does the same with "by
          tomorrow". This cell was the one display headline still set entirely in
          Geist, so it read as a section label beside two headlines that read as
          typography. Now the sans states the instruction and the serif carries
          the turn - "Answer it / *before you're told*" - which is also where the
          sentence's meaning actually pivots.

          `font-normal` ON THE SERIF IS LOAD-BEARING, NOT DECORATION. Newsreader
          is loaded at weight 400 italic and nothing else (layout.tsx). The `h2`
          is `font-semibold`, and a child inherits that - so without this reset
          the browser has no 600 to reach for and SYNTHESISES one, smearing the
          italic to fake a bold. The fallback stack behind it (Georgia, Times)
          does have real weights, which is worse: the bug then only appears when
          the webfont loads, i.e. not in the first paint you would screenshot.

          THE TWO LINES CARRY OPPOSITE TRACKING ON PURPOSE. Display sans wants to
          be pulled tight (-0.04em, the value every other headline here uses); an
          italic serif is already tightly fitted by its own drawing, and pulling
          it in collides the descenders into the next letter's bowl. -0.01em is
          effectively "leave it alone", and it is written out rather than omitted
          so a later pass does not "fix" the inconsistency by matching them.

          `text-[1.12em]` RATHER THAN A SECOND `clamp()`: it multiplies whatever
          the parent clamp resolved to, so the two lines scale together at every
          width and there is no second fluid ramp to keep in sync with the first. */}
      <h2 className="font-sans text-[clamp(1.9rem,4.6vw,2.7rem)] font-semibold leading-[1.0] tracking-[-0.04em] text-white">
        Answer it
        <span className="mt-1 block font-editorial text-[1.12em] font-normal italic tracking-[-0.01em]">
          before you&apos;re told
        </span>
      </h2>

      {/* /60 and not lower. It is the documented floor for real prose on this
          ground - 7.4:1 on pure black - and this is prose, not chrome. */}
      <p className="mt-5 max-w-sm text-sm leading-relaxed text-white/60 sm:text-base">
        Drop a PDF in. <Hi>Swipe a claim true or false</Hi> — then{" "}
        <Hi>type it back from memory</Hi>.
      </p>

      {/* THE LOOP, AS TWO PANES AND A WAIT - NOT AS THREE STACKED BOXES.
          It was three blocks, each opening with its own full-width `border-t`
          and mono label. Three horizontal rules at even intervals is a table of
          contents, and it made the most important drawing on the page read as
          furniture. Two of those rules are gone. What is left is the shape of
          the thing being described: a card you answer, a gap you forget across,
          and a card you answer again with nothing to recognise.

          THE STAGGER IS THE MOTION, AND IT COSTS NOTHING TO RENDER. The question
          pane is inset from the right and the answer pane from the left, so the
          eye travels diagonally down the cell instead of straight down a stack.
          `sm:` only - at 360dp the cell has no width to spend on an indent, and
          a stagger that narrows the panes on the smallest screen is decoration
          charged to the people with the least room for it.

          NO HOVER LIFT ON ANY OF IT, DELIBERATELY. `.fr-lift` was available and
          is the wrong tool twice over: this subtree is `aria-hidden` and
          non-interactive, so a hover response would promise an affordance that
          does not exist, and the panes carry `backdrop-blur-3xl` - scaling one
          re-samples a 64px filter every frame it runs. The page's standing rule
          is one authored moment, in the hero. This is not it.

          `min-w-0` THROUGHOUT: a flex item defaults to min-width:auto, so
          without it a column refuses to shrink below its own min-content and
          pushes past the cell at 360dp - clipped rather than scrolling, which is
          the worst kind of bug because the page still looks fine in a width
          test. */}
      <div className="mt-10 flex flex-1 flex-col justify-end" aria-hidden="true">
        {/* BEAT ONE — the question. A claim, and two ways to answer it. */}
        <figure className="min-w-0 sm:mr-7">
          <figcaption className="mb-2.5 font-mono text-[10px] uppercase tracking-[0.2em] text-white/40">
            Question
          </figcaption>
          {/* The prompt sits ABOVE the card, small and muted, because that is
              where SwipeChallenge.tsx:147 puts it - the question frames the card,
              it is not part of it. */}
          <p className="mb-2.5 text-[13px] leading-snug text-white/50">{LOOP_CARD.question}</p>

          <div className="min-w-0 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
            {/* `← False` / `True →` in the corners, 10px uppercase and widely
                tracked, copied from SwipeChallenge.tsx:185-193. They are the whole
                instruction: two directions and a claim between them. Bars could
                not say this, and the sentence above the drawing had to. */}
            <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-[0.16em] text-white/40">
              <span>&larr; False</span>
              <span>True &rarr;</span>
            </div>
            <p className="mt-3.5 text-[15px] font-medium leading-snug text-white">
              {LOOP_CARD.claim}
            </p>
          </div>
        </figure>

        {/* BEAT TWO — the wait. It is a gap, not a screen, so it is drawn as one:
            the two panes' breathing room, with a hairline crossing it and the
            scheduler's own word for what happens in there. The rule fades out to
            the right so it reads as time passing rather than as a divider. */}
        <div className="flex items-center gap-3 py-6">
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/40">
            Think
          </span>
          <span className="h-px min-w-0 flex-1 bg-gradient-to-r from-white/20 via-white/10 to-transparent" />
          <span className="shrink-0 font-editorial text-sm italic text-white/50">days later</span>
        </div>

        {/* BEAT THREE — the answer, and the climax the whole cell is built to
            reach. Brighter glass, a lit edge, and `GLOW` - the page's white
            spill, spent in exactly two places (the primary CTA and here), which
            is the accent spent where the loop pays off. Nothing on screen to
            recognise: the blank is the point. */}
        <figure className="min-w-0 sm:ml-7">
          <figcaption className="mb-2.5 font-mono text-[10px] uppercase tracking-[0.2em] text-white/40">
            Answer
          </figcaption>
          <div className={`min-w-0 rounded-2xl border border-white/20 bg-white/[0.07] p-4 ${GLOW}`}>
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/60">
              Type it from memory
            </div>
            {/* THE BLANK IS INLINE, IN THE SENTENCE - not a box under it. That is
                how ClozeChallenge.tsx:136 renders it (an input with `border-b-2`
                in the accent colour, sitting in the run of text), and it is the
                difference between "fill this field" and "finish this sentence".

                IT IS EMPTY, AND THAT IS THE POINT OF THE WHOLE BEAT. The first
                card hands you a claim to judge; this one hands you nothing to
                recognise. Pre-filling it with the answer would quietly turn the
                climax of the loop back into recognition - the exact thing the
                page argues re-reading already does. */}
            <p className="mt-3 text-[15px] leading-relaxed text-white">
              {/* `trimEnd()` + a NON-BREAKING space, so the blank cannot be
                  separated from the word it belongs to. The cloze reads
                  "...because retrieval _____ the memory", and at this column width
                  the line broke in the one place it must not: "retrieval" ending
                  line one and the gap opening line two, where a bare rule at the
                  left margin reads as a divider rather than as the missing word.
                  Bound to the verb, the pair wraps together or not at all. */}
              {LOOP_CARD.clozeBefore.trimEnd()}
              <span className="whitespace-nowrap">
                &nbsp;
                <span className="inline-block w-20 border-b-2 border-white align-[-0.1em]" />
              </span>
              {LOOP_CARD.clozeAfter}
            </p>
          </div>
        </figure>
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
      className={`${GLASS_LARGE} ${PAD} col-span-1 sm:col-span-6 sm:p-12 lg:col-span-12`}
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

/** THE READER, seven columns beside the four steps.
 *
 * WHY IT IS BACK. This component existed and was rendered by nothing - one of
 * four cells left defined-but-unreachable in this file. That is how the page
 * ended up describing a study loop and never once mentioning that the documents
 * it studies can be READ inside the app: the reader's only trace was one FAQ
 * answer, eleven screens down, past the point anyone deciding still reads.
 *
 * IT PAIRS WITH `FaqCell`, AND THE PAIR IS THE ARGUMENT. Five columns answer
 * what a stranger arrives wanting to know; seven say what it is like to be
 * inside a document. It paired with the four-step rail first; that rail is gone,
 * and the FAQ inherited the slot.
 *
 * THREE FEATURES ACROSS, AND DELIBERATELY NOT A NUMBERED RAIL. Marking, resuming
 * and type settings are independent things a reader can do in any order, so
 * numbering them would assert a progression that does not exist. A spec sheet
 * says "capabilities"; a rail would say "stages", which would be a lie told in
 * layout. (The page did carry such a rail, beside this cell, for the four-step
 * pipeline - where the sequence was real.)
 *
 * It was four. Define left the list when the drawing above started actually
 * showing it - see the note on READER_FEATURES.
 *
 * EVERY CLAIM HERE IS THE FAQ'S, NOT A NEW ONE. The copy is drawn from the
 * already-vetted answer to "Can I read books and PDFs inside FlowRecall?" -
 * EPUB/PDF/pasted text, long-press to define in place, highlights that carry
 * notes, per-document resume, three type faces and the warm eye filter. Nothing
 * is claimed here that the app does not already do, and nothing was invented to
 * fill the grid.
 *
 * THE DRAWING IS THE ONLY ONE LEFT ON THE PAGE, AND IT NOW EARNS THAT. Five
 * sibling mocks were cut for restating their own captions. This one was nearly
 * cut for a worse reason - it restated nothing because it said nothing: three
 * grey bars and a chip. It now shows the thing no sentence can, a word looked up
 * WITHOUT the line moving, in the Reader's own typeface.
 *
 * `--reader-highlight` keeps its blue, and that is not a break with a monochrome
 * page - a highlight painted white is not a highlight, it is emphasis. It is
 * also now the second place on this page carrying that exact azure, after the
 * hero's live dot, which makes it read as the product's one colour rather than
 * as a one-off. */
function ReaderCell() {
  return (
    <article
      // `lg:self-start`, AND IT IS THE LESSER OF TWO BAD OPTIONS RATHER THAN A
      // preference. The FAQ beside this cell runs taller - 894px against 721px,
      // measured after the drawing was rebuilt - and a grid item stretches to its
      // row by default, so this card was being handed height it had no content
      // for. (The gap was 257px before the redesign and is 173px now; the fuller
      // drawing closed a third of it. Not enough to stretch honestly, so the flag
      // stays - re-measure if this cell grows again.)
      //
      // Both ways of spending that height were tried and looked at. `mt-auto` on
      // the spec sheet pushed it to the bottom edge and opened a ~400px void
      // between the drawing and the features - a hole in the middle of a card,
      // which is precisely the "floating in a void" this page has been rebuilt
      // twice to remove. `justify-between` only splits the same void into two
      // smaller ones.
      //
      // `self-start` declines the height instead. The row is then two cards of
      // honest different heights, top-aligned, with page ground below the shorter
      // one - which is what a card that has said what it has to say should look
      // like. Raggedness between cards is cheap; a void inside one is not.
      className={`${GLASS_LARGE} ${PAD} col-span-1 flex flex-col sm:col-span-6 sm:p-12 lg:col-span-7 lg:self-start`}
    >
      {/* The same two-voice headline as LoopCell: the sans states it, the serif
          turns it. `font-normal` on the italic is the required reset - Newsreader
          ships 400 only, and an inherited 600 makes the browser synthesise a
          bold. Tracking loosens on the serif for the same reason it does there. */}
      <h2
        id="reader-heading"
        className="font-sans text-[clamp(1.75rem,3.4vw,2.4rem)] font-semibold leading-[1.02] tracking-[-0.035em] text-white"
      >
        Read it where
        <span className="mt-1 block font-editorial text-[1.1em] font-normal italic tracking-[-0.01em]">
          it came from
        </span>
      </h2>

      {/* IT NAMES DEFINING AGAIN, AND THE REASON IT DID NOT BEFORE IS GONE.
          This line was deliberately silent about Define while "DEFINE: long-press
          a word..." sat in the feature list eight lines below - two sentences
          making one claim. The list no longer carries it (the drawing does), and
          the drawing is `aria-hidden`, so if this line stays silent the single
          most important thing the Reader does exists on this page only as a
          picture. Prose has to carry it, and this is the prose.

          The device claim rides along because it is the other thing a stranger
          wants to know about a reader that holds their files, and it is the
          library's own wording, not a new promise. */}
      <p className="mt-5 max-w-xl text-sm leading-relaxed text-white/60 [text-wrap:pretty] sm:text-base">
        EPUB, PDF, or notes you paste in, <Hi>kept on your device</Hi>. Long-press
        any word and the definition opens <Em>over the page you are on</Em>.
      </p>

      {/* THE DRAWING, AND IT IS THE ONLY THING IN THIS CELL DOING THE TEACHING.
          It was three grey bars and a blue chip. Bars say "some text exists".
          They do not say "this is a book", and they say nothing whatsoever about
          the feature this cell is built around - a word looked up WITHOUT the
          page moving. That is the one claim no sentence here can make and a
          picture can, and the old picture declined to make it.

          SET IN THE READER'S OWN FACE, NOT A NEW ONE. `FONT_FAMILY_CSS.serif` is
          literally what the Reader renders body text in by default (Georgia,
          Cambria, Times), imported rather than retyped. So this is not an artist's
          impression of the Reader - at this size it IS the Reader's typography.
          A new display font would have cost bytes and told the truth less well.

          THE POPOVER OVERLAPS THE PROSE ON PURPOSE, and that overlap is the whole
          argument: the lines continue underneath it. Anchored below the word it
          defines, so the eye goes word -> card without being told to. Its shape
          is copied from the real `DefinitionPopover` - phrase in curly quotes at
          13px semibold, a one-sentence body, then `✦ Define` / `▍ Highlight` /
          `✎ + Note` - so the mock cannot drift into advertising a control that
          does not exist.

          NO ENTRANCE ANIMATION, AND THAT IS THE RULE RATHER THAN AN OVERSIGHT. A
          definition card that fades in is exactly the tempting thing this page's
          one-authored-moment rule (see the head of this file) exists to refuse;
          everything below the fold is present at first paint. */}
      <div aria-hidden="true" className="relative mt-8">
        <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-6 sm:p-7">
          <p
            className="text-[15px] leading-[1.85] text-white/70 sm:text-base"
            style={{ fontFamily: FONT_FAMILY_CSS.serif }}
          >
            {READER_PASSAGE.before}
            {/* The selection: the app's one sanctioned hue, and the same azure the
                hero's live dot carries - two uses make it the product's colour
                rather than a one-off. `decoration-2` under it so the word still
                reads as marked where the fill alone is subtle. */}
            <span className="rounded-[3px] bg-reader-highlight/25 px-0.5 text-white underline decoration-reader-highlight decoration-2 underline-offset-4">
              {READER_PASSAGE.word}
            </span>
            {READER_PASSAGE.after}
          </p>
        </div>

        {/* `static` below `sm`, absolute above it. At 360dp there is no room to
            float a card over a paragraph without covering the sentence that gives
            the word its sense, so on a phone it sits under the passage and the
            overlap is simply not attempted. From `sm` it lifts onto the page. */}
        <div className="mt-3 w-full sm:absolute sm:left-7 sm:top-[4.25rem] sm:mt-0 sm:w-[19rem]">
          <div className="overflow-hidden rounded-2xl border border-white/15 bg-black/90 shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_24px_56px_-16px_rgba(0,0,0,0.95)]">
            <div className="border-b border-white/10 px-3.5 py-2.5">
              <p className="truncate text-[13px] font-semibold text-white">
                &ldquo;{READER_PASSAGE.word}&rdquo;
              </p>
            </div>
            <p className="px-3.5 py-3 text-[13px] leading-relaxed text-white/70">
              {READER_DEFINITION}
            </p>
            <div className="flex items-center gap-1.5 border-t border-white/10 px-3.5 py-2.5">
              <span className="rounded-lg bg-white px-2.5 py-1 text-[11px] font-semibold text-black">
                ✦ Define
              </span>
              <span className="rounded-lg border border-reader-highlight/40 bg-reader-highlight/10 px-2.5 py-1 text-[11px] font-medium text-reader-highlight">
                ▍ Highlight
              </span>
              <span className="rounded-lg border border-white/15 px-2.5 py-1 text-[11px] font-medium text-white/70">
                ✎ Note
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* `sm:mt-28` IS A MEASUREMENT, NOT A ROUND NUMBER. From `sm` the card is
          absolutely positioned and hangs past the bottom of the passage box - by
          77px at 1440, measured off the live page rather than estimated. At the
          64px this first carried, the card's lower edge crossed the first feature
          rule by 14px and the hairline ran behind it. 112px clears the overhang
          with ~35px of air left over, which is what keeps the card reading as
          "over the page" rather than "colliding with the next section".
          Below `sm` the card is in normal flow and needs no allowance at all. */}
      <dl className="mt-9 grid grid-cols-1 gap-x-8 gap-y-0 sm:mt-28 sm:grid-cols-3">
        {READER_FEATURES.map((feature) => (
          <div key={feature.label} className="border-t border-white/10 py-5">
            <dt className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/40">
              {feature.label}
            </dt>
            <dd className="mt-2.5 text-sm leading-relaxed text-white/60">{feature.body}</dd>

            {/* COMFORT SHOWS THE EYE FILTER, AND THE SWATCHES ARE THE REAL COLOURS.
                This slot used to hold three `Aa` chips in the reader's three faces.
                The instinct was right - show, don't tell - but it showed the weaker
                half of the claim: three text faces at 17px differ by a couple of
                pixels of glyph width, so at a glance they read as three identical
                boxes. The filter is the half of this feature a picture can actually
                argue, and it appeared nowhere on this page but four words of copy.

                `eyeFilterColor()` IS THE SHIPPED FUNCTION, not a hand-picked amber.
                It is what EyeFilterOverlay.tsx calls to paint the live reader, so
                these four tiles are the four stops a user actually gets, in the
                reader's own words (`WARMTH_LABELS`). Reading them off the
                implementation means they cannot drift from it.

                WHY EACH TILE CARRIES TEXT, AND WHY THAT IS NOT DECORATION. The
                filter is `mix-blend-mode: multiply`, which scales every channel
                DOWN - so over a near-black tile it does exactly nothing, because
                there is no light left to take away. The whole visible effect lives
                in the light glyph on top: at `amber` a #FAFAFA "Aa" computes to
                about rgb(250,186,137), a warm cream. A flat swatch with no text
                under it would render as a black square AND would misrepresent the
                feature as a tint rather than a filter.

                `off` DRAWS NO OVERLAY AT ALL, because `eyeFilterColor` returns null
                for it - the same branch the real overlay takes. The first tile is
                therefore genuinely unfiltered rather than filtered by a no-op
                colour, which is what makes the row read as a progression. */}
            {feature.label === "Comfort" && (
              <div className="mt-4 flex items-end gap-1.5">
                {WARMTH_IDS.map((id) => {
                  const tint = eyeFilterColor({ warmth: id, dim: 0 });
                  return (
                    <div key={id} className="min-w-0 flex-1">
                      <div className="relative flex h-11 items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-white/[0.04]">
                        <span
                          className="text-[17px] leading-none text-white/90"
                          style={{ fontFamily: FONT_FAMILY_CSS.serif }}
                        >
                          Aa
                        </span>
                        {tint && (
                          <span
                            aria-hidden="true"
                            className="pointer-events-none absolute inset-0"
                            style={{ backgroundColor: tint, mixBlendMode: "multiply" }}
                          />
                        )}
                      </div>
                      <p className="mt-1.5 truncate text-center font-mono text-[9px] uppercase tracking-[0.14em] text-white/35">
                        {WARMTH_LABELS[id]}
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </dl>
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
// THE READER
// ---------------------------------------------------------------------------

/** THE CARD THE LOOP DIAGRAM DRAWS, copied verbatim from `STARTER_CONCEPTS`'
 * `testing-effect` entry in src/lib/starterDeck.ts - the deck this app actually
 * seeds every new account with. Not invented marketing content; a real card.
 *
 * COPIED RATHER THAN IMPORTED, AND THAT IS A BUNDLE DECISION WITH A NUMBER
 * BEHIND IT. `starterDeck.ts` is ~20.9KB in a SINGLE `STARTER_CONCEPTS` const -
 * twelve concepts, each carrying `explanation`, `misconception` and
 * `whyItMatters` paragraphs. There is no way to import one entry; importing the
 * name pulls the array. That is ~20KB of prose shipped to the landing route so a
 * diagram can print four short strings, on the page whose entire header is an
 * argument about what mid-range Android WebViews can afford.
 *
 * It is deliberately the OPPOSITE call to the one `ReaderCell` makes two hundred
 * lines down, where `FONT_FAMILY_CSS` IS imported - because there the fonts were
 * already loaded on this page and the import was genuinely free. Same instinct,
 * different arithmetic; the arithmetic is what decided it.
 *
 * THE COST OF COPYING IS DRIFT, so the mitigation is named here: if the starter
 * deck's `testing-effect` entry is ever reworded, this goes stale silently. The
 * strings are short and the source is one grep away (`id: "testing-effect"`).
 *
 * THE CLAIM IS THE `answer`, NEVER THE `distractor`. SwipeChallenge.tsx:43 picks
 * between them at random, which is right in a study feed and wrong here: the
 * distractor reads "testing exposes gaps, which you then close by re-reading
 * them", and a marketing page setting that in large type is publishing a false
 * statement to everyone who skims rather than reads. The true/false mechanic is
 * demonstrated just as well by a true claim, so there is nothing to weigh. */
const LOOP_CARD = {
  question: "Why does testing yourself beat re-reading?",
  claim:
    "retrieving an answer strengthens the memory, while re-reading mostly raises familiarity",
  // The real cloze is "Testing yourself beats re-reading because retrieval _____
  // the memory." - split here on the blank rather than shipping `normaliseBlank`
  // (src/lib/conceptProse.ts) to the landing page for one static sentence.
  clozeBefore: "Testing yourself beats re-reading because retrieval ",
  clozeAfter: " the memory.",
} as const;

/** THREE capabilities, and Define is deliberately not among them.
 *
 * It used to be the first of four. The drawing above these now shows a word
 * selected and its definition sitting open over the page - which is the whole
 * claim, made in the one medium that can actually make it. Leaving "DEFINE:
 * long-press a word, the meaning arrives over the page" underneath that picture
 * would be the failure this file cut five other mocks for: a diagram and its
 * caption saying the same thing, so neither is evidence. The readable claim
 * moves into the subhead, where it belongs (the drawing is `aria-hidden`).
 *
 * What is left is the three things a still picture cannot show: that a mark
 * persists, that a place is remembered, and that the type is yours. */
const READER_FEATURES = [
  {
    label: "Mark",
    body: "Highlight a passage and attach a note that stays on it.",
  },
  {
    label: "Resume",
    body: "Every document reopens on the exact line you left.",
  },
  {
    // BOTH CLAIMS SURVIVE, ONLY THE DRAWING CHANGED. The three type faces are a
    // real feature and are not dropped just because the swatches below stopped
    // illustrating them - the filter is simply the half of this item that a
    // still picture can actually make an argument about.
    label: "Comfort",
    body: "Three type faces, and a warm filter that takes the blue out.",
  },
] as const;

/** The passage in the drawing. Real sentences, not lorem and not bars.
 *
 * IT IS ABOUT AFFERENT NERVES BECAUSE THE SELECTED WORD IS "afferent" - the
 * chip in the old drawing already said so, and a definition is only legible as a
 * definition if the word around it is in a context that needs one. Med students
 * are the audience the FAQ argues for; this is their page, not lorem ipsum.
 *
 * Split into three spans so the highlight can sit mid-sentence rather than on a
 * line of its own, which is the entire point - the word is IN the prose. */
const READER_PASSAGE = {
  // THE SELECTED WORD IS IN THE FIRST THREE WORDS, AND THAT IS A POSITIONING
  // CONSTRAINT RATHER THAN a sentence-writing preference. The card below is
  // absolutely placed, but the word it points at is INLINE - so where the word
  // lands depends on where the paragraph happens to wrap, which changes with the
  // cell's width. The first draft opened with a clause before it; at 788px that
  // pushed "afferent" to the right-hand end of line one while the card sat at the
  // bottom left, pointing at nothing and covering the sentence that gave the word
  // its sense. Chasing it with `right-` anchoring only moves the failure to a
  // different width. The start of a paragraph, on the other hand, is top-left at
  // every width there is - so the word goes there and the card can be anchored to
  // a fixed point with confidence.
  before: "These ",
  word: "afferent",
  after:
    " fibres carry their signal inward, from the periphery toward the cord, terminating in the dorsal horn — where the first synapse of the pathway decides how much of the message travels on.",
} as const;

/** The definition, in the shape the real API returns it: `DefinitionResponseSchema`
 * (src/lib/definitionSchema.ts) promises "a razor-sharp 1-2 sentence definition".
 * One sentence here, because the mock has to fit a card. */
const READER_DEFINITION =
  "Carrying inward — toward the brain or spinal cord, rather than away from it.";



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
      // FIVE COLUMNS, IN THE SLOT THE FOUR-STEP RAIL USED TO HOLD. This cell has
      // now been three widths in three edits - seven borrowed beside the rail,
      // twelve when the reader took those seven, and five now that the rail is
      // gone and the FAQ inherited its place beside the reader. The number is
      // whatever leaves no hole in the row; the content has not changed.
      className={`${GLASS_LARGE} ${PAD} col-span-1 flex flex-col sm:col-span-6 sm:p-12 lg:col-span-5`}
    >
      {/* Google Rich Results: FAQPage — surfaces Q&As directly in search. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(FAQPAGE_JSONLD) }}
      />

      {/* THREE SHELVES SIDE BY SIDE, AND EVERY PART OF THAT IS LOAD-BEARING.
          Widening this cell to twelve columns had left each question in one row
          spanning the full 1368px, with `justify-between` throwing the "+" to the
          far right - a question on the left and its own control eleven hundred
          pixels away, which is not a control anyone associates with that
          question. An editorial two-column (heading pinned left, questions right)
          fixed half of it and was measured at 469px of dead space still sitting
          between a short question and its toggle, plus a four-column rail that
          was empty below the heading. Three columns of ~430px close that gap to
          something the eye reads as one row, and spend the width on content
          rather than on margin.

          ONE COLUMN AGAIN, AND THE GROUPS ARE WHY THAT IS STILL FINE. The
          three-across grid was built for a twelve-column cell; at five there is
          no room for it, so this is the same stacked fallback the layout already
          used on a phone. What survives the narrowing is the part that was doing
          the work - the labels. A single run of seven is what needed breaking up,
          and it is still broken up.

          SEVEN UNDIFFERENTIATED ROWS MADE A READER SCAN ALL SEVEN. Three labelled
          groups let them skip two thirds on sight, in the order a stranger
          actually asks: what is this, how does it work, should I pick it. The
          labels use the page's existing chrome voice (mono, 10px, wide tracking,
          /40) rather than a new one - furniture pointing at content is exactly
          what that style is already for here.

          EACH GROUP IS ITS OWN GRID ITEM, WHICH IS WHY OPENING ONE IS SAFE. In a
          single run of seven, an answer expanding pushes every question below it
          down the page. Here it grows its own column and the other two are
          untouched - no reflow of anything the reader was looking at. That is
          also why the groups are columns rather than a masonry: masonry would
          reflow across columns on open, which is the same problem wearing a
          nicer name.

          EVERY ANSWER STILL SHIPS IN THE MARKUP whether or not its `<details>` is
          open, unchanged from before: `FAQPAGE_JSONLD` declares seven Q&A pairs
          and Google requires the answer text present on the page for the rich
          result. Grouping moves them in the DOM; it removes none, and nothing
          here renders conditionally. */}
      <h2
        id="faq-heading"
        className="font-sans text-[clamp(1.75rem,3.4vw,2.4rem)] font-semibold leading-[1.02] tracking-[-0.035em] text-white"
      >
        Frequently asked
        {/* `block`, not the inline `ml-3` this carried at twelve columns: at five
            the two words no longer share a line, and an inline serif that wraps
            on its own puts the italic at the start of line two with the sans
            hanging above it. Breaking it deliberately is the same two-voice
            composition the other headlines use. */}
        <span className="mt-1 block font-editorial text-[1.1em] font-normal italic tracking-[-0.01em]">
          questions
        </span>
      </h2>

      <div className="mt-10 grid grid-cols-1 items-start gap-y-10">
        {FAQ_GROUPS.map((group) => (
          <div key={group}>
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/40">
              {group}
            </p>

            <div className="mt-4 divide-y divide-white/10 border-t border-white/10">
              {FAQ_ITEMS.filter((item) => item.group === group).map(({ q, a }) => (
                <details key={q} className="group py-4">
                  <summary className="flex cursor-pointer list-none items-start justify-between gap-4 py-1 [&::-webkit-details-marker]:hidden">
                    <h3 className="text-[15px] font-medium leading-snug tracking-[-0.01em] text-white/70 transition-colors group-open:text-white group-hover:text-white sm:text-base">
                      {q}
                    </h3>
                    {/* `items-start` + `mt-0.5`: at this column width most
                        questions wrap to two lines, and a centred toggle floats
                        beside the gap between them instead of beside the words.
                        Pinned to the first line it stays where the eye is. */}
                    <span className="relative mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-white/15 text-white/60 transition-transform duration-300 group-open:rotate-45 motion-reduce:transition-none">
                      <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5" aria-hidden="true">
                        <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      </svg>
                    </span>
                  </summary>
                  <p className="mt-3 text-sm leading-relaxed text-white/60">{a}</p>
                </details>
              ))}
            </div>
          </div>
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
      {/* `sm:justify-center` IS NOT COSMETIC - WITHOUT IT THIS ROW IS THE ONLY
          THING IN A CENTRED CELL THAT IS NOT CENTRED. The section is
          `items-center text-center`, which centres the heading and the subhead
          because they are content-width. This row is not: it is `w-full`, and at
          `sm` it drops `max-w-xs` for `max-w-none`, so it spans the whole cell
          edge to edge. `items-center` has nothing left to centre - the box
          already fills the axis - and the two `sm:w-auto` pills inside then sit
          at its flex-start, i.e. hard against the left edge under a centred
          headline.

          It reads correctly on a phone by accident rather than by design: below
          `sm` the row is `max-w-xs` (so `items-center` does centre the box) and
          the pills are `w-full` (so they fill it). Both of those stop being true
          at exactly the width the bug appears. Hence `sm:` - the alignment is
          only ever needed where the row goes horizontal. */}
      <div className="mt-9 flex w-full max-w-xs flex-col gap-3 sm:max-w-none sm:flex-row sm:justify-center">
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
            {/* GEIST, NOT PACIFICO. This mark and the navbar's sat ~1500px apart on
                the same page in two different faces - a script here, a grotesk up
                there - which is a brand speaking with two voices to one reader.
                spatial.ts records why the app shell dropped the script: inside the
                product it "was the one element arguing a personality the rest of the
                screen had spent its whole budget not having". The same is true at the
                bottom of a page that has spent its whole budget the same way. */}
            <span className="font-sans text-lg font-semibold tracking-[-0.02em] text-white">
              FlowRecall
            </span>
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

        {/* The pair: the questions a stranger arrives with (5), and what it is
            like to be inside a document (7). */}
        <FaqCell />
        <ReaderCell />

        <CloseCell />
      </div>

      <SiteFooter />
    </main>
  );
}
