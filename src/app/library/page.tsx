"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import BookCover from "@/components/BookCover";
import GlowField from "@/components/GlowField";
import UploadSheet from "@/components/UploadSheet";
import { FOCUS, GLASS_CONTROL, GLASS_PANEL, GLASS_STATIC, META_PILL, PRESS, SCREEN_TITLE, TAP, TRANSITION } from "@/lib/spatial";
import { LIBRARY_SORT_LABELS, sortBooks } from "@/lib/librarySort";
import { getReaderPreferences, setReaderPreferences, type LibrarySort } from "@/lib/readerPreferences";
import { deleteBooks, useBooks } from "@/lib/readerStorage";
import { vibrateTap } from "@/lib/haptics";
import type { BookMeta } from "@/lib/types";

/** The shelf: every document, and the way into any of them.
 *
 * WHAT THIS PAGE USED TO BE. A library of flashcard DECKS, backed by localStorage through
 * useSavedDecks(). The product is a reader now, so "Library" means the thing a reader has
 * a library of. The deck data is untouched in storage and the deck code is untouched in
 * the tree - this route simply stopped being the way to reach it, which is the same
 * reversible first step MobileTabBar took with the four tabs it dropped.
 *
 * WHY NOT JUST POINT THE TAB AT /reader. The reader page already renders a shelf, so that
 * was the cheaper move. It was also the wrong one: the tab would read "Library" while the
 * URL read /reader, and /library would go on serving decks to anyone who landed on it.
 * A route that lies about what it holds is a bug with a long tail.
 *
 * TWO MATERIALS, PICKED BY WHETHER THE SURFACE SCROLLS. The covers take `GLASS_STATIC` -
 * fill, hairline, inset highlight, and no backdrop-filter - because this page is a
 * scrolling grid of up to thirty of them, and scrolling invalidates a cached blur on every
 * frame exactly as reliably as an animated background does. The empty-state card, which is
 * alone on a screen that does not scroll, takes the real `GLASS_PANEL` with its 64px blur.
 * Both read as the same material; only one of them can afford the filter.
 *
 * NO ACCENT COLOUR ANYWHERE. Progress, selection and the primary action are all plain
 * white at different alphas - on a surface with no hue to spend, the only signal available
 * is how much light a pane holds, so that ratio is kept unambiguous rather than decorated.
 */

const TYPE_BADGE: Record<BookMeta["type"], string> = {
  epub: "EPUB",
  pdf: "PDF",
  text: "TXT",
};

/** One shelf item. A single button that either opens the document or toggles its
 * selection - deliberately the same control either way. A separate always-visible delete
 * affordance on every cover would be one mis-tap from destroying a book, and a
 * hover-revealed one is unreachable on a touchscreen, which is how the grid this replaces
 * ended up impossible to tidy on a phone at all. */
