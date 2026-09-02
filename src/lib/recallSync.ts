import {
  AGAIN,
  coupleSibling,
  desiredRetentionFor,
  intervalFor,
  nextState,
} from "./fsrs";
import {
  memoryKey,
  type KnowledgeUnit,
  type MemoryRecord,
  type ReviewRecord,
} from "./recallModel";
import type { AskRecord, TeachBackRecord } from "./recallStorage";
import type { Deck } from "./types";

// Making the learning record survive the phone.
//
// Two pure functions, no IndexedDB and no fetch, so both are testable in
// vitest's node environment like the rest of the engine. The IO that calls them
// lives in recallStorage.ts, the same split sessionBuilder.ts already has.
//
// The design rests on one property the engine was built with from the start:
// `reviews` is append-only and `memory` is a cache over it (see the MemoryRecord
// docblock in recallModel.ts). So two devices can never disagree about scheduler
// state - the log merges by union, and state is recomputed from the merged log
// rather than arbitrated between versions.

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Rebuilds every memory record by replaying the review log.
 *
 * A faithful re-run of recordReview's state transition, and it has to stay
 * faithful: if replay and the live path ever disagree, a sync silently rewrites a
 * student's schedule. Three things make that checkable rather than hopeful -
 *
 * 1. The row carries its own inputs. `grade`, `credited` and `elapsedDays` were
 *    all decided at review time and stored, so replay never re-derives them from
 *    a latency threshold that has since moved.
 * 2. The row carries the coupling constants in force when it was written, which
 *    `coupleSibling` now accepts, so refitting them does not rewrite history.
 * 3. The row stores `stabilityAfter`, so a replay can be checked against what
 *    actually happened - see replayDivergences, and the invariant in the test.
 *
 * `desiredRetention` is the one value NOT taken from the row: it derives from the
 * unit's current importance, so starring a concept later correctly re-dates it
 * rather than pinning it to the target it had at first review. That is deliberate,
 * and it is why the invariant test holds importance constant. */
export function rebuildMemory(
  reviews: readonly ReviewRecord[],
  units: readonly KnowledgeUnit[],
): MemoryRecord[] {
  return replay(reviews, units).memory;
}

/** Every review whose replayed stability does not match what was recorded at the
 * time. Empty means the replay reproduced history exactly.
 *
 * A self-check, not a repair: it is what the test asserts on, and what a caller
 * can log to discover that a scheduler change has quietly broken the ability to
 * rebuild. Single pass, like the rebuild itself - checking each review by
 * replaying the prefix before it would be quadratic, and a year of study is tens
 * of thousands of rows. */
export function replayDivergences(
  reviews: readonly ReviewRecord[],
  units: readonly KnowledgeUnit[],
  tolerance = 1e-9,
): { reviewId: string; recorded: number; replayed: number }[] {
  return replay(reviews, units, tolerance).divergences;
}

function replay(
  reviews: readonly ReviewRecord[],
  units: readonly KnowledgeUnit[],
  tolerance = 1e-9,
): { memory: MemoryRecord[]; divergences: { reviewId: string; recorded: number; replayed: number }[] } {
  const importance = new Map(units.map((unit) => [unit.id, unit.importance]));
  const state = new Map<string, MemoryRecord>();
  const divergences: { reviewId: string; recorded: number; replayed: number }[] = [];

  for (const review of orderedForReplay(reviews)) {
    const desiredRetention = desiredRetentionFor(importance.get(review.unitId) ?? 0.5, null);
    const key = memoryKey(review.userId, review.unitId, review.path);
    const existing = state.get(key);
    const previous = existing ? { stability: existing.stability, difficulty: existing.difficulty } : null;

    // recordReview reads the siblings BEFORE writing this path's row, so the
    // snapshot has to be taken here to mirror it. (It cannot matter today, since
    // the loop below skips this path - but a mirror that is only accidentally
    // right is the kind that stops being right.)
    const siblings = [...state.values()].filter(
      (m) => m.unitId === review.unitId && m.path !== review.path,
    );

    // An uncredited answer records the evidence and moves nothing.
    const advanced = review.credited
      ? nextState(previous, review.grade, review.elapsedDays)
      : (previous ?? nextState(null, AGAIN, 0));

    if (Math.abs(advanced.stability - review.stabilityAfter) > tolerance) {
      divergences.push({
        reviewId: review.id,
        recorded: review.stabilityAfter,
        replayed: advanced.stability,
      });
    }

    state.set(key, {
      key,
      userId: review.userId,
      unitId: review.unitId,
      path: review.path,
      stability: advanced.stability,
      difficulty: advanced.difficulty,
      lastReviewedAt: review.credited || !existing ? review.reviewedAt : existing.lastReviewedAt,
      dueAt: review.reviewedAt + intervalFor(advanced.stability, desiredRetention) * MS_PER_DAY,
      reps: (existing?.reps ?? 0) + 1,
      lapses: (existing?.lapses ?? 0) + (review.credited && review.grade === AGAIN ? 1 : 0),
      desiredRetention,
    });

    if (!review.credited || !previous) continue;
    for (const sibling of siblings) {
      const coupled = coupleSibling(
        { stability: sibling.stability, difficulty: sibling.difficulty },
        previous.stability,
        advanced.stability,
        review.grade,
        { onSuccess: review.couplingOnSuccess, onLapse: review.couplingOnLapse },
      );
      state.set(sibling.key, {
        ...sibling,
        stability: coupled.stability,
        difficulty: coupled.difficulty,
        // Unreviewed, so its elapsed time still counts from its own last real
        // retrieval - only the due date moves.
        dueAt:
          sibling.lastReviewedAt +
          intervalFor(coupled.stability, sibling.desiredRetention) * MS_PER_DAY,
      });
    }
  }

  return { memory: [...state.values()], divergences };
}

