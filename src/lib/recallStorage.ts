import { useEffect, useState } from "react";
import type { Deck } from "./types";
import { coupleSibling, COUPLING_ON_LAPSE, COUPLING_ON_SUCCESS, desiredRetentionFor, intervalFor, nextState, AGAIN } from "./fsrs";
import {
  type Confidence,
  type KnowledgeUnit,
  type MemoryRecord,
  type RetrievalPath,
  type ReviewRecord,
  gradeFor,
  masteryFor,
  memoryKey,
  daysUntilExam,
  masteryOver,
  pathsFor,
  projectedRecall,
  unitsFromDeck,
  type MasteryEvidence,
  type DeckMastery,
  type DeckSummary,
} from "./recallModel";
import { buildSession, type SessionPlan } from "./sessionBuilder";
import { planSync, rebuildMemory, replayDivergences, type SyncPayload } from "./recallSync";
import {
  clearProgress,
  getAllDeckRows,
  getSavedDecks,
  getSyncCursor,
  mergeRemoteDecks,
  setSyncCursor,
} from "./storage";
import { apiUrl, API_FETCH_CREDENTIALS } from "./apiUrl";

export type { DeckMastery, DeckSummary } from "./recallModel";

// The recall engine's persistence, on the device.
//
// A separate database from `flowrecall-reader` on purpose: independent version
// lifecycle (bumping one must not force an upgrade of the other), independent
// failure surface, and account deletion can drop this one wholesale without
// touching the book library.
//
// Everything here runs on-device with no server involved, which is what lets
// the whole engine work inside the Capacitor shell - a static export with no
// Next.js server behind it (see next.config.ts) - and offline. Syncing these
// stores to Postgres for durability and cross-device is the next phase; until
// it lands, this is device-local, exactly as the deck list already was.

const DB_NAME = "flowrecall-recall";
// v2 added the `asks` store, v3 the `teachBacks` store. Every createObjectStore
// below is guarded by a `contains` check and nothing existing is touched, so
// upgrading an older database adds only the missing stores and leaves units, memory
// and reviews exactly as they were - which matters more here than usual, since
// `reviews` is the asset the whole memory model can be rebuilt from and cannot be
// regenerated if lost.
const DB_VERSION = 3;

const UNITS_STORE = "units";
const MEMORY_STORE = "memory";
const REVIEWS_STORE = "reviews";
const ASKS_STORE = "asks";
const TEACH_BACKS_STORE = "teachBacks";

const USER_INDEX = "userId";
const UNIT_INDEX = "unitId";
// Composite, so reading one memory row's siblings (for coupling) and one unit's
// history are both single index range reads rather than a full-store scan.
const USER_UNIT_INDEX = "userId_unitId";

// Same gap useSyncExternalStore closes for storage.ts's localStorage reads:
// same-tab writers need to hear each other. IndexedDB fires no event of its own
// at all, not even across tabs, so this is the only signal.
const RECALL_UPDATE_EVENT = "recall-engine-update";

function notifyRecallUpdate() {
  window.dispatchEvent(new Event(RECALL_UPDATE_EVENT));
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(UNITS_STORE)) {
        const units = db.createObjectStore(UNITS_STORE, { keyPath: "id" });
        units.createIndex(USER_INDEX, "userId");
      }
      if (!db.objectStoreNames.contains(MEMORY_STORE)) {
        const memory = db.createObjectStore(MEMORY_STORE, { keyPath: "key" });
        memory.createIndex(USER_INDEX, "userId");
        memory.createIndex(UNIT_INDEX, "unitId");
        memory.createIndex(USER_UNIT_INDEX, ["userId", "unitId"]);
      }
      if (!db.objectStoreNames.contains(REVIEWS_STORE)) {
        const reviews = db.createObjectStore(REVIEWS_STORE, { keyPath: "id" });
        reviews.createIndex(USER_INDEX, "userId");
        reviews.createIndex(USER_UNIT_INDEX, ["userId", "unitId"]);
      }
      if (!db.objectStoreNames.contains(ASKS_STORE)) {
        const asks = db.createObjectStore(ASKS_STORE, { keyPath: "id" });
        asks.createIndex(USER_INDEX, "userId");
        asks.createIndex(USER_UNIT_INDEX, ["userId", "unitId"]);
      }
      if (!db.objectStoreNames.contains(TEACH_BACKS_STORE)) {
        const teachBacks = db.createObjectStore(TEACH_BACKS_STORE, { keyPath: "id" });
        teachBacks.createIndex(USER_INDEX, "userId");
        teachBacks.createIndex(USER_UNIT_INDEX, ["userId", "unitId"]);
      }
    };
    // A version change cannot start while another connection still holds the
    // database open at the older version. On the web that is a second tab; it
    // happened for real while adding v2, when a devtools script held a v1
    // connection and the upgrade simply never fired. Logged rather than rejected
    // on purpose: the open does complete once the blocker closes, whereas a
    // rejection would be cached in dbPromise and kill the engine for the whole
    // session. A blocked upgrade is otherwise indistinguishable from "this student
    // has no history", which is the worst way for it to fail.
    request.onblocked = () => {
      console.error(
        `${DB_NAME}: upgrade to v${DB_VERSION} is blocked by another open connection - ` +
          "nothing will be recorded until that connection closes.",
      );
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      // Clear the cache so a later call can try again. Holding a rejected promise
      // here would make one transient failure permanent for the session.
      dbPromise = null;
      reject(request.error);
    };
  });
  return dbPromise;
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// ── Reads ────────────────────────────────────────────────────────────────────

export async function listUnits(userId: string): Promise<KnowledgeUnit[]> {
  const db = await openDb();
  const tx = db.transaction(UNITS_STORE, "readonly");
  return requestToPromise<KnowledgeUnit[]>(
    tx.objectStore(UNITS_STORE).index(USER_INDEX).getAll(IDBKeyRange.only(userId)),
  );
}

