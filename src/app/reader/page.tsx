"use client";

import { Suspense, startTransition, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "motion/react";
import UnifiedDropzone from "@/components/reader/UnifiedDropzone";
import PasteTextForm from "@/components/reader/PasteTextForm";
import EpubReaderView from "@/components/reader/EpubReaderView";
import PdfReaderView from "@/components/reader/PdfReaderView";
import TextReaderView from "@/components/reader/TextReaderView";
import { ReaderErrorState } from "@/components/reader/ReaderChrome";
import { LIBRARY_SORT_LABELS, sortBooks } from "@/lib/librarySort";
import { getReaderPreferences, setReaderPreferences, type LibrarySort } from "@/lib/readerPreferences";
import { deleteBooks, getBookMeta, useBooks } from "@/lib/readerStorage";
import type { BookMeta } from "@/lib/types";

const TYPE_BADGE: Record<BookMeta["type"], string> = {
  epub: "EPUB",
  pdf: "PDF",
  text: "TXT",
};

function BookCover({ book }: { book: BookMeta }) {
  if (book.coverDataUrl) {
    // Raw <img>, not next/image: covers are data: URLs generated client-side
    // from a user's local file, not remote assets next/image can optimize.
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={book.coverDataUrl} alt="" className="h-full w-full object-cover" />;
  }
  if (book.type === "text") {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 bg-gradient-to-br from-zinc-800 to-zinc-950 px-4">
        {[1, 0.8, 0.9].map((width, i) => (
          <div key={i} className="h-1 rounded-full bg-zinc-600" style={{ width: `${width * 100}%` }} />
        ))}
      </div>
    );
  }
  return (
    <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-zinc-800 to-zinc-950 text-2xl font-bold text-zinc-500">
      {book.title.charAt(0).toUpperCase()}
    </div>
  );
}

/** A card is either a way into a book or, in selection mode, a checkbox. It is
 * deliberately the same button either way: a separate always-visible delete
 * affordance on every cover would be one mis-tap away from removing a book, and
 * the hover-revealed one this replaced was unreachable on a touch screen, which
 * is the whole reason the grid could not be tidied on a phone at all. */
