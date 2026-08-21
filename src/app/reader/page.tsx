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
import { deleteBook, getBookMeta, useBooks } from "@/lib/readerStorage";
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

function BookCard({ book, onOpen, onDelete }: { book: BookMeta; onOpen: () => void; onDelete: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="group relative flex flex-col gap-2"
    >
      <button
        type="button"
        onClick={onOpen}
        className="relative aspect-[2/3] w-full overflow-hidden rounded-xl border border-border bg-surface shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_12px_28px_-10px_rgba(0,0,0,0.7)] transition-transform active:scale-[0.97]"
      >
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

      <button
        type="button"
        aria-label={`Remove ${book.title}`}
        onClick={onDelete}
        className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-zinc-300 opacity-0 backdrop-blur-md transition-opacity hover:bg-black/80 group-hover:opacity-100 focus-visible:opacity-100"
      >
        <svg viewBox="0 0 24 24" fill="none" className="h-3 w-3" aria-hidden="true">
          <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
        </svg>
      </button>

      <div className="px-0.5">
        <p className="truncate text-sm font-medium text-foreground">{book.title}</p>
        {book.author && <p className="truncate text-xs text-muted-foreground">{book.author}</p>}
      </div>
    </motion.div>
  );
}

type AddMode = "upload" | "paste";

function AddModeToggle({ mode, onChange }: { mode: AddMode; onChange: (mode: AddMode) => void }) {
  return (
    <div className="inline-flex gap-0.5 rounded-full border border-border bg-foreground/5 p-0.5">
      {(["upload", "paste"] as const).map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => onChange(m)}
          className={`rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors ${
            mode === m ? "bg-foreground/10 text-foreground" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {m === "upload" ? "Upload File" : "Paste Text"}
        </button>
      ))}
    </div>
  );
}

function ReaderLibrary({ onOpenBook }: { onOpenBook: (id: string) => void }) {
  const { books, loading } = useBooks();
  const [mode, setMode] = useState<AddMode>("upload");

  function handleDelete(book: BookMeta) {
    if (!window.confirm(`Remove "${book.title}" from your library? This can't be undone.`)) return;
    deleteBook(book.id);
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
        <div className="mt-10 grid grid-cols-2 gap-4 sm:grid-cols-3">
          {books.map((book) => (
            <BookCard
              key={book.id}
              book={book}
              onOpen={() => onOpenBook(book.id)}
              onDelete={() => handleDelete(book)}
            />
          ))}
        </div>
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
  return <EpubReaderView bookId={bookId} onExit={onExit} />;
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