export async function listMemories(userId: string): Promise<MemoryRecord[]> {
  const db = await openDb();
  const tx = db.transaction(MEMORY_STORE, "readonly");
  return requestToPromise<MemoryRecord[]>(
    tx.objectStore(MEMORY_STORE).index(USER_INDEX).getAll(IDBKeyRange.only(userId)),
  );
}

export async function listUnitMemories(userId: string, unitId: string): Promise<MemoryRecord[]> {
  const db = await openDb();
  const tx = db.transaction(MEMORY_STORE, "readonly");
  return requestToPromise<MemoryRecord[]>(
    tx.objectStore(MEMORY_STORE).index(USER_UNIT_INDEX).getAll(IDBKeyRange.only([userId, unitId])),
  );
}

export async function listUnitReviews(userId: string, unitId: string): Promise<ReviewRecord[]> {
  const db = await openDb();
  const tx = db.transaction(REVIEWS_STORE, "readonly");
  const rows = await requestToPromise<ReviewRecord[]>(
    tx.objectStore(REVIEWS_STORE).index(USER_UNIT_INDEX).getAll(IDBKeyRange.only([userId, unitId])),
  );
  return rows.sort((a, b) => a.reviewedAt - b.reviewedAt);
}

/** How long this student normally takes on this format, most recent first.
 * Feeds fastAnswerThreshold, which is what makes the lucky-guess check relative
 * to the person rather than to a fixed millisecond figure that would punish
 * fast readers and wave slow guessers through. */
export async function recentLatencies(
  userId: string,
  path: RetrievalPath,
  limit = 200,
): Promise<number[]> {
  const db = await openDb();
  const tx = db.transaction(REVIEWS_STORE, "readonly");
  const rows = await requestToPromise<ReviewRecord[]>(
    tx.objectStore(REVIEWS_STORE).index(USER_INDEX).getAll(IDBKeyRange.only(userId)),
  );
  return rows
    .filter((r) => r.path === path && r.correct && r.latencyMs > 0)
    .sort((a, b) => b.reviewedAt - a.reviewedAt)
    .slice(0, limit)
    .map((r) => r.latencyMs);
}

/** Mastery for one unit, evaluated against its own review history. */
export async function masteryOf(userId: string, unitId: string): Promise<MasteryEvidence> {
  const [reviews, memories] = await Promise.all([
    listUnitReviews(userId, unitId),
    listUnitMemories(userId, unitId),
  ]);
  return masteryFor(reviews, memories);
}

export async function deckMastery(userId: string, deckId: string): Promise<DeckMastery> {
  const [allUnits, memories, reviews] = await Promise.all([
    listUnits(userId),
    listMemories(userId),
    listAllReviews(userId),
  ]);
  return masteryOver(allUnits, memories, reviews, (u) => u.sourceDeckId === deckId);
}

export async function summariseDeck(userId: string, deckId: string): Promise<DeckSummary> {
  return (await deckMastery(userId, deckId)).summary;
}

/** The same summary across every deck this account holds.
 *
 * What the home screen needs, and the reason it is one function rather than a loop
 * over `summariseDeck`: that loop would re-read all three stores once per deck, so
 * a student with eight decks would open twenty-four transactions to answer one
 * question. */
export async function summariseAll(userId: string): Promise<DeckSummary> {
  const [allUnits, memories, reviews] = await Promise.all([
    listUnits(userId),
    listMemories(userId),
    listAllReviews(userId),
  ]);
  return masteryOver(allUnits, memories, reviews, () => true).summary;
}

async function listAllReviews(userId: string): Promise<ReviewRecord[]> {
  const db = await openDb();
  const tx = db.transaction(REVIEWS_STORE, "readonly");
  const rows = await requestToPromise<ReviewRecord[]>(
    tx.objectStore(REVIEWS_STORE).index(USER_INDEX).getAll(IDBKeyRange.only(userId)),
  );
  return rows.sort((a, b) => a.reviewedAt - b.reviewedAt);
}

async function listAllAsks(userId: string): Promise<AskRecord[]> {
  const db = await openDb();
  const tx = db.transaction(ASKS_STORE, "readonly");
  const rows = await requestToPromise<AskRecord[]>(
    tx.objectStore(ASKS_STORE).index(USER_INDEX).getAll(IDBKeyRange.only(userId)),
  );
  return rows.sort((a, b) => a.askedAt - b.askedAt);
}

/** Days-until-exam per deck, for every deck on this device.
 *
 * One synchronous localStorage read rather than one per unit: recordReview runs on
 * every answer, and a student can hold a dozen decks. `null` is never stored here -
 * a deck with no exam is simply absent, so a caller reads `?? null`. */
function examDaysByDeck(now: number): Map<string, number> {
  const days = new Map<string, number>();
  for (const deck of getAllDeckRows()) {
    const until = daysUntilExam(deck.examDate, now);
    if (until !== null) days.set(deck.id, until);
  }
  return days;
}

// ── Writes ───────────────────────────────────────────────────────────────────

/** Copies a deck's concepts in as knowledge units, without touching the deck.
 *
 * Idempotent: unit ids are derived from deck+concept id, so re-running this
 * over a deck that has grown (Infinite Recall, or a JIT continuation appending
 * to `pendingChunks`) adds the new concepts and leaves existing units - and
 * therefore their memory and review history - exactly where they were. */
export async function importDeck(deck: Deck, userId: string): Promise<KnowledgeUnit[]> {
  const units = unitsFromDeck(deck, userId).filter((unit) => pathsFor(unit.concept).length > 0);
  if (units.length === 0) return [];

  const db = await openDb();
  const tx = db.transaction(UNITS_STORE, "readwrite");
  const store = tx.objectStore(UNITS_STORE);
  for (const unit of units) {
    // put() rather than add(): re-import must overwrite the concept text (a
    // deck can be edited) while keeping the same id, not throw on conflict.
    store.put(unit);
  }
  await txDone(tx);
  notifyRecallUpdate();
  return units;
}

