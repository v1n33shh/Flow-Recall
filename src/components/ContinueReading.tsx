import BookCover from "@/components/BookCover";
import { FOCUS, GLASS_CONTROL, GLASS_PANEL, PRESS, TEXT_MUTED, TEXT_PRIMARY } from "@/lib/spatial";
import type { BookMeta } from "@/lib/types";

/** The app's front door: the document you are in the middle of, and one tap back into it.
 *
 * EVERY VALUE ON THIS CARD IS REAL. The cover is the asset readerStorage rendered at
 * import, the percentage is `BookMeta.progress` — documented there as the "0-1 read
 * fraction as of lastPosition" and written by updateReadingPosition on every page turn —
 * and the book is books[0] from listBooks(), which already sorts by
 * `lastOpenedAt ?? addedAt` descending. Nothing here is a placeholder, which is why this
 * card is allowed to be the largest thing on the screen.
 *
 * NO KICKER ABOVE THE TITLE. A "CONTINUE READING" label would say what the Resume button
 * already says, in a smaller font, above the one line that should own the card.
 *
 * NO MOTION COMPONENT. This file used to mount three of them - an entrance wrapper, an
 * animated progress fill, and a magnetic button running springs off every pointermove. All
 * three are now CSS: `.au-rise` for arrival, a static fill, and `active:scale` for press.
 * See the performance note at the head of src/lib/aurora.ts for why that mattered more
 * than the four pixels of magnetic lean it cost.
 *
 * NO ACTION IN THE EMPTY STATE, deliberately. The card used to carry its own white "Add a
 * document" button, which put a second full-width primary control on a screen that already
 * has a floating one four inches below it - two CTAs competing to be the obvious next tap,
 * which is one more than any screen should have. The FAB is the only way in now.
 */
export default function ContinueReading({
  book,
  onResume,
}: {
  book: BookMeta | null;
  onResume: (id: string) => void;
}) {
  // EMPTY STATE. It keeps the card's frame rather than rendering nothing, so a first-run
  // screen still has a shape - an aurora and a tab bar with a void between them reads as a
  // failed load, not as an empty library.
  // TIGHTER THAN THE POPULATED CARD, DELIBERATELY. The empty state is the one screen where
  // all three panes are on show at once - insight, this, and the Power Move - and on a
  // 390x844 phone with a three-line fact that stack overran the scroll container and
  // clipped the Power Move's CTA. Two lines instead of three, and p-6 instead of p-7, is
  // the ~32px that buys it back.
  //
  // The words removed were doing nothing: "and it will wait for you here" and "It'll wait
  // here" say the same thing, and the shorter one sounds less like a brochure.
  if (!book) {
    return (
      <section aria-label="Get started" className={`rounded-[28px] p-6 ${GLASS_PANEL}`}>
        <h2 className={`text-[22px] font-semibold leading-tight tracking-[-0.02em] ${TEXT_PRIMARY}`}>
          Nothing open yet.
        </h2>
        <p className={`mt-2.5 max-w-[34ch] text-[13px] leading-relaxed ${TEXT_MUTED}`}>
          Add an EPUB, a PDF or your notes. It&apos;ll wait here, on the page you stopped at.
        </p>
      </section>
    );
  }

  const percent = Math.round(book.progress * 100);
  // A book opened once and never turned reads 0%, and "0% complete" is a discouraging
  // thing to greet someone with. It is also not what the card means: the fact worth
  // stating is that the book is started, not that it is nowhere.
  const started = percent > 0;

  return (
    <section aria-label="Continue reading" className={`rounded-[28px] p-5 ${GLASS_PANEL}`}>
      <div className="flex gap-4">
        {/* 2:3 is the shape of a book, and holding the ratio rather than a fixed height
            means a landscape PDF thumbnail is cropped to the shelf's proportion instead of
            setting its own. */}
        <div className="relative aspect-[2/3] w-[5.5rem] shrink-0 overflow-hidden rounded-xl border border-white/10 bg-white/5">
          <BookCover book={book} />
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          {/* line-clamp-3, not truncate: the title is the one thing a reader identifies the
              book by, and "Introduction to Cognitive Neuros…" identifies nothing. Three
              lines is what the cover's height affords. */}
          <h2 className={`line-clamp-3 text-[19px] font-semibold leading-[1.2] tracking-[-0.02em] ${TEXT_PRIMARY}`}>
            {book.title}
          </h2>
          {book.author && <p className={`mt-1.5 truncate text-[13px] ${TEXT_MUTED}`}>{book.author}</p>}

          <div className="mt-auto pt-4">
            {/* ONE PHRASE, NOT A LABEL AND A VALUE. These were split across the row as
                "COMPLETE" and "74%", and the emulator round read it back as what it
                literally says: that the book is complete. A label and its number at
                opposite ends of a 190px row do not reassemble into a sentence. */}
            <div className="flex items-baseline gap-1.5">
              {started ? (
                <>
                  <span className={`font-mono text-[15px] font-medium tabular-nums ${TEXT_PRIMARY}`}>
                    {percent}%
                  </span>
                  <span className="text-[11px] uppercase tracking-[0.14em] text-white/40">
                    complete
                  </span>
                </>
              ) : (
                <span className="text-[11px] uppercase tracking-[0.14em] text-white/40">
                  Not started
                </span>
              )}
            </div>
            {/* Static fill. It used to animate scaleX from 0 on mount, which was correct in
                that it never touched layout - but it is one more thing running on arrival
                for a bar the reader is not watching arrive. The number above it already
                says the figure. */}
            <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-white/10">
              {/* White at full strength. On a screen with no accent, plain white is the
                  brightest thing available, and a progress bar is one of the two places
                  worth spending it. */}
              <div className="h-full rounded-full bg-white" style={{ width: `${percent}%` }} />
            </div>
          </div>
        </div>
      </div>

      <button
        type="button"
        onClick={() => onResume(book.id)}
        aria-label={`Resume ${book.title}`}
        className={`mt-5 flex h-14 w-full items-center justify-center gap-2 rounded-full text-[15px] font-semibold tracking-[-0.01em] text-white ${GLASS_CONTROL} ${PRESS} ${FOCUS}`}
      >
        Resume Flow
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-[18px] w-[18px]">
          <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </section>
  );
}
