import { useEffect, useState } from "react";
import type { BookMeta, HighlightRecord } from "./types";
import type { TextHighlightPosition } from "./textReaderUtils";

const DB_NAME = "flowrecall-reader";
// v2 added the highlights store; v3 adds the PDF text cache. Bumping this is
// what makes onupgradeneeded actually fire for students who already have an
// older database on disk.
const DB_VERSION = 3;
const BOOKS_STORE = "books";
const FILES_STORE = "bookFiles";
const HIGHLIGHTS_STORE = "highlights";
const HIGHLIGHTS_BOOK_INDEX = "bookId";
const PDF_TEXT_STORE = "pdfText";

// Same problem useSyncExternalStore solves for storage.ts's localStorage
// reads: same-tab writers need to hear about each other's changes. IndexedDB
// has no "storage" event at all (not even cross-tab), so this custom event
// is the only signal - every mutation below fires it, and useBooks()
// refetches in response.
const LIBRARY_UPDATE_EVENT = "reader-library-update";

function notifyLibraryUpdate() {
  window.dispatchEvent(new Event(LIBRARY_UPDATE_EVENT));
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(BOOKS_STORE)) {
        db.createObjectStore(BOOKS_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(FILES_STORE)) {
        db.createObjectStore(FILES_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(HIGHLIGHTS_STORE)) {
        const store = db.createObjectStore(HIGHLIGHTS_STORE, { keyPath: "id" });
        store.createIndex(HIGHLIGHTS_BOOK_INDEX, "bookId");
      }
      if (!db.objectStoreNames.contains(PDF_TEXT_STORE)) {
        db.createObjectStore(PDF_TEXT_STORE, { keyPath: "bookId" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// Records saved before "pdf"/"text" support (and before lastCfi was
// generalized to lastPosition) only ever held EPUBs and had no `type` field
// at all - default them forward instead of orphaning already-imported books.
function normalizeBookMeta(raw: BookMeta): BookMeta {
  const legacy = raw as BookMeta & { lastCfi?: string | null };
  return {
    ...raw,
    type: raw.type ?? "epub",
    lastPosition: raw.lastPosition ?? legacy.lastCfi ?? null,
  };
}

async function persistBook(meta: BookMeta, file: File): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([BOOKS_STORE, FILES_STORE], "readwrite");
    tx.objectStore(BOOKS_STORE).put(meta);
    tx.objectStore(FILES_STORE).put({ id: meta.id, file });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  notifyLibraryUpdate();
}

async function readCoverAsDataUrl(coverUrl: string | null): Promise<string | null> {
  if (!coverUrl) return null;
  try {
    const res = await fetch(coverUrl);
    const blob = await res.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  } catch {
    // A missing/broken cover shouldn't block the upload - the library grid
    // just falls back to its monogram placeholder for this book.
    return null;
  }
}

/** Parses just enough of an EPUB (title/author/cover) to file it in the
 * library, then persists the raw file separately so opening it later never
 * needs to re-parse metadata. epub.js is dynamically imported here (not at
 * module scope) since it touches `window` on load and this module is also
 * reachable from server-rendered code paths transitively via type-only imports. */
export async function addBook(file: File): Promise<BookMeta> {
  const ePub = (await import("epubjs")).default;
  const book = ePub(await file.arrayBuffer());
  await book.ready;

  const metadata = await book.loaded.metadata;
  const coverUrl = await book.coverUrl().catch(() => null);
  const coverDataUrl = await readCoverAsDataUrl(coverUrl);
  book.destroy();

  const meta: BookMeta = {
    id: crypto.randomUUID(),
    type: "epub",
    title: metadata.title?.trim() || file.name.replace(/\.epub$/i, "") || "Untitled Book",
    author: metadata.creator?.trim() || null,
    coverDataUrl,
    lastPosition: null,
    progress: 0,
    addedAt: Date.now(),
    lastOpenedAt: null,
  };

  await persistBook(meta, file);
  return meta;
}

/** Parses a PDF's Info dictionary (when present - many student-uploaded PDFs
 * have none, hence the filename fallback) and rasterizes page 1 at a small
 * scale for a real library-grid thumbnail, the same coverDataUrl slot EPUBs
 * populate from their embedded cover image. pdfjs-dist is dynamically
 * imported (not at module scope) for the same reason as epub.js above - it
 * touches `window`/the worker on load. */
export async function addPdf(file: File): Promise<BookMeta> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

  const buffer = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: buffer }).promise;

  const { info } = await doc.getMetadata().catch(() => ({ info: {} as Record<string, unknown> }));
  const infoRecord = info as Record<string, unknown>;
  const title = typeof infoRecord.Title === "string" ? infoRecord.Title.trim() : "";
  const author = typeof infoRecord.Author === "string" ? infoRecord.Author.trim() : "";

  let coverDataUrl: string | null = null;
  try {
    const page = await doc.getPage(1);
    const viewport = page.getViewport({ scale: 0.35 });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    if (canvas.getContext("2d")) {
      await page.render({ canvas, viewport }).promise;
      coverDataUrl = canvas.toDataURL("image/png");
    }
  } catch {
    // A thumbnail is a nice-to-have - the library grid's monogram fallback
    // covers this fine if page 1 fails to rasterize for any reason.
  }

  const meta: BookMeta = {
    id: crypto.randomUUID(),
    type: "pdf",
    title: title || file.name.replace(/\.pdf$/i, "") || "Untitled Document",
    author: author || null,
    coverDataUrl,
    lastPosition: null,
    progress: 0,
    addedAt: Date.now(),
    lastOpenedAt: null,
  };

  await persistBook(meta, file);
  return meta;
}

/** Wraps pasted text in a plain-text File so it can live in the same
 * bookFiles store (and go through the same getBookFile accessor) as EPUBs
 * and PDFs - no separate storage shape needed for the third content type. */
export async function addRawText(title: string, text: string): Promise<BookMeta> {
  const trimmedTitle = title.trim() || "Untitled Notes";
  const file = new File([text], `${trimmedTitle}.txt`, { type: "text/plain" });

  const meta: BookMeta = {
    id: crypto.randomUUID(),
    type: "text",
    title: trimmedTitle,
    author: null,
    coverDataUrl: null,
    lastPosition: null,
    progress: 0,
    addedAt: Date.now(),
    lastOpenedAt: null,
  };

  await persistBook(meta, file);
  return meta;
}

export async function listBooks(): Promise<BookMeta[]> {
  const db = await openDb();
  const tx = db.transaction(BOOKS_STORE, "readonly");
  const all = await requestToPromise(tx.objectStore(BOOKS_STORE).getAll() as IDBRequest<BookMeta[]>);
  return all.map(normalizeBookMeta).sort((a, b) => (b.lastOpenedAt ?? b.addedAt) - (a.lastOpenedAt ?? a.addedAt));
}

export async function getBookMeta(id: string): Promise<BookMeta | undefined> {
  const db = await openDb();
  const tx = db.transaction(BOOKS_STORE, "readonly");
  const raw = await requestToPromise(tx.objectStore(BOOKS_STORE).get(id) as IDBRequest<BookMeta | undefined>);
  return raw && normalizeBookMeta(raw);
}

export async function getBookFile(id: string): Promise<File | undefined> {
  const db = await openDb();
  const tx = db.transaction(FILES_STORE, "readonly");
  const record = await requestToPromise(
    tx.objectStore(FILES_STORE).get(id) as IDBRequest<{ id: string; file: File } | undefined>,
  );
  return record?.file;
}

/** Called on every "position changed" event (page turn, PDF page flip, text
 * scroll) - i.e. constantly while reading - so this intentionally does NOT
 * fire the library-update event, which would re-render the library grid on
 * every tick for a view it isn't even looking at. The library re-reads fresh
 * from IndexedDB next time it mounts. `position` is opaque - see BookMeta. */
export async function updateReadingPosition(id: string, position: string, progress: number): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(BOOKS_STORE, "readwrite");
  const store = tx.objectStore(BOOKS_STORE);
  const existing = await requestToPromise(store.get(id) as IDBRequest<BookMeta | undefined>);
  if (!existing) return;
  store.put({ ...existing, lastPosition: position, progress, lastOpenedAt: Date.now() } satisfies BookMeta);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function deleteBook(id: string): Promise<void> {
  return deleteBooks([id]);
}

/** Removes books and everything belonging to them - file, cached PDF text and
 * highlights - in a single transaction, so a multi-select delete either takes
 * every book the user ticked or leaves the library exactly as it was. One
 * library-update event at the end, so the grid repaints once rather than
 * flickering down one card at a time. */
export async function deleteBooks(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([BOOKS_STORE, FILES_STORE, HIGHLIGHTS_STORE, PDF_TEXT_STORE], "readwrite");
    const highlightsIndex = tx.objectStore(HIGHLIGHTS_STORE).index(HIGHLIGHTS_BOOK_INDEX);
    for (const id of ids) {
      tx.objectStore(BOOKS_STORE).delete(id);
      tx.objectStore(FILES_STORE).delete(id);
      tx.objectStore(PDF_TEXT_STORE).delete(id);
      // Orphaned highlights for a deleted book are meaningless - clean them up
      // via the bookId index rather than leaking them in IndexedDB forever.
      const cursorRequest = highlightsIndex.openCursor(IDBKeyRange.only(id));
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  notifyLibraryUpdate();
}

/** Removes every book in the library, and with it every file, cached PDF text
 * and highlight - the local half of account deletion. Goes through deleteBooks
 * so there is exactly one cascade in this file: a second one would drift out of
 * sync with it the next time a store is added. */
export async function deleteAllBooks(): Promise<void> {
  const books = await listBooks();
  await deleteBooks(books.map((book) => book.id));
}

/** Persists a highlight so it survives closing and reopening the book -
 * `position` is opaque and type-dependent, see HighlightRecord. Idempotent:
 * if a highlight already exists for this book at the exact same position
 * (e.g. the user double-clicked "Highlight" before the popover closed, or
 * re-selected text that's already highlighted), returns the EXISTING record
 * rather than inserting a duplicate that would render stacked on top of it.
 * Does NOT fire the library-update event (highlighting doesn't change
 * anything the library grid displays); callers update their own local
 * highlight list directly with the returned record so it paints immediately. */
export async function addHighlight(bookId: string, phrase: string, position: string): Promise<HighlightRecord> {
  const existing = await listHighlights(bookId);
  const duplicate = existing.find((h) => h.position === position);
  if (duplicate) return duplicate;

  const record: HighlightRecord = {
    id: crypto.randomUUID(),
    bookId,
    phrase,
    position,
    createdAt: Date.now(),
  };
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(HIGHLIGHTS_STORE, "readwrite");
    tx.objectStore(HIGHLIGHTS_STORE).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  return record;
}

export async function listHighlights(bookId: string): Promise<HighlightRecord[]> {
  const db = await openDb();
  const tx = db.transaction(HIGHLIGHTS_STORE, "readonly");
  const index = tx.objectStore(HIGHLIGHTS_STORE).index(HIGHLIGHTS_BOOK_INDEX);
  const all = await requestToPromise(index.getAll(IDBKeyRange.only(bookId)) as IDBRequest<HighlightRecord[]>);
  return all.sort((a, b) => a.createdAt - b.createdAt);
}

export async function deleteHighlight(id: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(HIGHLIGHTS_STORE, "readwrite");
    tx.objectStore(HIGHLIGHTS_STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Attaches (or edits) a highlight's note - either typed manually or saved
 * from a Define result. An emptied-out textarea trims to `undefined` rather
 * than storing "", so clearing a note cleanly returns the highlight to its
 * no-note state instead of leaving a blank note-view card behind. Returns
 * undefined if the highlight no longer exists (e.g. removed in another tab). */
export async function updateHighlightNote(id: string, note: string): Promise<HighlightRecord | undefined> {
  const db = await openDb();
  const tx = db.transaction(HIGHLIGHTS_STORE, "readwrite");
  const store = tx.objectStore(HIGHLIGHTS_STORE);
  const existing = await requestToPromise(store.get(id) as IDBRequest<HighlightRecord | undefined>);
  if (!existing) return undefined;

  const trimmed = note.trim();
  const updated: HighlightRecord = { ...existing, note: trimmed || undefined };
  store.put(updated);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  return updated;
}

/** Rewrites every highlight in a book through `remapParagraphIndex`, for when
 * the paragraph array a highlight was saved against is renumbered underneath it
 * (the v1 -> v2 blank-paragraph filter). Returns the updated records so the
 * caller can paint them without a refetch. Character offsets are untouched: the
 * surviving paragraphs' text is unchanged, only their positions moved. */
export async function remapHighlightParagraphs(
  bookId: string,
  remapParagraphIndex: (index: number) => number,
): Promise<HighlightRecord[]> {
  const existing = await listHighlights(bookId);
  const updated: HighlightRecord[] = existing.map((record) => {
    let position: TextHighlightPosition | null = null;
    try {
      const parsed = JSON.parse(record.position);
      if (typeof parsed?.paragraphIndex === "number") position = parsed;
    } catch {
      // An EPUB CFI or some other opaque position - nothing to renumber.
    }
    if (!position) return record;
    return {
      ...record,
      position: JSON.stringify({ ...position, paragraphIndex: remapParagraphIndex(position.paragraphIndex) }),
    };
  });

  const changed = updated.filter((record, i) => record.position !== existing[i].position);
  if (changed.length === 0) return existing;

  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(HIGHLIGHTS_STORE, "readwrite");
    const store = tx.objectStore(HIGHLIGHTS_STORE);
    for (const record of changed) store.put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  return updated;
}

/** Reactive book list for the library grid. Unlike storage.ts's
 * useSyncExternalStore hooks (localStorage reads are synchronous),
 * IndexedDB is inherently async, so this is a plain effect-driven
 * fetch-and-refetch instead - there's no synchronous snapshot to serve. */
export function useBooks(): { books: BookMeta[]; loading: boolean } {
  const [books, setBooks] = useState<BookMeta[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    function refresh() {
      listBooks().then((result) => {
        if (!cancelled) {
          setBooks(result);
          setLoading(false);
        }
      });
    }

    refresh();
    window.addEventListener(LIBRARY_UPDATE_EVENT, refresh);
    return () => {
      cancelled = true;
      window.removeEventListener(LIBRARY_UPDATE_EVENT, refresh);
    };
  }, []);

  return { books, loading };
}

/** A PDF's reflowed text, cached so the one-time extraction cost is paid once
 * per book ever rather than on every open.
 *
 * Extraction is the single most expensive thing either reader does - a 444-page
 * book takes ~4s of pdf.js text extraction on a laptop and over a minute on a
 * mid-range phone - and its output is a pure function of the file plus the
 * extractor's own heuristics. So it is cached under `version`: change the
 * paragraph reconstruction or the cipher-shift resolution, bump
 * PDF_EXTRACT_VERSION, and every stale cache is ignored rather than serving
 * text the current code would never have produced. */
export type PdfTextRecord = {
  bookId: string;
  version: number;
  paragraphs: string[];
  /** 1-based PDF page number -> index of the first paragraph on that page.
   * Serialized as a plain object because IndexedDB's structured clone handles
   * Map fine but JSON-shaped records stay easier to inspect and migrate. */
  pageToParagraphIndex: Record<number, number>;
  /** The document's real page count, which the map above can't imply: a page
   * whose text is empty (or entirely blank after decoding) gets no entry. Absent
   * on records written before it was stored. */
  pageCount?: number;
  /** Undefined until the background TOC pass finishes and re-saves the record. */
  toc?: unknown[];
  createdAt: number;
};

/** Returns whatever is cached for this book, at whatever version it was written.
 * The caller decides what to do with an older record - a v1 record can be
 * upgraded in place rather than thrown away (see PdfReaderView), which is worth
 * doing: re-extracting a 444-page book costs ~15s on a phone. */
export async function getPdfText(bookId: string): Promise<PdfTextRecord | null> {
  const db = await openDb();
  const tx = db.transaction(PDF_TEXT_STORE, "readonly");
  const record = await requestToPromise<PdfTextRecord | undefined>(
    tx.objectStore(PDF_TEXT_STORE).get(bookId),
  );
  return record ?? null;
}

export async function savePdfText(record: PdfTextRecord): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(PDF_TEXT_STORE, "readwrite");
    tx.objectStore(PDF_TEXT_STORE).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