export type RecordedReview = {
  review: ReviewRecord;
  /** The reviewed path's memory after the update. */
  memory: MemoryRecord;
  /** How many sibling formats of the same concept were nudged by coupling. */
  siblingsCoupled: number;
};

/** Records one retrieval and advances the memory model. The engine's only write
 * path, and the one function whose correctness everything else rests on.
 *
 * Memory and review are written in a SINGLE transaction, so the derived cache
 * and the append-only log can never disagree about what happened - the same
 * reasoning behind /api/study/track's transaction around the streak and its
 * StudyDay row.
 *
 * `latencyMs` is time from the probe appearing to the answer landing. Pass 0
 * when a caller genuinely cannot measure it; the guess check then treats the
 * answer as trustworthy rather than suspect, which is the safe direction. */
export async function recordReview(input: {
  userId: string;
  unitId: string;
  path: RetrievalPath;
  outcome: "correct" | "incorrect" | "skipped";
  latencyMs: number;
  reviewedAt?: number;
  /** Only ever present on a failed recognition answer the student answered the
   * confidence question for - see Confidence in recallModel.ts. */
  confidence?: Confidence;
}): Promise<RecordedReview> {
  const reviewedAt = input.reviewedAt ?? Date.now();

  // Read outside the write transaction: this is a full-index scan for the
  // student's latency history, and holding a readwrite transaction open across
  // it would block every other write for no benefit.
  const { fastAnswerThreshold } = await import("./recallModel");
  const fastThresholdMs = fastAnswerThreshold(await recentLatencies(input.userId, input.path));
  const graded = gradeFor(input.outcome, input.latencyMs, { path: input.path, fastThresholdMs });

  // Exam dates read BEFORE the transaction opens. localStorage is synchronous so
  // reading it inside would be safe, but keeping the transaction body to nothing
  // but IndexedDB requests is the rule that makes it obviously safe rather than
  // safe-if-you-check.
  const examDays = examDaysByDeck(reviewedAt);

  const db = await openDb();
  const tx = db.transaction([UNITS_STORE, MEMORY_STORE, REVIEWS_STORE], "readwrite");
  const unitsStore = tx.objectStore(UNITS_STORE);
  const memoryStore = tx.objectStore(MEMORY_STORE);
  const reviewsStore = tx.objectStore(REVIEWS_STORE);

  // Every await below resolves from an IndexedDB request in this same
  // transaction, which keeps it alive - the same pattern as
  // readerStorage.ts's updateReadingPosition. Awaiting anything else here
  // (a fetch, a timer) would let the transaction auto-commit underneath us.
  const unit = await requestToPromise<KnowledgeUnit | undefined>(unitsStore.get(input.unitId));
  const importance = unit?.importance ?? 0.5;
  // An exam inside three weeks raises this deck's floor to 0.95, so the engine
  // drills harder as the paper approaches. `null` for a deck with no exam, and for
  // a unit whose deck has gone - which is the away-from-exam band, as before.
  const desiredRetention = desiredRetentionFor(
    importance,
    unit ? (examDays.get(unit.sourceDeckId) ?? null) : null,
  );

  const key = memoryKey(input.userId, input.unitId, input.path);
  const existing = await requestToPromise<MemoryRecord | undefined>(memoryStore.get(key));
  const siblings = await requestToPromise<MemoryRecord[]>(
    memoryStore.index(USER_UNIT_INDEX).getAll(IDBKeyRange.only([input.userId, input.unitId])),
  );

  const elapsedDays = existing ? Math.max(0, (reviewedAt - existing.lastReviewedAt) / MS_PER_DAY) : 0;
  const previousState = existing ? { stability: existing.stability, difficulty: existing.difficulty } : null;

  // An uncredited answer records the evidence and moves nothing: a correct
  // response that arrived too fast to be recall is not proof of recall, and
  // letting it advance the interval is how false mastery gets built.
  const advanced = graded.credit
    ? nextState(previousState, graded.grade, elapsedDays)
    : (previousState ?? nextState(null, AGAIN, 0));

  const memory: MemoryRecord = {
    key,
    userId: input.userId,
    unitId: input.unitId,
    path: input.path,
    stability: advanced.stability,
    difficulty: advanced.difficulty,
    lastReviewedAt: graded.credit || !existing ? reviewedAt : existing.lastReviewedAt,
    // Deliberately unfuzzed. Anki fuzzes due dates to stop cards clumping on
    // one day; here the session builder already reshuffles by value against a
    // time budget, so fuzz would only add noise to a decision made downstream.
    dueAt: reviewedAt + intervalFor(advanced.stability, desiredRetention) * MS_PER_DAY,
    reps: (existing?.reps ?? 0) + 1,
    // Only a credited failure is a lapse. A card scrolled past unanswered must
    // not count against the memory it was never tested on.
    lapses: (existing?.lapses ?? 0) + (graded.credit && graded.grade === AGAIN ? 1 : 0),
    desiredRetention,
  };
  memoryStore.put(memory);

  // Coupling: this concept's other formats test the same memory, so a result on
  // one is partial evidence about the rest. Without this, tracking N formats
  // would cost a student N times as much as one card and call it depth.
  let siblingsCoupled = 0;
  if (graded.credit && previousState) {
    for (const sibling of siblings) {
      if (sibling.path === input.path) continue;
      const coupled = coupleSibling(
        { stability: sibling.stability, difficulty: sibling.difficulty },
        previousState.stability,
        advanced.stability,
        graded.grade,
      );
      memoryStore.put({
        ...sibling,
        stability: coupled.stability,
        difficulty: coupled.difficulty,
        // The sibling was not reviewed, so lastReviewedAt must not move - its
        // elapsed time is still counting from its own last real retrieval. Only
        // the due date shifts, because its stability changed.
        dueAt: sibling.lastReviewedAt + intervalFor(coupled.stability, sibling.desiredRetention) * MS_PER_DAY,
      } satisfies MemoryRecord);
      siblingsCoupled += 1;
    }
  }

  const review: ReviewRecord = {
    id: crypto.randomUUID(),
    userId: input.userId,
    unitId: input.unitId,
    path: input.path,
    reviewedAt,
    grade: graded.grade,
    correct: input.outcome === "correct",
    latencyMs: input.latencyMs,
    credited: graded.credit,
    elapsedDays,
    stabilityBefore: previousState?.stability ?? null,
    stabilityAfter: advanced.stability,
    // Spread rather than assigned, so a review nobody answered the question for
    // stores no `confidence` key at all. `confidence: undefined` would serialise
    // into IndexedDB as a present-but-empty field, and "not asked" has to stay
    // distinguishable from "asked and answered" for masteryFor to be honest.
    ...(input.confidence ? { confidence: input.confidence } : {}),
    // Stamped per review so the two unfitted coupling constants can be refitted
    // later against real data rather than defended on intuition forever.
    couplingOnSuccess: COUPLING_ON_SUCCESS,
    couplingOnLapse: COUPLING_ON_LAPSE,
  };
  reviewsStore.put(review);

  await txDone(tx);
  notifyRecallUpdate();
  return { review, memory, siblingsCoupled };
}

