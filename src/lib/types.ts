// Shared with the client (StreakModal) - lives here rather than in the route
// file so it's importable from the Capacitor build, where src/app/api is
// moved aside during `next build` (see scripts/build-capacitor.mjs).
export type StreakDay = {
  /** Single-letter weekday label, Monday-first. */
  label: string;
  /** ISO date (yyyy-mm-dd) for keying on the client. */
  date: string;
  studied: boolean;
  isToday: boolean;
  /** A later day this week the user hasn't reached yet - rendered hollow. */
  future: boolean;
};

export type StreakResponse = {
  currentStreak: number;
  days: StreakDay[];
};

export type Concept = {
  id: string;
  concept: string;
  question: string;
  answer: string;
  /** A plausible but incorrect answer, used as the false option in a true/false swipe. */
  distractor: string;
  /** A declarative sentence stating the fact with the answer replaced by "_____". */
  cloze: string;
  /** A full paragraph (3-4 sentences) deep-diving the concept, its mechanisms,
   * and why it matters. Optional so decks generated before this field existed
   * still load - consumers fall back to `answer` when it's absent. */
  explanation?: string;
};

/** A saved set of concepts, persisted in localStorage so a page refresh
 * doesn't lose a generated deck - see saveDeck/getSavedDecks in storage.ts. */
export type Deck = {
  id: string;
  title: string;
  createdAt: number;
  concepts: Concept[];
  /** Raw text chunks from the original upload that weren't processed yet
   * because they fell past the Speed-First Cap - see appendConceptsToDeck
   * in storage.ts for JIT-generating them later from the Library. Omitted
   * entirely (not an empty array) once nothing is left to generate. */
  pendingChunks?: string[];
};

export type BookType = "epub" | "pdf" | "text";

/** Lightweight metadata for one uploaded/pasted reader item - deliberately
 * excludes the raw file bytes (kept in a separate IndexedDB store, see
 * readerStorage.ts) so the library grid can list items without ever loading
 * a full binary into memory. Covers all three reader content types. */
export type BookMeta = {
  id: string;
  type: BookType;
  title: string;
  author: string | null;
  /** A small data: URL thumbnail - EPUB's embedded cover, a rendered page-1
   * thumbnail for PDF, or null (text has none, falls back to an icon). */
  coverDataUrl: string | null;
  /** Opaque, type-dependent resume position: an epub.js CFI for "epub", a
   * JSON-encoded {page, scale} for "pdf", a stringified scroll fraction for
   * "text". Null for a never-opened item. */
  lastPosition: string | null;
  /** 0-1 read fraction as of lastPosition, for the progress bar in the library. */
  progress: number;
  addedAt: number;
  lastOpenedAt: number | null;
};

/** A saved highlight, persisted per-book so it survives closing and
 * reopening the reader. `position` is opaque and type-dependent, mirroring
 * BookMeta.lastPosition: an epub.js CFI *range* string for "epub", a JSON
 * {page, unitRects} for "pdf" (unitRects are 0-1 fractions of the page's
 * rendered width/height, so they reproject correctly at any zoom level), or
 * a JSON {paragraphIndex, start, end} for "text" (offsets within a single
 * paragraph - a selection spanning a paragraph break saves against its
 * starting paragraph only). */
export type HighlightRecord = {
  id: string;
  bookId: string;
  phrase: string;
  position: string;
  /** Free-form text the student attached to this highlight - either typed
   * directly or saved from a Define result (see DefinitionPopover's "Save as
   * Note"). Undefined for highlights with no note; IndexedDB is schemaless,
   * so records saved before this field existed just read as undefined - no
   * migration needed. */
  note?: string;
  createdAt: number;
};

export type ChallengeLevel = 1 | 2 | 3;
export type ChallengeOutcome = "correct" | "incorrect" | "skipped";

/** One card in a study session's live queue - the same concept can appear
 * more than once across a session (D.I.E. requeues a failed concept at an
 * easier level), distinguished by `attempt`. `isNew` is set to true on
 * cards freshly injected by Infinite Recall so they can play a
 * "materialised" entrance animation the first time they enter the viewport. */
export type QueueItem = {
  key: string;
  concept: Concept;
  level: ChallengeLevel;
  attempt: number;
  isNew?: boolean;
};

/** A snapshot of an in-progress (or finished) study session for one deck,
 * persisted so closing the tab mid-session doesn't lose it - see
 * saveProgress/getProgress in storage.ts. */
export type StudyProgress = {
  deckId: string;
  streak: number;
  masteredIds: string[];
  queue: QueueItem[];
};
