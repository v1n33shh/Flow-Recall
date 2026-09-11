"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";
import type { Deck } from "@/lib/types";
import { chooseHero } from "@/lib/homeHero";
import { setStudyDeck } from "@/lib/storage";
import { vibrateTap } from "@/lib/haptics";

/** The number the app leads with when it cannot yet lead with a prediction.
 *
 * The shape is borrowed from the readiness dashboards - one figure large enough to read at
 * arm's length, a small label under it, and one thing to do. What it must never do is
 * invent the figure: the retention projection is the real number and it needs an account
 * plus answered cards, so this renders the honest smaller version until then. See
 * homeHero.ts for the ladder.
 *
 * Two states land here:
 *   `progress` - a deck part-answered. The count comes from localStorage and works with no
 *                account at all, which is the point: a student watches a real number move
 *                before being asked for anything.
 *   `waiting`  - a library nobody has opened. The number is what is in it.
 *
 * The line underneath a `progress` hero is the only conversion argument on this screen,
 * and it is a better one than a pricing link: they have just watched the small version of
 * the number work, so "an account turns this into a prediction" is a promise with evidence
 * behind it rather than a claim.
 */
export default function HomeHeroNumber({
  decks,
  hasProjection,
  signedIn,
}: {
  decks: readonly Deck[];
  hasProjection: boolean;
  signedIn: boolean;
}) {
  const reduceMotion = useReducedMotion();
  const hero = chooseHero({ decks, hasProjection });

  // `projection` means MemoryOverview is rendering the real thing; `empty` means there is
  // nothing true to put here. Either way this component steps aside rather than filling
  // the space with something invented.
  if (hero.kind === "projection" || hero.kind === "empty") return null;

  const inProgress = hero.kind === "progress";
  const value = inProgress ? hero.answered : hero.total;
  const remaining = inProgress ? hero.total - hero.answered : hero.total;
  // Pulled out of the union here rather than read inside the handler: TypeScript will not
  // carry the early return's narrowing into a closure over `hero`.
  const deck = hero.deck;

  // The same sessionStorage handoff the library's own "Study Now" uses, so /study needs no
  // dynamic route - which `output: "export"` could not build for localStorage deck ids.
  function start() {
    vibrateTap();
    setStudyDeck(deck.id, deck.concepts);
  }

  return (
    <motion.section
      initial={reduceMotion ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 280, damping: 26 }}
      aria-label="Where you are"
      className="w-full max-w-sm text-center"
    >
      <p className="truncate font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
        {deck.title}
      </p>

      {/* Readable at arm's length, which is the whole idea - the app's biggest numeral
          before this was 36px, on a screen nobody sees until a session ends. */}
      <p className="mt-3 font-sans text-6xl font-semibold leading-none tracking-tight tabular-nums text-foreground sm:text-7xl">
        {value}
      </p>
      <p className="mt-2 text-sm text-muted-foreground">
        {inProgress ? `of ${hero.total} answered` : `concepts, ready when you are`}
      </p>

      {/* What this app is, exactly once. Shown only in the `waiting` state - a library
          nobody has opened yet - and gone for good the moment anything is answered.
          The mobile UX guidance is blunt about this: show onboarding to first-time users,
          not to returning ones. A returning student does not need to be told daily what
          they installed; a new one has nothing else on this screen telling them. */}
      {!inProgress && (
        <p className="mx-auto mt-4 max-w-xs text-sm leading-relaxed text-muted-foreground">
          Your notes become questions, scheduled for the day you would have forgotten them.
        </p>
      )}

      <Link
        href="/study"
        onClick={start}
        className="mt-7 inline-flex w-full items-center justify-center rounded-full bg-accent px-6 py-3.5 text-base font-semibold text-accent-foreground ring-1 ring-inset ring-accent/30 shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_8px_28px_-6px_rgba(0,0,0,0.45)] transition-all duration-200 active:scale-[0.97]"
      >
        {inProgress ? `Keep going · ${remaining} left` : "Start studying"}
      </Link>

      {!signedIn && (
        /* The one place an account is argued for on this screen. Stated as what it adds
           rather than as a wall, because nothing here is actually gated - the deck above
           is fully studyable without one. */
        <p className="mx-auto mt-5 max-w-xs text-xs leading-relaxed text-muted-foreground">
          {inProgress ? "Finish these and " : "Answer these and "}
          <Link href="/login" className="text-foreground underline underline-offset-2">
            an account
          </Link>{" "}
          turns this into a prediction of what you&apos;ll still know next week.
        </p>
      )}
    </motion.section>
  );
}