// ── Migration ────────────────────────────────────────────────────────────────

const MIGRATION_FLAG_KEY = "flowrecall:recall-migrated";

/** Copies every deck already in localStorage into the engine, once.
 *
 * Non-destructive by design: `flowrecall:savedDecks` is left exactly as it is,
 * so the study feed keeps working off it unchanged and a bad migration is a
 * no-op to recover from rather than a data loss. Removing the localStorage copy
 * is a separate decision for a later release, once this store has proven itself
 * on real devices.
 *
 * The flag only skips the work; it is not load-bearing for correctness, since
 * importDeck is idempotent. Clearing it re-runs the import harmlessly. */
export async function migrateSavedDecks(userId: string, decks: readonly Deck[]): Promise<number> {
  if (typeof window === "undefined" || decks.length === 0) return 0;

  let imported = 0;
  for (const deck of decks) {
    const units = await importDeck(deck, userId);
    imported += units.length;
  }
  window.localStorage.setItem(MIGRATION_FLAG_KEY, String(Date.now()));
  return imported;
}

export function hasMigratedSavedDecks(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(MIGRATION_FLAG_KEY) !== null;
}

// ── Deletion ─────────────────────────────────────────────────────────────────

/** Drops every store in this database - the recall half of account deletion.
 *
 * Clears rather than deletes the database itself: deleteDatabase blocks
 * indefinitely while any other tab holds a connection open, which would hang the
 * deletion flow at the exact moment the user most needs it to complete. */
export async function deleteAllRecallData(): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(
    [UNITS_STORE, MEMORY_STORE, REVIEWS_STORE, ASKS_STORE, TEACH_BACKS_STORE],
    "readwrite",
  );
  tx.objectStore(UNITS_STORE).clear();
  tx.objectStore(MEMORY_STORE).clear();
  tx.objectStore(REVIEWS_STORE).clear();
  // Asks are the student's own words and an AI answer they paid a lookup for, so
  // account deletion has to take them too - the whole point of this function is
  // that nothing survives it. Teach-backs are more personal again: an attempt is
  // the student's own understanding, written out in full.
  tx.objectStore(ASKS_STORE).clear();
  tx.objectStore(TEACH_BACKS_STORE).clear();
  await txDone(tx);
  if (typeof window !== "undefined") window.localStorage.removeItem(MIGRATION_FLAG_KEY);
  notifyRecallUpdate();
}

// ── Asks ─────────────────────────────────────────────────────────────────────

/** A question the student asked about one concept, and the answer they got.
 *
 * Kept here rather than on the deck's concept in localStorage, and that is the
 * whole reason it lives in this file: decks are not scoped to an account, which
 * is the wart that makes deleting any account on a shared phone wipe the whole
 * device's reader library. Every record in this database carries a userId, so two
 * people signing in on one phone can never read each other's questions.
 *
 * Append-only in practice - a student can ask the same card several things and
 * all of them are worth keeping, because together they are that person's own
 * route into the concept. */
export type AskRecord = {
  id: string;
  userId: string;
  unitId: string;
  question: string;
  answer: string;
  /** True when the model said the concept's material does not cover this, so the
   * UI can mark the answer as reaching beyond the source rather than presenting
   * it with the same authority as the rest. */
  beyondMaterial: boolean;
  askedAt: number;
};

/** Oldest first, so a card reads as the conversation it was. */
export async function listAsks(userId: string, unitId: string): Promise<AskRecord[]> {
  const db = await openDb();
  const tx = db.transaction(ASKS_STORE, "readonly");
  const rows = await requestToPromise<AskRecord[]>(
    tx.objectStore(ASKS_STORE).index(USER_UNIT_INDEX).getAll(IDBKeyRange.only([userId, unitId])),
  );
  return rows.sort((a, b) => a.askedAt - b.askedAt);
}

export async function saveAsk(input: {
  userId: string;
  unitId: string;
  question: string;
  answer: string;
  beyondMaterial?: boolean;
}): Promise<AskRecord> {
  const record: AskRecord = {
    id: crypto.randomUUID(),
    userId: input.userId,
    unitId: input.unitId,
    question: input.question,
    answer: input.answer,
    beyondMaterial: input.beyondMaterial ?? false,
    askedAt: Date.now(),
  };
  const db = await openDb();
  const tx = db.transaction(ASKS_STORE, "readwrite");
  tx.objectStore(ASKS_STORE).put(record);
  await txDone(tx);
  notifyRecallUpdate();
  return record;
}

