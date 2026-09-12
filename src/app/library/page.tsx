"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import BookCover from "@/components/BookCover";
import GlowField from "@/components/GlowField";
import UploadSheet from "@/components/UploadSheet";
import { FOCUS, GLASS_CONTROL, GLASS_PANEL, GLASS_STATIC, PRESS, TAP, TRANSITION } from "@/lib/spatial";
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

        <span className="absolute left-2 top-2 rounded-full border border-[rgb(255_255_255_/_0.1)] bg-[rgb(0_0_0_/_0.7)] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[rgb(255_255_255_/_0.6)] backdrop-blur-md">
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
      className="fixed inset-x-0 bottom-0 z-[60] border-t border-[rgb(255_255_255_/_0.1)] bg-[rgb(0_0_0_/_0.92)] backdrop-blur-xl"
      style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 1rem)" }}
    >
      <div className="mx-auto flex w-full max-w-2xl items-center justify-between gap-3 px-5 py-3">
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
          ? { paddingBottom: "calc(8rem + env(safe-area-inset-bottom))" }
          : undefined
      }
      className="relative isolate flex min-h-0 w-full flex-1 flex-col bg-black px-5 pt-[max(1.25rem,env(safe-area-inset-top))]"
    >
      <GlowField />

      <header className="au-rise flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.03em] text-white">Library</h1>
          {!loading && (
            <p className="mt-1 text-[13px] text-[rgb(255_255_255_/_0.6)]">
              {books.length === 0
                ? "Nothing here yet."
                : `${books.length} ${books.length === 1 ? "document" : "documents"}`}
            </p>
          )}
        </div>

        {books.length > 0 && (
          <button
            type="button"
            onClick={() => (selecting ? leaveSelection() : setSelecting(true))}
            className={`min-h-11 shrink-0 rounded-full px-4 text-xs font-medium ${GLASS_STATIC} ${FOCUS}`}
          >
            {selecting ? "Done" : "Select"}
          </button>
        )}
      </header>

      {books.length > 1 && (
        <div
          role="group"
          aria-label="Sort library"
          className="au-rise mt-5 inline-flex gap-0.5 self-start rounded-full border border-[rgb(255_255_255_/_0.1)] bg-[rgb(255_255_255_/_0.05)] p-0.5"
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
