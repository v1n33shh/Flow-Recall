import Link from "next/link";
import { EYEBROW, FOCUS, GLASS_PANEL_SOFT, TRANSITION } from "@/lib/spatial";

/** One thing the Reader can do that a student would never find on their own.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS A HINT AND NOT A TUTORIAL
 * ---------------------------------------------------------------------------
 * A tutorial is a thing you dismiss. This is a widget that sits on the home screen looking
 * like the rest of the furniture, states one capability in one sentence, and offers the
 * shortest possible path to trying it. Nothing about it is dismissible, sequenced, or
 * numbered, because a student who has already learned the gesture should be able to read
 * past it in half a second rather than having to acknowledge it.
 *
 * ---------------------------------------------------------------------------
 * THE BOLT IS AN AUTHORED SVG, NOT THE ⚡ EMOJI
 * ---------------------------------------------------------------------------
 * The brief asked for "⚡ POWER MOVE" literally, and this deviates on one character for a
 * reason that comes from the brief's own rules rather than from taste. On Android, U+26A1
 * has emoji presentation by default: the platform renders it from Noto Color Emoji as a
 * saturated yellow-and-orange glyph. Dropping it into this eyebrow would have put the one
 * bright colour on a screen whose brief says, twice, "absolutely no bright colours" and
 * "pure black, frosted glass, white text".
 *
 * It is also the only glyph in the shell that would not have been a drawn icon - the tab
 * bar, the FAB and the reader all use authored SVG at one stroke family - and emoji render
 * differently on every OEM skin, so the mark would have been the single least predictable
 * thing in the design.
 *
 * So: the same bolt, drawn, at `currentColor`, inheriting the eyebrow's white. To go back
 * to the emoji, replace the <svg> with the character.
 *
 * ---------------------------------------------------------------------------
 * WHERE "TRY IT" GOES
 * ---------------------------------------------------------------------------
 * `href` is decided by the caller, and it is genuinely two different destinations:
 *   - With a document open, straight into it (`/reader?book=<id>`) - the student lands in
 *     real text with a real term to press, which is the only way a gesture is ever learned.
 *   - With an empty library, `/reader`, which renders the reader's own shelf and dropzone.
 *     "Try it" is then honestly an invitation to add something, because the gesture cannot
 *     be tried without a document.
 * A single hardcoded destination would have been wrong in one of those two states, and the
 * empty-library one is the state this widget exists for.
 *
 * NO JS. The pulse is a CSS keyframe (globals.css), the hover is a CSS transition, and this
 * file is not a client component - it renders to static markup and adds nothing to the
 * bundle.
 */
export default function PowerMove({ href }: { href: string }) {
  return (
    <section aria-label="Power move" className={`rounded-[24px] ${GLASS_PANEL_SOFT}`}>
      {/* The whole pane is the link. A widget whose body says "highlight a term" and whose
          footer says "try it" should not require the reader to find the four words at the
          bottom right - the target is 100% of the card, and the row below is the affordance
          telling them so. `block` + `group` so the arrow can respond to a press anywhere. */}
      <Link
        href={href}
        className={`group block rounded-[24px] p-5 ${TRANSITION} active:scale-[0.985] hover:bg-white/[0.03] ${FOCUS}`}
      >
        <p className={`flex items-center gap-1.5 ${EYEBROW}`}>
          {/* The bolt. `power-pulse` fades it 50% -> 100% on a 5.2s round trip; see the
              note in globals.css for why that is slower than it sounds. aria-hidden because
              the word beside it already says what it is. */}
          <svg
            viewBox="0 0 24 24"
            aria-hidden="true"
            className="power-pulse h-3 w-3 shrink-0"
            fill="currentColor"
          >
            <path d="M13.5 2 4 13.2h6.1L9.8 22 20 10.6h-6.4L13.5 2Z" />
          </svg>
          Power move
        </p>

        {/* THREE LINES, NOT FOUR, AND THAT IS A MEASUREMENT. On native, PageTransition's
            scroll container is `absolute inset-0 overflow-y-auto` sized to the viewport
            minus the tab bar's reserve - so a fourth line does not merely fall below the
            fold, it is CLIPPED by that container, and the emulator round caught the "Try
            it in the Reader" row cut in half. Every word removed here was removable:
            "straight onto" said nothing "onto" does not, and "without leaving the page" is
            what "in place" already means. */}
        <p className="mt-2.5 text-sm leading-relaxed text-white/80">
          Highlight any complex term in the Reader. FlowRecall defines it in place and saves
          it onto your highlight.
        </p>

        <span className="mt-4 flex items-center justify-end gap-1.5 text-[13px] font-medium text-white/60 transition-colors duration-300 ease-out group-hover:text-white">
          Try it in the Reader
          {/* The arrow leans on press/hover. `translate-x` only - transform is compositor
              owned, so the one moving thing in this widget costs nothing. */}
          <svg
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
            className="h-4 w-4 transition-transform duration-300 ease-out group-hover:translate-x-0.5 group-active:translate-x-0.5"
          >
            <path
              d="M5 12h14M13 6l6 6-6 6"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </Link>
    </section>
  );
}