// ── Teach-backs ──────────────────────────────────────────────────────────────

/** One attempt at explaining a concept in the student's own words, and what came
 * back.
 *
 * Stored for the same reason asks are - it carries a userId, so two people on one
 * phone can never read each other's - but it is worth keeping for a different
 * reason. An ask is a question and an answer; this is the student's own
 * understanding as it stood on a date, which is the only record in the app of them
 * getting BETTER at explaining something rather than faster at recognising it.
 * Re-reading last week's attempt is the feature.
 *
 * Immutable, like a review and an ask: a second attempt at the same concept is a new
 * record, never an edit of the old one. That is what makes the sync a union with
 * nothing to resolve. */
export type TeachBackRecord = {
  id: string;
  userId: string;
  unitId: string;
  /** What the student wrote, verbatim. Never rewritten - the point is comparing it
   * with what they write next time. */
  attempt: string;
  correct: string[];
  missing: string[];
  wrong: string[];
  attemptedAt: number;
};

/** Oldest first, so a concept reads as the progression it is. */
export async function listTeachBacks(userId: string, unitId: string): Promise<TeachBackRecord[]> {
  const db = await openDb();
  const tx = db.transaction(TEACH_BACKS_STORE, "readonly");
  const rows = await requestToPromise<TeachBackRecord[]>(
    tx
      .objectStore(TEACH_BACKS_STORE)
      .index(USER_UNIT_INDEX)
      .getAll(IDBKeyRange.only([userId, unitId])),
  );
  return rows.sort((a, b) => a.attemptedAt - b.attemptedAt);
}

export async function saveTeachBack(input: {
  userId: string;
  unitId: string;
  attempt: string;
  correct: string[];
  missing: string[];
  wrong: string[];
}): Promise<TeachBackRecord> {
  const record: TeachBackRecord = {
    id: crypto.randomUUID(),
    userId: input.userId,
    unitId: input.unitId,
    attempt: input.attempt,
    correct: input.correct,
    missing: input.missing,
    wrong: input.wrong,
    attemptedAt: Date.now(),
  };
  const db = await openDb();
  const tx = db.transaction(TEACH_BACKS_STORE, "readwrite");
  tx.objectStore(TEACH_BACKS_STORE).put(record);
  await txDone(tx);
  notifyRecallUpdate();
  return record;
}

/** Every teach-back this account holds, for the sync push. */
async function listAllTeachBacks(userId: string): Promise<TeachBackRecord[]> {
  const db = await openDb();
  const tx = db.transaction(TEACH_BACKS_STORE, "readonly");
  return requestToPromise<TeachBackRecord[]>(
    tx.objectStore(TEACH_BACKS_STORE).index(USER_INDEX).getAll(IDBKeyRange.only(userId)),
  );
}

/** Tonight's session, across every deck the student has.
 *
 * Imports first, and has to: units only enter the engine when a deck is studied or
 * swept in by migrateSavedDecks, so a student who has generated decks but never
 * opened the feed has no units at all - and the home screen is precisely where they
 * would be standing. importDeck is idempotent, so this is a no-op for anything
 * already present and picks up decks created since the last visit.
 *
 * Only decks with no units are imported, rather than all of them every time, since
 * this runs on a screen the student may sit on. */
export type SessionInputs = {
  units: KnowledgeUnit[];
  memories: MemoryRecord[];
  reviews: ReviewRecord[];
};

/** The three reads a session is built from, separated from the building so a caller
 * that lets the student change the time budget can re-rank without re-scanning. The
 * reviews store only grows, so re-reading it on every chip tap is the one part of
 * this that would not stay cheap. */
export async function readSessionInputs(
  userId: string,
  decks: readonly Deck[],
): Promise<SessionInputs> {
  const existing = await listUnits(userId);
  const known = new Set(existing.map((u) => u.sourceDeckId));
  const missing = decks.filter((deck) => !known.has(deck.id));
  for (const deck of missing) {
    await importDeck(deck, userId).catch((error) => console.error("importDeck failed", error));
  }

  const [units, memories, reviews] = await Promise.all([
    missing.length > 0 ? listUnits(userId) : Promise.resolve(existing),
    listMemories(userId),
    listAllReviews(userId),
  ]);
  return { units, memories, reviews };
}

export async function buildTodaySession(
  userId: string,
  decks: readonly Deck[],
  budgetMinutes: number,
  now?: number,
): Promise<SessionPlan> {
  const inputs = await readSessionInputs(userId, decks);
  return buildSession({ ...inputs, budgetMinutes, now });
}

/** Brings a deck's existing memory rows into line with its exam date.
 *
 * Needed because a memory row carries the retention target that was in force when
 * it was last written. Without this, setting an exam date would only tighten
 * concepts the student happened to answer AFTERWARDS - so a student who set the date
 * and then studied would be drilled harder, and one who set it and looked at the
 * home screen would see nothing change at all. Clearing a date runs the same sweep
 * in reverse, because a deck whose exam has been cancelled must relax again.
 *
 * `dueAt` is recomputed from `lastReviewedAt` rather than from now, exactly as
 * recordReview and the sync replay do: the interval is a property of the memory, not
 * of when somebody happened to open a settings control.
 *
 * Returns how many rows moved, which is what the device pass measures. */