function ShelfItem({
  book,
  selecting,
  selected,
  onOpen,
  onToggleSelect,
  index,
}: {
  book: BookMeta;
  selecting: boolean;
  selected: boolean;
  onOpen: () => void;
  onToggleSelect: () => void;
  index: number;
}) {
  const percent = Math.round(book.progress * 100);

  return (
    <div
      // Stagger capped at 8 steps: past that the last card is still arriving after the
      // reader has scrolled to it, which is worse than no entrance at all. A CSS keyframe
      // rather than a motion component per card - a 30-cover shelf was mounting 30
      // animation runtimes to fade 30 boxes up twelve pixels.
      className="au-rise flex flex-col"
      style={{ animationDelay: `${0.03 * Math.min(index, 8)}s` }}
    >
      <button
        type="button"
        onClick={() => {
          vibrateTap();
          (selecting ? onToggleSelect : onOpen)();
        }}
        aria-pressed={selecting ? selected : undefined}
        aria-label={selecting ? `${selected ? "Deselect" : "Select"} ${book.title}` : `Open ${book.title}`}
        className={`relative aspect-[2/3] w-full overflow-hidden rounded-2xl ${TAP} ${FOCUS} ${GLASS_STATIC} ${
          selected ? "ring-2 ring-white" : ""
        }`}
      >
        <BookCover book={book} />

        {selecting && (
          <span
            aria-hidden="true"
            className={`absolute inset-0 z-10 flex items-start justify-end p-2 transition-colors ${
              selected ? "bg-[rgb(0_0_0_/_0.6)]" : "bg-[rgb(0_0_0_/_0.3)]"
            }`}
          >
            <span
              className={`flex h-6 w-6 items-center justify-center rounded-full border transition-colors ${
                selected ? "border-white bg-white text-black" : "border-[rgb(255_255_255_/_0.4)] bg-[rgb(0_0_0_/_0.6)]"
              }`}
            >
              {selected && (
                <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5">
                  <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </span>
          </span>
        )}

        {/* NOT `META_PILL`, AND THE DIFFERENCE IS THE BACKDROP. Every other pill in this
            view sits on the black ground, where a white/6 fill reads as glass. This one
            sits on an arbitrary cover image - it could be a white page scan - so it needs
            an opaque-ish dark base or it is illegible on exactly the books with pale
            covers. Same geometry, same tracking, same type size: it stays in the family,
            it just carries its own ground with it. */}
        <span className="absolute left-2 top-2 inline-flex items-center rounded-full border border-white/10 bg-black/70 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.12em] text-white/70 backdrop-blur-md">
          {TYPE_BADGE[book.type]}
        </span>

        {book.progress > 0 && (
          <div className="absolute inset-x-0 bottom-0 h-[3px] bg-[rgb(0_0_0_/_0.6)]">
            <div className="h-full bg-white" style={{ width: `${percent}%` }} />
          </div>
        )}
      </button>

      <p className="mt-2 line-clamp-2 px-0.5 text-[13px] font-medium leading-tight text-white">
        {book.title}
      </p>
      {book.author && <p className="truncate px-0.5 text-[11px] text-[rgb(255_255_255_/_0.6)]">{book.author}</p>}
    </div>
  );
}

/** Anchored to the viewport while documents are selected. Deleting is two taps on purpose
 * - the second names how many and says it cannot be undone - and it is an in-page bar
 * rather than window.confirm, which on Android renders a system dialog titled with the
 * app's own localhost origin. Carried over from the reader's shelf, where that reasoning
 * was worked out against the device. */
function SelectionBar({
  count,
  confirming,
  onCancel,
  onRequestDelete,
  onConfirmDelete,
}: {
  count: number;
  confirming: boolean;
  onCancel: () => void;
  onRequestDelete: () => void;
  onConfirmDelete: () => void;
}) {
  return (
    <div
      // z-[60] clears MobileTabBar (fixed, z-50): a destructive confirmation must never
      // sit under the navigation that can dismiss it.
      //
      // THE OUTER DIV IS NOW A POSITIONER AND NOTHING ELSE - no fill, no border - so it
      // MUST NOT EAT TAPS. It spans the full width of the viewport across the bottom, and
      // without `pointer-events-none` the transparent gutter either side of the floating
      // card would swallow every tap aimed at the bottom row of covers. The card itself
      // opts back in. MobileTabBar does exactly this, for exactly this reason.
      className="pointer-events-none fixed inset-x-0 z-[60] px-4"
      // IT SITS ON TOP OF THE TAB BAR, NOT OVER IT, AND THAT IS A BUG FIX RATHER THAN A
      // PREFERENCE. This was `bottom-0` with its own safe-area padding, which put it in
      // exactly the same rectangle as MobileTabBar. The old full-bleed `bg-black/92` hid
      // that collision by being very nearly opaque - the tab bar was still underneath,
      // simply invisible. Turning this into real glass made the nav legible THROUGH the
      // confirmation, and "Cancel" landed on top of "Ingest".
      //
      // So the near-opaque fill was load-bearing, and the honest fix is not to put it back
      // but to stop the two panes overlapping at all. MobileTabBar publishes its real
      // rendered height - its own safe-area padding included - as `--tabbar-h` on <html>,
      // and DeckUndoBar already floats off that exact variable. Same offset, same reason.
      //
      // NO `env(safe-area-inset-bottom)` OF ITS OWN: `--tabbar-h` already contains it, and
      // adding it again is the double-count that cost this shell a commit once before.
      // The variable collapses to 0 at sm:, where the bar is hidden and there is no inset
      // to respect anyway.
      style={{ bottom: "calc(var(--tabbar-h, 0px) + 1rem)" }}
    >
      {/* A FLOATING PANE, NOT A DOCKED BAR. This was full-bleed at `bg-black/92` with a
          hairline along its top edge - which is a toolbar, and a toolbar welded to the
          bottom of the screen is the one shape in this shell that does not float. Lifted
          off the edge it reads as the same material as the upload sheet and the tab bar it
          sits above, which is the point: there is one glass in this world.

          A DARK FILL AND NOT `bg-white/5`. Every other pane here is a white fill because
          it sits on the black ground with nothing behind it. This one sits over a grid of
          cover art and titles, and it is the surface that asks whether to delete something
          irreversibly - so it carries its own dark ground. Legibility outranks material
          consistency at exactly one place on this screen, and this is it.

          /95, AND EACH STEP UP WAS MEASURED ON A SCREENSHOT RATHER THAN GUESSED. At /70 a
          book title four pixels behind the pane came through at 30% and sat inside the
          sentence asking whether to delete it - "Thinking, Fast" legible straight through
          "Delete 2 documents?". At /90 it was a ghost rather than a word, which is better
          and still not good enough for the one control in this app that destroys data.
          The blur does not save it either: blur moves luminance around, it does not remove
          it, so blurred white text under a thin scrim is a bright smear where a word
          should be. Only the fill can fix that, so the fill is what was changed.

          /95 IS ALSO THE HOUSE FIGURE, WHICH IS WHY IT IS WHERE THIS STOPS RATHER THAN AT
          SOME NEARBY VALUE THAT ALSO WORKS. DeckUndoBar is the same shape doing the same
          job - a floating pane above the tab bar, holding a sentence and an undo - and it
          settled on `bg-surface/95` already. Two confirmations that float over the same
          nav should not be two different densities of glass.

          ROUNDED-[28px], NOT ROUNDED-FULL. It holds a sentence, and a pill that holds a
          sentence is a lozenge. The pills in here are the two buttons, which is where the
          geometry belongs - it marks the actions, not the container. */}
      <div className="pointer-events-auto mx-auto flex w-full max-w-2xl items-center justify-between gap-3 rounded-[28px] border border-white/10 bg-black/95 px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.09),0_18px_48px_-12px_rgba(0,0,0,0.9)] backdrop-blur-3xl backdrop-saturate-[2.2]">
        <p className="text-xs text-[rgb(255_255_255_/_0.6)]" aria-live="polite">
          {confirming
            ? `Delete ${count} ${count === 1 ? "document" : "documents"}? This can't be undone.`
            : count === 0
              ? "Tap the documents you want to remove."
              : `${count} selected`}
        </p>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={onCancel}
            className={`min-h-11 rounded-full px-3 text-xs font-medium text-[rgb(255_255_255_/_0.6)] hover:text-white ${TRANSITION} ${FOCUS}`}
          >
            {confirming ? "Keep" : "Cancel"}
          </button>
          <button
            type="button"
            disabled={count === 0}
            onClick={confirming ? onConfirmDelete : onRequestDelete}
            // SOLID WHITE, NOT GLASS. Every other control in this shell is a pane; this one is
            // deliberately not, because a destructive confirmation should not look like one
            // more surface to tap through. It is the only opaque fill left in the world.
            className={`min-h-11 rounded-full bg-white px-4 text-xs font-semibold text-black disabled:opacity-40 ${TRANSITION} active:scale-[0.97] ${FOCUS}`}
          >
            {confirming ? "Delete" : `Delete${count > 0 ? ` (${count})` : ""}`}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function LibraryPage() {
  const router = useRouter();
  const { books, loading } = useBooks();

  const [sort, setSort] = useState<LibrarySort>(() => getReaderPreferences().librarySort);
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [adding, setAdding] = useState(false);

  const ordered = sortBooks(books, sort);
  // FINISHED IS >= 0.99, NOT === 1. `progress` is a read FRACTION computed from a scroll
  // offset or a CFI, so the last page of a book that has genuinely been finished lands on
  // 0.994 about as often as it lands on 1 - and a shelf that will not admit you finished
  // anything is worse than one that is a percent generous. `reading` is the open interval
  // below it, so the two can never double-count a book.
  const finished = books.filter((book) => book.progress >= 0.99).length;
  const reading = books.filter((book) => book.progress > 0 && book.progress < 0.99).length;
  // A document deleted in another tab must not keep occupying the count on the bar.
  const selected = selectedIds.filter((id) => books.some((book) => book.id === id));

  function changeSort(next: LibrarySort) {
    setSort(next);
    setReaderPreferences({ librarySort: next });
  }

  function toggleSelected(id: string) {
    setConfirming(false);
    setSelectedIds((current) =>
      current.includes(id) ? current.filter((other) => other !== id) : [...current, id],
    );
  }

  function leaveSelection() {
    setSelecting(false);
    setSelectedIds([]);
    setConfirming(false);
  }

  async function deleteSelected() {
    const ids = selected;
    leaveSelection();
    await deleteBooks(ids);
  }

  return (
    <main
      // The selection bar is fixed to the viewport, so without the extra padding it would
      // cover the last row for good - no amount of scrolling gets past a fixed element.
      // Reserved only while selecting; the space is hidden under the bar anyway.
      style={
        selecting
          ? // Clears the floating confirmation, which now sits a bar-height higher than it
            // used to - so the reservation is measured from the same variable the bar is
            // positioned from, rather than from a constant that silently stops being
            // enough the moment either height changes.
            { paddingBottom: "calc(var(--tabbar-h, 0px) + 7rem)" }
          : undefined
      }
      className="relative isolate flex min-h-0 w-full flex-1 flex-col bg-black px-5 pt-[max(1.25rem,env(safe-area-inset-top))]"
    >
      <GlowField />

      <header className="au-rise">
        <div className="flex items-start justify-between gap-4">
          <h1 className={`${SCREEN_TITLE} text-white`}>Library</h1>

          {books.length > 0 && (
            <button
              type="button"
              onClick={() => (selecting ? leaveSelection() : setSelecting(true))}
              className={`min-h-11 shrink-0 rounded-full px-4 text-xs font-medium ${GLASS_STATIC} ${FOCUS}`}
            >
              {selecting ? "Done" : "Select"}
            </button>
          )}
        </div>

        {/* THE SHELF, IN THREE NUMBERS. This was one line of grey text reading "12
            documents", which is a count, not a view of anything. Split into pills it
            answers the question the screen is actually for - how much is here, how much is
            open, how much is behind me - without adding a row of chrome: the pills wrap
            into the space the sentence already occupied.

            A ZERO IS NOT SHOWN. A pill reading "0 READING" is a statement about absence,
            and absence does not deserve a surface. The pills that are here are always
            non-trivially true, which is why the row never reads as a dashboard padding
            itself out.

            NOT TAPPABLE, AND IT MUST NOT LOOK IT. These are the same 44px-ish height as
            the sort control directly below and carry the same fill, so the one signal
            separating them is that these are `span`s with no hover, no press and no ring -
            hence the deliberately lower text alpha (/60 against the control's white) and
            the absence of any `PRESS`. If either ever gains an action, it stops being a
            META_PILL and becomes a control. */}
        {!loading &&
          (books.length === 0 ? (
            <p className="mt-1 text-[13px] text-[rgb(255_255_255_/_0.6)]">Nothing here yet.</p>
          ) : (
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <span className={META_PILL}>
                {books.length} {books.length === 1 ? "document" : "documents"}
              </span>
              {reading > 0 && <span className={META_PILL}>{reading} reading</span>}
              {finished > 0 && <span className={META_PILL}>{finished} finished</span>}
            </div>
          ))}
      </header>

      {books.length > 1 && (
        <div
          role="group"
          aria-label="Sort library"
          // `backdrop-saturate` with no blur, for the reason spelled out on META_PILL: this
          // is a 40px-tall control, a 64px blur radius would sample almost entirely from
          // outside it, and saturate is per-pixel so it does not care how small the pane
          // is. It is what lets the mesh resolve inside the control and nowhere beside it.
          className="au-rise mt-5 inline-flex gap-0.5 self-start rounded-full border border-[rgb(255_255_255_/_0.1)] bg-[rgb(255_255_255_/_0.05)] p-0.5 backdrop-saturate-[2.2]"
          style={{ animationDelay: "60ms" }}
        >
          {(["recent", "title", "progress"] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => changeSort(option)}
              aria-pressed={sort === option}
              className={`rounded-full px-4 py-2 text-xs font-medium ${TRANSITION} ${FOCUS} ${
                sort === option
                  ? "bg-[rgb(255_255_255_/_0.12)] text-white"
                  : "bg-transparent text-[rgb(255_255_255_/_0.6)]"
              }`}
            >
              {LIBRARY_SORT_LABELS[option]}
            </button>
          ))}
        </div>
      )}

      {loading ? (
        // Reserved shape rather than a spinner - IndexedDB resolves in milliseconds and a
        // spinner would flash and be gone, which is how a fast screen is made to look slow.
        <div className="mt-6 grid grid-cols-3 gap-x-3 gap-y-5 sm:grid-cols-4">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="aspect-[2/3] w-full rounded-2xl border border-[rgb(255_255_255_/_0.1)] bg-[rgb(255_255_255_/_0.03)]" />
          ))}
        </div>
      ) : books.length === 0 ? (
        // Same reasoning as ReaderHome: an empty shelf centred reads as empty, an empty
        // shelf pinned to the top reads as broken.
        <div
          className={`au-rise mb-24 mt-8 flex-1 self-center rounded-[28px] p-8 text-center ${GLASS_PANEL}`}
          style={{ animationDelay: "100ms" }}
        >
          <h2 className="text-[20px] font-semibold tracking-[-0.02em] text-white">
            Your shelf is empty.
          </h2>
          <p className="mx-auto mt-2.5 max-w-xs text-[13px] leading-relaxed text-[rgb(255_255_255_/_0.6)]">
            Add an EPUB, a PDF or your own notes. Everything stays on this device unless
            you sign in to sync it.
          </p>
          {/* NO BUTTON ON A PHONE. The FAB is four inches below this card and is the only
              CTA the screen needs; a second full-width primary control inside the card was
              two actions competing to be the obvious next tap.

              IT SURVIVES AT sm: AND UP, AND THAT IS NOT A HEDGE. MobileTabBar - and with
              it the FAB - is `sm:hidden`, because on a desktop browser the chrome is
              Navbar, not a thumb bar. Deleting this outright would have left a signed-in
              desktop visitor on an empty /library with literally no way to add anything:
              no FAB, no button, a dead end. One CTA per viewport is the rule being kept
              here, not broken - it is simply a different control on each. */}
          <button
            type="button"
            onClick={() => setAdding(true)}
            className={`mx-auto mt-6 hidden items-center justify-center rounded-full px-7 py-3.5 text-[15px] font-semibold text-white sm:flex ${GLASS_CONTROL} ${PRESS} ${FOCUS}`}
          >
            Add a document
          </button>
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-3 gap-x-3 gap-y-5 sm:grid-cols-4 md:grid-cols-5">
          {ordered.map((book, i) => (
            <ShelfItem
              key={book.id}
              book={book}
              index={i}
              selecting={selecting}
              selected={selected.includes(book.id)}
              onOpen={() => router.push(`/reader?book=${book.id}`)}
              onToggleSelect={() => toggleSelected(book.id)}
            />
          ))}
        </div>
      )}

      <div aria-hidden="true" className="h-6" />

      {selecting && (
        <SelectionBar
          count={selected.length}
          confirming={confirming}
          onCancel={leaveSelection}
          onRequestDelete={() => setConfirming(true)}
          onConfirmDelete={deleteSelected}
        />
      )}

      <UploadSheet
        open={adding}
        onClose={() => setAdding(false)}
        onImported={(book) => {
          setAdding(false);
          router.push(`/reader?book=${book.id}`);
        }}
      />
    </main>
  );
}
