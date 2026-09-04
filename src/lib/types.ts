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
  /** The wrong belief `distractor` encodes, named - e.g. "students confuse stroke
   * volume with cardiac output because both are per-beat quantities". Lets a
   * failed card say WHY the wrong option was tempting instead of only that it was
   * wrong, which is the difference between correcting a mistake and repeating it.
   * Optional for the same reason `explanation` is: decks predate it. */
  misconception?: string;
  /** One line on the consequence of knowing this - what it lets you do or predict.
   * Read on the revision sheet, where a list of facts otherwise gives no sense of
   * which ones carry weight. */
  whyItMatters?: string;
  /** The sentence from the uploaded material this card was generated from.
   * Provenance without touching the reader: it grounds a card in the student's own
   * source, which is the direct answer to "I memorised the card, not the concept". */
  sourceQuote?: string;
};

/** How two of a deck's concepts relate.
 *
 * Three kinds, deliberately, and each one earns its row on the revision sheet:
 * `prerequisite` orders the deck, `explains` joins a mechanism to what follows
 * from it, and `contrast` names the pair a student actually mixes up. A fourth
 * would have to justify a fourth row on a 360dp screen.
 *
 * Direction matters for the first two and not the third:
 * - `prerequisite` - `from` has to be understood before `to`.
 * - `explains` - `from` is the mechanism, `to` is the consequence.
 * - `contrast` - symmetric; the pair is confusable in either order. */
export type ConceptRelation = "prerequisite" | "explains" | "contrast";

/** One relationship, by concept id.
 *
 * Ids, not the labels the model actually emits. Labels are neither unique nor
 * stable - a deck can hold two cards with the same one - so an edge stored by
 * label would point at both. `validateEdges` in conceptGraph.ts resolves labels to
 * ids and is the only thing that should ever mint one of these. */
export type ConceptEdge = {
  from: string;
  to: string;
  relation: ConceptRelation;
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
  /** The model id this deck was generated with - continuing it later (the
   * home page's "Generate Next Section") reuses this instead of silently
   * falling back to the free model regardless of the user's actual plan.
   * Optional/undefined for decks saved before this field existed. */
  model?: string;
  /** Identity of the text this deck was generated from - `sourceKeyFor` in
   * sourceKey.ts over the whole upload. What makes a second upload of the same
   * PDF land *in* this deck instead of beside it in the library, which is what a
   * student means by "continue my book".
   *
   * Cannot be backfilled: the source text a deck consumed is not kept, and
   * `pendingChunks` is only the shrinking remainder, so it is no identity at all.
   * Decks saved before this field existed therefore never match, and degrade to
   * exactly today's behaviour - a new deck - rather than to a wrong match. */
  sourceKey?: string;
  /** Last local change, for sync's last-write-wins. Optional because every deck
   * saved before sync existed has none - such a deck falls back to createdAt,
   * which is the honest reading: nothing has touched it since. */
  updatedAt?: number;
  /** Who this deck belongs to. Decks live in localStorage, which is per DEVICE
   * rather than per account, so on a shared phone one account's library is
   * already visible to the next - that is today's behaviour and this does not
   * change it. What it prevents is that mistake becoming permanent: sync only
   * pushes decks this account owns, so B never adopts A's decks server-side.
   * Optional because decks saved before sync existed have no owner recorded, and
   * those are treated as the current user's, exactly as they are today. */
  userId?: string;
  /** When this deck was deleted. A deleted deck is kept as a TOMBSTONE rather
   * than removed, because a row that simply vanishes cannot propagate: the next
   * pull from another device would hand it straight back. `getSavedDecks` filters
   * these out, so nothing above storage.ts ever sees one. */
  deletedAt?: number;
  /** How this deck's concepts relate, from one pass over the finished deck (see
   * /api/concept-map). **Absent means never mapped**, which is not the same as
   * "no relationships" - so the revision sheet offers to map rather than showing
   * an empty section. Ingest cannot produce these: it sees 1500 characters at a
   * time and never has two chunks in front of it at once. */
  conceptMap?: ConceptEdge[];
  /** Local midnight of the day this deck is examined, if the student set one.
   *
   * Feeds `daysUntilExam` in `desiredRetentionFor`, which has always accepted that
   * argument and never received it - inside 21 days it raises this deck's retention
   * floor to 0.95, so the engine genuinely drills harder as the paper approaches.
   * Also what the home projection anchors to instead of a fixed horizon.
   *
   * Stored as a timestamp rather than a date string so it sorts and subtracts
   * without parsing, and normalised to LOCAL midnight: a student who says "the 14th"
   * means their own 14th, and UTC midnight is the previous evening for half the
   * world. Absent means no exam, which is not the same as an exam in the past. */
  examDate?: number;
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

export type ChallengeLevel = 1 | 2;
export type ChallengeOutcome = "correct" | "incorrect" | "skipped";

/** One card in a study session's live queue - the same concept appears at
 * least twice per session on purpose (once as a Level 1 swipe, once as a
 * Level 2 fill-in-the-blank - two genuinely different questions, not the
 * same fact shown twice), and can appear again if D.I.E. requeues a failed
 * card at an easier level, distinguished by `attempt`. `lane` records which
 * of the two initial questions this item (or its retry chain) descends from,
 * since both start at `attempt: 1` and would otherwise be indistinguishable
 * when reconstructing resolved state on resume - see reconstructResolvedKeys
 * in StudyFeed.tsx. `isNew` is set to true on cards freshly injected by
 * Infinite Recall so they can play a "materialised" entrance animation the
 * first time they enter the viewport. */
export type QueueItem = {
  key: string;
  concept: Concept;
  level: ChallengeLevel;
  lane: 1 | 2;
  attempt: number;
  isNew?: boolean;
  /** `${deckId}::${conceptId}`, carried on items built by the session builder.
   *
   * A deck session can derive it from the one deck it is studying; a session drawn
   * from the whole library cannot, because each card belongs to a different deck.
   * Optional so every existing saved session still loads, and so the feed can fall
   * back to deriving it from its own deckId. */
  unitId?: string;
};

/** A snapshot of an in-progress (or finished) study session for one deck,
 * persisted so closing the tab mid-session doesn't lose it - see
 * saveProgress/getProgress in storage.ts. */
export type StudyProgress = {
  deckId: string;
  masteredIds: string[];
  queue: QueueItem[];
  /** Exact set of already-answered item keys. Optional so progress saved
   * before this field existed still loads - StudyFeed falls back to
   * heuristically reconstructing it from queue + masteredIds in that case.
   * Persisting it directly (rather than only ever reconstructing it) matters
   * now that a concept has two independent per-lane questions: masteredIds
   * alone can't tell "the swipe lane is done" apart from "the cloze lane is
   * done" for the same concept id, so a heuristic keyed only on concept id
   * would wrongly treat an unanswered lane as already resolved. */
  resolvedKeys?: string[];
  /** `${conceptId}::${lane}` for every lane answered CORRECTLY, so mastery can
   * require two different question formats rather than one lucky answer.
   * Optional for the same reason resolvedKeys is: sessions saved before this
   * field existed still load, and fall back to treating an already-mastered
   * concept as having both lanes passed. */
  correctLaneKeys?: string[];
};