export async function applyExamDateToMemory(
  userId: string,
  deckId: string,
  now = Date.now(),
): Promise<number> {
  const examDays = examDaysByDeck(now).get(deckId) ?? null;
  const units = new Map(
    (await listUnits(userId)).filter((u) => u.sourceDeckId === deckId).map((u) => [u.id, u]),
  );
  if (units.size === 0) return 0;

  const db = await openDb();
  const tx = db.transaction(MEMORY_STORE, "readwrite");
  const store = tx.objectStore(MEMORY_STORE);
  const mine = await requestToPromise<MemoryRecord[]>(
    store.index(USER_INDEX).getAll(IDBKeyRange.only(userId)),
  );

  let moved = 0;
  for (const memory of mine) {
    const unit = units.get(memory.unitId);
    if (!unit) continue;
    const desiredRetention = desiredRetentionFor(unit.importance, examDays);
    const dueAt =
      memory.lastReviewedAt + intervalFor(memory.stability, desiredRetention) * MS_PER_DAY;
    // Skipped when nothing actually changes, so a no-op sweep does not rewrite every
    // row and wake every listener for a repaint that says the same thing.
    if (desiredRetention === memory.desiredRetention && dueAt === memory.dueAt) continue;
    store.put({ ...memory, desiredRetention, dueAt } satisfies MemoryRecord);
    moved += 1;
  }

  await txDone(tx);
  if (moved > 0) notifyRecallUpdate();
  return moved;
}

// ── Sync ─────────────────────────────────────────────────────────────────────

/** One reconcile: push what this device changed, pull what any other device did,
 * then recompute scheduler state from the merged review log.
 *
 * Fire-and-forget by design, the same posture recordReview takes. A failed sync
 * must never stall the feed or lose an answer - it only postpones durability to
 * the next attempt, and because the cursor advances only on success, the next
 * attempt re-sends everything this one tried to.
 *
 * `memory` is rebuilt rather than merged. It is a cache over `reviews` (see the
 * MemoryRecord docblock), so recomputing it from the union removes the only state
 * two devices could disagree about: there is no version of a memory row to pick
 * between, only a log to replay. */
export async function syncNow(userId: string): Promise<{ pushed: number; pulled: number } | null> {
  if (typeof window === "undefined") return null;
  const since = getSyncCursor(userId);

  const [units, reviews, asks, teachBacks] = await Promise.all([
    listUnits(userId),
    listAllReviews(userId),
    listAllAsks(userId),
    listAllTeachBacks(userId),
  ]);
  // Decks are per device, not per account (see Deck.userId): only this account's
  // go up, and a deck saved before owners were recorded counts as this account's,
  // which is exactly how the library already treats it.
  const decks = getAllDeckRows().filter((deck) => deck.userId === undefined || deck.userId === userId);
  const local: SyncPayload = { decks, units, reviews, asks, teachBacks };

  const { toPush } = planSync({ local, remote: emptyPayload(), since, now: Date.now() });

  // Push in chunks the route will actually accept, then pull separately. A first
  // sync pushes EVERYTHING (since is null, so planSync's cutoff is -Infinity), and
  // sending it as one request was a wedge rather than a degradation: past the
  // route's caps every attempt returned 400, so the cursor never advanced and the
  // next attempt sent the same oversized body again, forever.
  for (const chunk of pushChunks(toPush)) {
    await postSync({ since, pull: false, payload: chunk });
  }

  // Pull until the server says there is nothing after this page. The cursor comes
  // from `nextSince` rather than from `now`, because only the server knows which
  // collections its page cut off - see the route. Advancing to `now` after a
  // truncated page, which is what this used to do, filtered the rows it had not
  // yet seen out of every future pull.
  let cursor = since;
  let complete = false;
  const pulled = emptyPayload();
  for (let page = 0; page < MAX_PULL_PAGES; page++) {
    const remote = await postSync({ since: cursor, pull: true, payload: emptyPayload() });
    // Rows come back without an owner (the server writes every row with the
    // session's own id), so stamp it on before anything is written locally -
    // every local index is keyed by userId.
    pulled.decks.push(...remote.decks.map((deck) => ({ ...deck, userId })));
    pulled.units.push(...remote.units.map((unit) => ({ ...unit, userId })));
    pulled.reviews.push(...remote.reviews.map((review) => ({ ...review, userId })));
    pulled.asks.push(...remote.asks.map((ask) => ({ ...ask, userId })));
    // A route deployed before teach-backs existed returns no such key, and an older
    // client is what this guard is really for - either way an absent collection is
    // "nothing new", not a crash on the whole sync.
    pulled.teachBacks.push(...(remote.teachBacks ?? []).map((row) => ({ ...row, userId })));
    cursor = remote.nextSince;
    if (!remote.more) {
      complete = true;
      break;
    }
  }

  const { toWrite, deckTombstones } = planSync({ local, remote: pulled, since, now: Date.now() });

  mergeRemoteDecks(toWrite.decks);
  // A deck deleted elsewhere takes its saved session with it, exactly as a local
  // delete does.
  for (const deckId of deckTombstones) clearProgress(deckId);

  const pulledAnything =
    toWrite.decks.length + toWrite.units.length + toWrite.reviews.length + toWrite.asks.length > 0;
  if (pulledAnything) {
    await writePulledRows(toWrite);
    await rebuildMemoryStore(userId);
  }

  // Only on a pull that reached the end. A cursor advanced past an unfinished
  // pull is the one failure here that is silent AND unrecoverable, so the cost of
  // being wrong in this direction - re-pulling rows the merge then discards - is
  // the cheap side of the trade.
  if (complete && cursor !== null) setSyncCursor(userId, cursor);
  else if (!complete) {
    console.warn(
      `recall: stopped pulling after ${MAX_PULL_PAGES} pages with more still waiting - ` +
        "the cursor stays put, so the next sync resumes from the same place.",
    );
  }
  // Only when something actually arrived. Notifying unconditionally would be a
  // loop with a fuse on it: SyncEngine syncs on this event, and a sync that always
  // fires it would schedule the next sync forever, on an idle device, for nothing.
  if (pulledAnything) notifyRecallUpdate();
  return { pushed: toPush.reviews.length, pulled: toWrite.reviews.length };
}