/** Global order per user, not per unit: coupling crosses a unit's formats, so the
 * interleaving of two paths' reviews changes the outcome. `id` breaks ties so the
 * replay is deterministic when two reviews share a millisecond. */
function orderedForReplay(reviews: readonly ReviewRecord[]): ReviewRecord[] {
  return reviews
    .slice()
    .sort((a, b) => a.reviewedAt - b.reviewedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

// ── The merge ────────────────────────────────────────────────────────────────

export type SyncPayload = {
  decks: Deck[];
  units: KnowledgeUnit[];
  reviews: ReviewRecord[];
  asks: AskRecord[];
  teachBacks: TeachBackRecord[];
};

/** How far back before the last cursor a push still re-sends rows.
 *
 * The cursor alone would be enough if device clocks were monotonic, and they are
 * not: a manual clock change or a timezone jump can stamp a review BEHIND the
 * last successful sync, and a row skipped by the cursor is a row lost forever.
 * Re-sending a week costs a few hundred small rows on a request the server
 * deduplicates by primary key anyway, and buys back the one failure mode that
 * would be silent and unrecoverable. An outbox table would be the alternative;
 * this is the version with no second source of truth to keep consistent. */
export const PUSH_SAFETY_MS = 7 * 24 * 60 * 60 * 1000;

/** Decides what to send up and what to write down. Pure, so every rule below is
 * a test rather than an argument.
 *
 * Conflicts, in full: **reviews, asks and teach-backs are immutable**, so a row
 * already held locally is never rewritten and the merge is a union by id. A second
 * attempt at explaining the same concept is a new row, never an edit. **Units and decks
 * are last-write-wins**, and a deck's stamp is the LATEST of createdAt, updatedAt
 * and deletedAt - which is what makes a tombstone beat an edit it postdates, and
 * an edit beat a tombstone it postdates. Losing that would resurrect a deck the
 * student deleted on their phone the moment their laptop next syncs. */
export function planSync(input: {
  local: SyncPayload;
  remote: SyncPayload;
  since: number | null;
  now: number;
}): { toPush: SyncPayload; toWrite: SyncPayload; deckTombstones: string[] } {
  const cutoff = input.since === null ? -Infinity : input.since - PUSH_SAFETY_MS;

  const localDecks = new Map(input.local.decks.map((d) => [d.id, d]));
  const localUnits = new Map(input.local.units.map((u) => [u.id, u]));
  const localReviewIds = new Set(input.local.reviews.map((r) => r.id));
  const localAskIds = new Set(input.local.asks.map((a) => a.id));
  const localTeachBackIds = new Set(input.local.teachBacks.map((t) => t.id));

  const toPush: SyncPayload = {
    decks: input.local.decks.filter((d) => deckStamp(d) > cutoff),
    units: input.local.units.filter((u) => unitStamp(u) > cutoff),
    reviews: input.local.reviews.filter((r) => r.reviewedAt > cutoff),
    asks: input.local.asks.filter((a) => a.askedAt > cutoff),
    teachBacks: input.local.teachBacks.filter((t) => t.attemptedAt > cutoff),
  };

  const toWrite: SyncPayload = {
    decks: input.remote.decks.filter((remote) => {
      const mine = localDecks.get(remote.id);
      return !mine || deckStamp(remote) > deckStamp(mine);
    }),
    units: input.remote.units.filter((remote) => {
      const mine = localUnits.get(remote.id);
      return !mine || unitStamp(remote) > unitStamp(mine);
    }),
    reviews: input.remote.reviews.filter((r) => !localReviewIds.has(r.id)),
    asks: input.remote.asks.filter((a) => !localAskIds.has(a.id)),
    teachBacks: input.remote.teachBacks.filter((t) => !localTeachBackIds.has(t.id)),
  };

  return {
    toPush,
    toWrite,
    // Only decks the student still holds locally: a tombstone for something this
    // device never had is nothing to clean up.
    deckTombstones: toWrite.decks
      .filter((d) => d.deletedAt !== undefined && d.deletedAt !== null && localDecks.has(d.id))
      .map((d) => d.id),
  };
}

function deckStamp(deck: Deck): number {
  return Math.max(deck.createdAt, deck.updatedAt ?? 0, deck.deletedAt ?? 0);
}

function unitStamp(unit: KnowledgeUnit): number {
  return Math.max(unit.createdAt, unit.updatedAt ?? 0);
}