function BookCard({
  book,
  selecting,
  selected,
  onOpen,
  onToggleSelect,
}: {
  book: BookMeta;
  selecting: boolean;
  selected: boolean;
  onOpen: () => void;
  onToggleSelect: () => void;
}) {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="relative flex flex-col gap-2">
      <button
        type="button"
        onClick={selecting ? onToggleSelect : onOpen}
        aria-pressed={selecting ? selected : undefined}
        aria-label={selecting ? `${selected ? "Deselect" : "Select"} ${book.title}` : undefined}
        className={`relative aspect-[2/3] w-full overflow-hidden rounded-xl border bg-surface shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_12px_28px_-10px_rgba(0,0,0,0.7)] transition-transform active:scale-[0.97] ${
          selected ? "border-foreground" : "border-border"
        }`}
      >
        {selecting && (
          <span
            aria-hidden="true"
            className={`absolute inset-0 z-10 flex items-start justify-end p-1.5 transition-colors ${
              selected ? "bg-background/50" : "bg-background/20"
            }`}
          >
            <span
              className={`flex h-6 w-6 items-center justify-center rounded-full border transition-colors ${
                selected ? "border-foreground bg-foreground text-background" : "border-white/40 bg-black/50"
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
        <BookCover book={book} />
        <span className="absolute left-1.5 top-1.5 rounded-full border border-white/10 bg-black/60 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-zinc-300 backdrop-blur-md">
          {TYPE_BADGE[book.type]}
        </span>
        {book.progress > 0 && (
          <div className="absolute inset-x-0 bottom-0 h-1 bg-black/40">
            <div className="h-full bg-accent" style={{ width: `${book.progress * 100}%` }} />
          </div>
        )}
      </button>

      <div className="px-0.5">
        <p className="truncate text-sm font-medium text-foreground">{book.title}</p>
        {book.author && <p className="truncate text-xs text-muted-foreground">{book.author}</p>}
      </div>
    </motion.div>
  );
}

type AddMode = "upload" | "paste";

/** Shared pill-group styling for the two small segmented controls on this page
 * (what to add, and how to sort) so they read as the same kind of switch. */
const PILL_GROUP = "inline-flex gap-0.5 rounded-full border border-border bg-foreground/5 p-0.5";
const PILL = "rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors";
const PILL_ON = "bg-foreground/10 text-foreground";
const PILL_OFF = "text-muted-foreground hover:text-foreground";

function AddModeToggle({ mode, onChange }: { mode: AddMode; onChange: (mode: AddMode) => void }) {
  return (
    <div className={PILL_GROUP}>
      {(["upload", "paste"] as const).map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => onChange(m)}
          className={`${PILL} ${mode === m ? PILL_ON : PILL_OFF}`}
        >
          {m === "upload" ? "Upload File" : "Paste Text"}
        </button>
      ))}
    </div>
  );
}

function SortToggle({ sort, onChange }: { sort: LibrarySort; onChange: (sort: LibrarySort) => void }) {
  return (
    <div className={PILL_GROUP} role="group" aria-label="Sort library">
      {(["recent", "title", "progress"] as const).map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => onChange(option)}
          aria-pressed={sort === option}
          className={`${PILL} ${sort === option ? PILL_ON : PILL_OFF}`}
        >
          {LIBRARY_SORT_LABELS[option]}
        </button>
      ))}
    </div>
  );
}

/** Sticks to the bottom of the library while books are selected. Deleting is
 * two taps on purpose - the second one names how many books and says it cannot
 * be undone - and it is an in-page bar rather than window.confirm, which on
 * Android renders a system dialog titled with the app's own localhost origin. */
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
      className="sticky bottom-0 z-20 -mx-4 mt-6 border-t border-border bg-background/90 px-4 py-3 backdrop-blur-md sm:-mx-6 sm:px-6"
      // Android's gesture bar and an iPhone's home indicator both sit in this
      // strip; without the inset the Delete button ends up under them.
      style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {confirming
            ? `Delete ${count} ${count === 1 ? "book" : "books"}? This can't be undone.`
            : count === 0
              ? "Tap the books you want to remove."
              : `${count} selected`}
        </p>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="min-h-11 rounded-full px-3 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            {confirming ? "Keep" : "Cancel"}
          </button>
          <button
            type="button"
            disabled={count === 0}
            onClick={confirming ? onConfirmDelete : onRequestDelete}
            className="min-h-11 rounded-full bg-foreground px-4 text-xs font-semibold text-background transition-opacity active:scale-[0.97] disabled:opacity-40"
          >
            {confirming ? "Delete" : `Delete${count > 0 ? ` (${count})` : ""}`}
          </button>
        </div>
      </div>
    </div>
  );
}

function ReaderLibrary({ onOpenBook }: { onOpenBook: (id: string) => void }) {
  const { books, loading } = useBooks();
  const [mode, setMode] = useState<AddMode>("upload");
  const [sort, setSort] = useState<LibrarySort>(() => getReaderPreferences().librarySort);
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);

  const ordered = sortBooks(books, sort);
  // A book deleted (or selected and then removed by another tab) must not keep
  // occupying the count on the bar.
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
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-4 py-10 sm:px-6 sm:py-16">
      {/* Navbar/MobileTabBar are fully hidden on /reader (same treatment as
          /study) so the reading view stays truly full-bleed - this is the
          library's only way back to the rest of the app. */}
      <Link href="/" className="mb-6 flex items-center gap-1.5 self-start text-sm font-medium text-muted-foreground transition-colors hover:text-foreground">
        <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5" aria-hidden="true">
          <path d="M15 5l-7 7 7 7" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        FlowRecall
      </Link>

      <h1 className="text-2xl font-semibold tracking-tight text-foreground">Reader</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Drop in an EPUB, a PDF, or paste raw notes, and read distraction-free.
        Highlight any word or phrase for an instant AI definition - no
        tab-switching, no broken flow.
      </p>

      <div className="mt-6">
        <AddModeToggle mode={mode} onChange={setMode} />
      </div>

      <div className="mt-4">
        {mode === "upload" ? (
          <UnifiedDropzone onImported={(book) => onOpenBook(book.id)} />
        ) : (
          <PasteTextForm onImported={(book) => onOpenBook(book.id)} />
        )}
      </div>

      {!loading && books.length > 0 && (
        <>
          {/* Rendered only once the books have loaded, which also keeps the
              stored sort out of the prerendered HTML it would mismatch. */}
          <div className="mt-10 flex flex-wrap items-center justify-between gap-3">
            <SortToggle sort={sort} onChange={changeSort} />
            <button
              type="button"
              onClick={() => (selecting ? leaveSelection() : setSelecting(true))}
              className="rounded-full border border-border px-3.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              {selecting ? "Done" : "Edit"}
            </button>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
            {ordered.map((book) => (
              <BookCard
                key={book.id}
                book={book}
                selecting={selecting}
                selected={selected.includes(book.id)}
                onOpen={() => onOpenBook(book.id)}
                onToggleSelect={() => toggleSelected(book.id)}
              />
            ))}
          </div>

          {selecting && (
            <SelectionBar
              count={selected.length}
              confirming={confirming}
              onCancel={() => (confirming ? setConfirming(false) : leaveSelection())}
              onRequestDelete={() => setConfirming(true)}
              onConfirmDelete={deleteSelected}
            />
          )}
        </>
      )}
    </main>
  );
}