/** What one request carries up, well under /api/sync's own caps (500 decks, 5000
 * units, 5000 reviews, 1000 asks, 500 teach-backs).
 *
 * Decks and units are the small numbers here even though the route allows more of
 * them, because both embed whole `Concept` objects - every explanation, every
 * source quote - so a few hundred decks is megabytes of request body, and the
 * ceiling that bites first is the platform's, not the route's. Reviews are a
 * handful of numbers each and can go up in bulk. Teach-backs sit between the two:
 * an attempt is a paragraph the student wrote plus three short lists. */
const PUSH_CHUNK = { decks: 20, units: 500, reviews: 2000, asks: 500, teachBacks: 200 } as const;

/** How many pull pages one sync will walk before giving up and leaving the rest
 * for the next one. At the route's page sizes this is more than a hundred thousand
 * reviews; it exists so a server that always answers `more: true` cannot spin here
 * forever. */
const MAX_PULL_PAGES = 25;

/** Splits a push into requests the route accepts. Every collection is sliced in
 * parallel, so one request carries a slice of each rather than four separate
 * passes - the route writes all four in one transaction either way. */
function pushChunks(toPush: SyncPayload): SyncPayload[] {
  const count = Math.max(
    Math.ceil(toPush.decks.length / PUSH_CHUNK.decks),
    Math.ceil(toPush.units.length / PUSH_CHUNK.units),
    Math.ceil(toPush.reviews.length / PUSH_CHUNK.reviews),
    Math.ceil(toPush.asks.length / PUSH_CHUNK.asks),
    Math.ceil(toPush.teachBacks.length / PUSH_CHUNK.teachBacks),
  );
  return Array.from({ length: count }, (_, i) => ({
    decks: toPush.decks.slice(i * PUSH_CHUNK.decks, (i + 1) * PUSH_CHUNK.decks),
    units: toPush.units.slice(i * PUSH_CHUNK.units, (i + 1) * PUSH_CHUNK.units),
    reviews: toPush.reviews.slice(i * PUSH_CHUNK.reviews, (i + 1) * PUSH_CHUNK.reviews),
    asks: toPush.asks.slice(i * PUSH_CHUNK.asks, (i + 1) * PUSH_CHUNK.asks),
    teachBacks: toPush.teachBacks.slice(
      i * PUSH_CHUNK.teachBacks,
      (i + 1) * PUSH_CHUNK.teachBacks,
    ),
  }));
}

type SyncResponse = SyncPayload & { now: number; more: boolean; nextSince: number };

/** One /api/sync round trip. Throws on anything but 200 so a failed sync leaves
 * the cursor exactly where it was and the next attempt re-sends everything. */
async function postSync(input: {
  since: number | null;
  pull: boolean;
  payload: SyncPayload;
}): Promise<SyncResponse> {
  const response = await fetch(apiUrl("/api/sync"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: API_FETCH_CREDENTIALS,
    body: JSON.stringify({
      since: input.since,
      pull: input.pull,
      // The owner is never sent - see withoutOwner.
      decks: input.payload.decks.map(withoutOwner),
      units: input.payload.units.map(withoutOwner),
      reviews: input.payload.reviews.map(withoutOwner),
      asks: input.payload.asks.map(withoutOwner),
      teachBacks: input.payload.teachBacks.map(withoutOwner),
    }),
  });
  if (!response.ok) throw new Error(`sync failed: ${response.status}`);
  return (await response.json()) as SyncResponse;
}

function emptyPayload(): SyncPayload {
  return { decks: [], units: [], reviews: [], asks: [], teachBacks: [] };
}

/** Drops the owner from a row on its way up. The server writes every row with the
 * session's own user id, so sending one is at best redundant and at worst a claim
 * to be someone else - and /api/sync's schema rejects it outright. */
function withoutOwner<T extends { userId?: string }>(row: T): Omit<T, "userId"> {
  const copy: T = { ...row };
  delete copy.userId;
  return copy;
}

/** Everything pulled, in one transaction per store. `put` rather than `add`: the
 * merge has already decided these rows win, and a retry must not throw. */
async function writePulledRows(rows: SyncPayload): Promise<void> {
  if (
    rows.units.length === 0 &&
    rows.reviews.length === 0 &&
    rows.asks.length === 0 &&
    rows.teachBacks.length === 0
  ) {
    return;
  }
  const db = await openDb();
  const tx = db.transaction(
    [UNITS_STORE, REVIEWS_STORE, ASKS_STORE, TEACH_BACKS_STORE],
    "readwrite",
  );
  for (const unit of rows.units) tx.objectStore(UNITS_STORE).put(unit);
  for (const review of rows.reviews) tx.objectStore(REVIEWS_STORE).put(review);
  for (const ask of rows.asks) tx.objectStore(ASKS_STORE).put(ask);
  for (const row of rows.teachBacks) tx.objectStore(TEACH_BACKS_STORE).put(row);
  await txDone(tx);
}

/** Replaces this user's memory rows with a replay of their whole review log.
 *
 * Also checks the replay against what each review recorded at the time and logs
 * any divergence. That check is the difference between "sync rebuilt your
 * schedule" and "sync rewrote your schedule", and it is nearly free: the stability
 * each review produced is already stored on the row. */
