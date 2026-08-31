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
  isDue,
  masteryFor,
  memoryKey,
  pathsFor,
  unitsFromDeck,
  type MasteryEvidence,
} from "./recallModel";
import { buildSession, type SessionPlan } from "./sessionBuilder";

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
// v2 added the `asks` store. Every createObjectStore below is guarded by a
// `contains` check and nothing existing is touched, so upgrading a v1 database
// adds the one store and leaves units, memory and reviews exactly as they were -
// which matters more here than usual, since `reviews` is the asset the whole
// memory model can be rebuilt from and cannot be regenerated if lost.
const DB_VERSION = 2;

const UNITS_STORE = "units";
const MEMORY_STORE = "memory";
const REVIEWS_STORE = "reviews";
const ASKS_STORE = "asks";

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

/** What a session actually achieved, for the completion screen.
 *
 * Deliberately a single pass over two indexed reads rather than one query per
 * concept: a deck can hold a hundred-odd units, and the completion screen must
 * not fire a hundred IndexedDB transactions while the student is looking at it.
 *
 * `resting` is the number worth showing most: concepts the engine has decided
 * NOT to ask about, which is the one thing no flashcard app tells anyone. */
export type DeckSummary = {
  units: number;
  solid: number;
  fading: number;
  holding: number;
  familiar: number;
  met: number;
  /** Solid and comfortably inside its retention target - nothing to do here. */
  resting: number;
};

/** Everything a deck-level view needs about mastery, from one pass.
 *
 * `byUnit` is what a per-concept surface (the revision sheet) needs and what
 * `masteryOf` cannot supply affordably: called per concept it would fire two
 * IndexedDB transactions per card, so a 60-concept deck would open 120 while the
 * student waited. `units` comes back too, keyed by id, so a caller can render in
 * its own order without a second read. */
export type DeckMastery = {
  summary: DeckSummary;
  byUnit: Map<string, MasteryEvidence>;
  units: Map<string, KnowledgeUnit>;
  /** unitIds with nothing currently due - `resting`, per unit rather than counted. */
  resting: Set<string>;
};

export async function deckMastery(userId: string, deckId: string): Promise<DeckMastery> {
  const [allUnits, memories, reviews] = await Promise.all([
    listUnits(userId),
    listMemories(userId),
    listAllReviews(userId),
  ]);

  const units = new Map(allUnits.filter((u) => u.sourceDeckId === deckId).map((u) => [u.id, u]));
  const memoriesByUnit = new Map<string, MemoryRecord[]>();
  for (const m of memories) {
    if (!units.has(m.unitId)) continue;
    const list = memoriesByUnit.get(m.unitId);
    if (list) list.push(m);
    else memoriesByUnit.set(m.unitId, [m]);
  }
  const reviewsByUnit = new Map<string, ReviewRecord[]>();
  for (const r of reviews) {
    if (!units.has(r.unitId)) continue;
    const list = reviewsByUnit.get(r.unitId);
    if (list) list.push(r);
    else reviewsByUnit.set(r.unitId, [r]);
  }

  const summary: DeckSummary = {
    units: units.size,
    solid: 0,
    fading: 0,
    holding: 0,
    familiar: 0,
    met: 0,
    resting: 0,
  };
  const byUnit = new Map<string, MasteryEvidence>();
  const resting = new Set<string>();

  for (const unitId of units.keys()) {
    const unitMemories = memoriesByUnit.get(unitId) ?? [];
    const evidence = masteryFor(reviewsByUnit.get(unitId) ?? [], unitMemories);
    byUnit.set(unitId, evidence);
    summary[evidence.level] += 1;
    if (evidence.level === "solid" && unitMemories.length > 0 && !unitMemories.some((m) => isDue(m))) {
      summary.resting += 1;
      resting.add(unitId);
    }
  }

  return { summary, byUnit, units, resting };
}

export async function summariseDeck(userId: string, deckId: string): Promise<DeckSummary> {
  return (await deckMastery(userId, deckId)).summary;
}

async function listAllReviews(userId: string): Promise<ReviewRecord[]> {
  const db = await openDb();
  const tx = db.transaction(REVIEWS_STORE, "readonly");
  const rows = await requestToPromise<ReviewRecord[]>(
    tx.objectStore(REVIEWS_STORE).index(USER_INDEX).getAll(IDBKeyRange.only(userId)),
  );
  return rows.sort((a, b) => a.reviewedAt - b.reviewedAt);
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
  // No exam target exists yet, so this is always the away-from-exam band. The
  // ExamTarget lookup slots in here without touching anything else.
  const desiredRetention = desiredRetentionFor(importance, null);

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
  const tx = db.transaction([UNITS_STORE, MEMORY_STORE, REVIEWS_STORE, ASKS_STORE], "readwrite");
  tx.objectStore(UNITS_STORE).clear();
  tx.objectStore(MEMORY_STORE).clear();
  tx.objectStore(REVIEWS_STORE).clear();
  // Asks are the student's own words and an AI answer they paid a lookup for, so
  // account deletion has to take them too - the whole point of this function is
  // that nothing survives it.
  tx.objectStore(ASKS_STORE).clear();
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
export async function buildTodaySession(
  userId: string,
  decks: readonly Deck[],
  budgetMinutes: number,
  now?: number,
): Promise<SessionPlan> {
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
  return buildSession({ units, memories, reviews, budgetMinutes, now });
}

// ── React binding ────────────────────────────────────────────────────────────

/** Reactive memory list for the session builder and the library's progress
 * display. A plain effect rather than useSyncExternalStore, for the same reason
 * useBooks is: IndexedDB is async, so there is no synchronous snapshot to serve.
 *
 * Loaded rows are keyed by the user they were read for, and the signed-out case
 * is derived rather than stored - so switching account never shows the previous
 * one's memories for a frame, and the effect body never calls setState. */
const NO_MEMORIES: MemoryRecord[] = [];

export function useRecallMemories(userId: string | undefined): {
  memories: MemoryRecord[];
  loading: boolean;
} {
  const [loaded, setLoaded] = useState<{ userId: string; memories: MemoryRecord[] } | null>(null);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;

    function refresh() {
      if (!userId) return;
      listMemories(userId)
        .then((rows) => {
          if (!cancelled) setLoaded({ userId, memories: rows });
        })
        .catch(() => {
          // A read failure should leave the list empty rather than crash the
          // page: the engine is additive, and nothing in the existing study
          // feed depends on it yet.
          if (!cancelled) setLoaded({ userId, memories: NO_MEMORIES });
        });
    }

    refresh();
    window.addEventListener(RECALL_UPDATE_EVENT, refresh);
    return () => {
      cancelled = true;
      window.removeEventListener(RECALL_UPDATE_EVENT, refresh);
    };
  }, [userId]);

  if (!userId) return { memories: NO_MEMORIES, loading: false };
  const fresh = loaded?.userId === userId ? loaded.memories : null;
  return { memories: fresh ?? NO_MEMORIES, loading: fresh === null };
}