/** Reads just the lightweight metadata to learn a book's content type, then
 * hands off to the matching full reader view. Each view still fetches its
 * own file/meta internally (kept self-sufficient) - this is only here to
 * decide WHICH one to render. */
function ReaderOpenDispatcher({ bookId, onExit }: { bookId: string; onExit: () => void }) {
  const [type, setType] = useState<BookMeta["type"] | "not-found" | null>(null);
  // epub.js can't safely hot-swap its paginated/scrolled-doc flow on a live
  // rendition - EpubReaderView responds to a scroll-mode change by calling
  // this, which bumps the key below to force a clean remount that re-reads
  // the new preference at setup (see EpubReaderView's onScrollModeChange doc).
  const [epubRenderKey, setEpubRenderKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    getBookMeta(bookId).then((meta) => {
      if (!cancelled) setType(meta?.type ?? "not-found");
    });
    return () => {
      cancelled = true;
    };
  }, [bookId]);

  if (type === null) return null;
  if (type === "not-found") {
    return <ReaderErrorState message="This item is missing from your library - it may have been removed." onExit={onExit} />;
  }
  if (type === "pdf") return <PdfReaderView bookId={bookId} onExit={onExit} />;
  if (type === "text") return <TextReaderView bookId={bookId} onExit={onExit} />;
  return (
    <EpubReaderView
      key={epubRenderKey}
      bookId={bookId}
      onExit={onExit}
      onScrollModeChange={() => setEpubRenderKey((k) => k + 1)}
    />
  );
}

function ReaderPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const bookId = searchParams.get("book");

  if (bookId) {
    return (
      <ReaderOpenDispatcher
        key={bookId}
        bookId={bookId}
        onExit={() => startTransition(() => router.push("/reader"))}
      />
    );
  }

  return (
    <ReaderLibrary
      onOpenBook={(id) => startTransition(() => router.push(`/reader?book=${id}`))}
    />
  );
}

export default function ReaderPage() {
  return (
    <Suspense fallback={null}>
      <ReaderPageContent />
    </Suspense>
  );
}