async function rebuildMemoryStore(userId: string): Promise<void> {
  const [units, reviews] = await Promise.all([listUnits(userId), listAllReviews(userId)]);
  const divergences = replayDivergences(reviews, units);
  if (divergences.length > 0) {
    console.error(
      `recall: replaying the review log did not reproduce ${divergences.length} of ${reviews.length} ` +
        "recorded stabilities - the scheduler and its replay have diverged.",
      divergences.slice(0, 5),
    );
  }

  // Decks passed so a rebuild keeps whatever exam dates are currently set. This runs
  // after every pull, so omitting them would relax a deck whose paper is next week
  // the moment the student's phone synced - the one way this feature could silently
  // undo itself.
  const rebuilt = rebuildMemory(reviews, units, getAllDeckRows());
  const db = await openDb();
  const tx = db.transaction(MEMORY_STORE, "readwrite");
  const store = tx.objectStore(MEMORY_STORE);
  // Only this user's rows: a shared device may hold another account's memory, and
  // clearing the whole store would destroy it.
  const mine = await requestToPromise<MemoryRecord[]>(
    store.index(USER_INDEX).getAll(IDBKeyRange.only(userId)),
  );
  const keep = new Set(rebuilt.map((row) => row.key));
  for (const row of mine) if (!keep.has(row.key)) store.delete(row.key);
  for (const row of rebuilt) store.put(row);
  await txDone(tx);
}

// ── React binding ────────────────────────────────────────────────────────────

/** What the home screen says about durable knowledge, from one read.
 *
 * `atMs` is the instant to project to and belongs to the caller, not here: the
 * horizon is a product decision (the nearest exam date, or a fixed week when there
 * is none) and this function should not have an opinion about it.
 *
 * Deliberately does NOT import missing decks the way readSessionInputs does. An
 * import is a write, and a screen that reads should not quietly write; `importDeck`
 * fires `recall-engine-update` when TodaySession does it, which re-runs the hook
 * below - so the number arrives a frame later rather than never. */
/** How far ahead the projection looks when no exam date has been set.
 *
 * A week, because it is long enough for real decay to show on anything that is
 * actually slipping and short enough that a student can picture it. An exam date
 * replaces it entirely - see the horizon argument below. */
export const PROJECTION_FALLBACK_DAYS = 7;

export type MemoryOverview = {
  summary: DeckSummary;
  expected: number;
  total: number;
  /** The instant projected to, and how far ahead that was when the number was
   * computed. Both handed back so the UI labels the projection from the same read
   * that produced it - recomputing `Date.now()` at render time is how a caption
   * comes to disagree with the number above it. */
  atMs: number;
  horizonDays: number;
  /** True when the projection is anchored to a real exam rather than the fallback
   * week, so the UI can say "on exam day" instead of "in 7 days" without deciding
   * for itself which one the number was computed for. */
  anchoredToExam: boolean;
};

const EMPTY_OVERVIEW: MemoryOverview = {
  summary: { units: 0, solid: 0, fading: 0, holding: 0, familiar: 0, met: 0, resting: 0 },
  expected: 0,
  total: 0,
  atMs: 0,
  horizonDays: PROJECTION_FALLBACK_DAYS,
  anchoredToExam: false,
};

export async function readMemoryOverview(
  userId: string,
  atMs: number,
  now = Date.now(),
  anchoredToExam = false,
): Promise<MemoryOverview> {
  const [allUnits, memories, reviews] = await Promise.all([
    listUnits(userId),
    listMemories(userId),
    listAllReviews(userId),
  ]);

  // Deleting a deck tombstones the row and leaves its units in IndexedDB, so an
  // account-wide count over every unit would keep charging the student for concepts
  // they threw away - "61 of 94" when their library holds 40. `getSavedDecks` is the
  // live list; anything whose deck is gone is dropped here.
  const live = new Set(getSavedDecks().map((deck) => deck.id));
  const units = allUnits.filter((unit) => live.has(unit.sourceDeckId));

  const { summary } = masteryOver(units, memories, reviews, () => true);
  const { expected, total } = projectedRecall(units, memories, atMs);
  return {
    summary,
    expected,
    total,
    atMs,
    horizonDays: Math.max(1, Math.round((atMs - now) / MS_PER_DAY)),
    anchoredToExam,
  };
}

/** Reactive overview, re-read on every engine write.
 *
 * A plain effect rather than useSyncExternalStore, for the same reason useBooks is:
 * IndexedDB is async, so there is no synchronous snapshot to serve. Keyed by the
 * user it was read for, so switching account never shows the previous one's numbers
 * for a frame.
 *
 * A read failure degrades to the empty overview rather than throwing: the component
 * renders nothing on an empty overview anyway, and the home screen must not break
 * because a projection could not be computed. */
export function useMemoryOverview(
  userId: string | undefined,
  /** The soonest exam date across the student's decks, past or future, or `null`.
   *
   * A fixed timestamp rather than the instant to project to, deliberately:
   * `Date.now() + a week` is a new number on every render and would make this effect
   * re-subscribe forever. Whether that exam is still AHEAD is decided at read time,
   * below - a component may not read the clock while rendering, and an exam already
   * sat must fall back to the week rather than projecting into the past. */
  examDate: number | null,
): { overview: MemoryOverview; loading: boolean } {
  const [loaded, setLoaded] = useState<{ userId: string; overview: MemoryOverview } | null>(null);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;

    function refresh() {
      if (!userId) return;
      const now = Date.now();
      const untilExam = daysUntilExam(examDate ?? undefined, now);
      const ahead = untilExam !== null && untilExam >= 0;
      const atMs = ahead
        ? (examDate as number)
        : now + PROJECTION_FALLBACK_DAYS * MS_PER_DAY;
      readMemoryOverview(userId, atMs, now, ahead)
        .then((overview) => {
          if (!cancelled) setLoaded({ userId, overview });
        })
        .catch(() => {
          if (!cancelled) setLoaded({ userId, overview: EMPTY_OVERVIEW });
        });
    }

    refresh();
    window.addEventListener(RECALL_UPDATE_EVENT, refresh);
    return () => {
      cancelled = true;
      window.removeEventListener(RECALL_UPDATE_EVENT, refresh);
    };
  }, [userId, examDate]);

  if (!userId) return { overview: EMPTY_OVERVIEW, loading: false };
  const fresh = loaded?.userId === userId ? loaded.overview : null;
  return { overview: fresh ?? EMPTY_OVERVIEW, loading: fresh === null };
}
