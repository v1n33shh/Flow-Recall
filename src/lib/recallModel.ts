import type { Concept, Deck } from "./types";
import {
  AGAIN,
  EASY,
  GOOD,
  type Grade,
  type MemoryState,
  retrievability,
} from "./fsrs";

// The shapes the recall engine reasons about, and every derivation that is pure
// arithmetic over them. Deliberately separate from recallStorage.ts: everything
// here is testable in vitest's node environment, with no IndexedDB and no
// window, which is where the interesting logic should live.

/** How a concept is being asked, right now.
 *
 * A concept is one thing to know; these are the different ways of making a
 * student retrieve it. Scheduling state is kept per (unit x path), not per
 * unit - answering a cloze correctly is not the same evidence as recognising a
 * claim as true - but the paths are coupled so a concept does not cost N times
 * as much as a card (see coupleSibling in fsrs.ts).
 *
 * Only `swipe` and `cloze` are generated today; the rest are declared now so
 * adding them later needs no migration, since the store is already keyed by
 * this value. */
export type RetrievalPath = "swipe" | "mcq" | "cloze" | "reverse" | "explain";

/** Paths where the answer is on screen and the student picks. Getting one right
 * is weaker evidence than producing the answer, and - crucially - can be got
 * right by luck, which is what makes the guess check below necessary. */
const RECOGNITION_PATHS: ReadonlySet<RetrievalPath> = new Set<RetrievalPath>(["swipe", "mcq"]);

export function isRecognitionPath(path: RetrievalPath): boolean {
  return RECOGNITION_PATHS.has(path);
}

/** Paths where the student has to produce the answer from memory with nothing
 * on screen to recognise. Mastery requires at least one of these - passing a
 * recognition format repeatedly is exactly the illusion of knowledge. */
export function isProductionPath(path: RetrievalPath): boolean {
  return !RECOGNITION_PATHS.has(path);
}

/** What the student says about a failed recognition answer.
 *
 * Only ever asked after a failure, and only on a recognition path, because that
 * is the only place the answer is ambiguous: missing a two-option swipe is either
 * a coin-flip that landed badly or a confidently held wrong belief, and those are
 * completely different facts about a student's memory. A production failure needs
 * no question - not being able to type the answer means one thing.
 *
 * `knew-it` is the observable form of a misconception: the student was sure, and
 * they were wrong. It blocks `solid` until they get that format right again (see
 * masteryFor).
 *
 * Self-serving bias runs toward over-claiming knowledge here, and that is the
 * safe direction for it to run: over-claiming makes the mastery bar STRICTER for
 * that unit, never looser. */
export type Confidence = "guessed" | "knew-it";

/** One thing worth knowing. Derived from the `Concept` the ingest route already
 * generates, rather than replacing it: the study feed keeps consuming Concepts
 * unchanged while the engine tracks units underneath. `sourceDeckId` is the
 * provenance available today - a real span reference into the source document
 * replaces it once generation carries one. */
export type KnowledgeUnit = {
  id: string;
  userId: string;
  sourceDeckId: string;
  label: string;
  /** 0-1. Uniform for now: nothing measures it yet, so pretending otherwise
   * would be a fabricated signal. Wired to real evidence (source dwell,
   * highlights, syllabus match) in a later phase. */
  importance: number;
  concept: Concept;
  createdAt: number;
};

/** FSRS state for one (unit x path), plus the bookkeeping the scheduler needs.
 * Derived data - it can always be rebuilt by replaying this user's reviews,
 * which is what turns a scheduler bug into a recomputation rather than a
 * data-loss incident. */
export type MemoryRecord = {
  /** `${userId}::${unitId}::${path}` - see memoryKey. */
  key: string;
  userId: string;
  unitId: string;
  path: RetrievalPath;
  stability: number;
  difficulty: number;
  lastReviewedAt: number;
  dueAt: number;
  reps: number;
  lapses: number;
  desiredRetention: number;
};

/** One retrieval, as it happened. Append-only: never updated, never deleted.
 * This is the asset - `MemoryRecord` above is a cache over it. */
export type ReviewRecord = {
  id: string;
  userId: string;
  unitId: string;
  path: RetrievalPath;
  reviewedAt: number;
  grade: Grade;
  correct: boolean;
  /** Time from the probe appearing to the answer being submitted. Free to
   * capture and the best proxy for retrieval strength short of asking. */
  latencyMs: number;
  /** False when the answer was correct but not trusted - see gradeFor. The
   * review is still recorded; it just does not move the memory. */
  credited: boolean;
  elapsedDays: number;
  stabilityBefore: number | null;
  stabilityAfter: number;
  /** The student's own report on a failed recognition answer. Absent on every
   * success, on every production path, and on any failure the student scrolled
   * away from before answering the question - so consumers must treat "missing"
   * as "not asked", never as "guessed". */
  confidence?: Confidence;
  /** The coupling constants in force when this was written, so they can be
   * refitted later against real data instead of being argued about. */
  couplingOnSuccess: number;
  couplingOnLapse: number;
};

export function memoryKey(userId: string, unitId: string, path: RetrievalPath): string {
  return `${userId}::${unitId}::${path}`;
}

export function unitIdFor(deckId: string, conceptId: string): string {
  return `${deckId}::${conceptId}`;
}

/** Turns a saved deck into knowledge units. Idempotent by construction: the
 * unit id is derived from the deck and concept ids rather than generated, so
 * re-running the migration (or re-importing the same deck) updates units in
 * place instead of duplicating them. */
export function unitsFromDeck(deck: Deck, userId: string, now = Date.now()): KnowledgeUnit[] {
  return deck.concepts.map((concept) => ({
    id: unitIdFor(deck.id, concept.id),
    userId,
    sourceDeckId: deck.id,
    label: concept.concept,
    importance: 0.5,
    concept,
    createdAt: now,
  }));
}

/** Which ways this concept can actually be asked, given the fields the
 * generator produced. A malformed cloze (no `_____`) is common enough in model
 * output that the schema alone cannot be trusted - ClozeChallenge already
 * degrades gracefully at render time, and this makes the same judgement at
 * scheduling time so the engine never schedules a format the card cannot
 * support. */
export function pathsFor(concept: Concept): RetrievalPath[] {
  const paths: RetrievalPath[] = [];
  if (concept.answer && concept.distractor) paths.push("swipe");
  if (concept.cloze.includes("_____") && concept.answer) paths.push("cloze");
  return paths;
}

// ── Grading ──────────────────────────────────────────────────────────────────

export type GradedOutcome = {
  grade: Grade;
  /** Whether this answer should move the memory model at all. A correct answer
   * that is not credited is still recorded - the review log keeps everything,
   * the memory model ignores evidence it cannot trust. */
  credit: boolean;
  /** Why, when `credit` is false. Printed by "why am I seeing this?" and
   * counted as a health metric. */
  reason?: "suspect-guess" | "not-answered";
};

/** How fast is too fast to believe.
 *
 * A two-option swipe can be got right by luck half the time, so a correct
 * answer that arrived faster than this student has ever plausibly read the card
 * is not evidence of recall. Rather than a fixed millisecond threshold - which
 * would punish fast readers and let slow guessers through - this is a
 * percentile of the student's own history on that same path.
 *
 * Returns null with too little history to judge, in which case everything is
 * credited. Erring toward crediting is right at cold start: wrongly withholding
 * credit from a student's first few answers is far more visible to them than
 * letting a couple of lucky guesses through. */
export function fastAnswerThreshold(latenciesMs: number[], percentile = 0.1): number | null {
  const usable = latenciesMs.filter((ms) => Number.isFinite(ms) && ms > 0).sort((a, b) => a - b);
  if (usable.length < 10) return null;
  const index = Math.max(0, Math.floor(usable.length * percentile) - 1);
  return usable[index];
}

/** Maps the study feed's existing three-way outcome onto an FSRS grade.
 *
 * `skipped` reaches here when a card scrolled out of view unanswered. It grades
 * AGAIN, so the feed requeues it exactly as it does today - but it is NOT
 * credited, because scrolling past a card is evidence of nothing. Letting a
 * non-answer decay a memory would fill the model with noise generated by
 * thumb movement.
 *
 * There is no Hard button yet, so nothing returns HARD - the mapping is
 * deliberately conservative until the feed offers a fourth choice, because
 * inventing a Hard from latency alone would put a guess into the training data
 * that later refits would treat as ground truth. */
export function gradeFor(
  outcome: "correct" | "incorrect" | "skipped",
  latencyMs: number,
  options: { path: RetrievalPath; fastThresholdMs: number | null },
): GradedOutcome {
  if (outcome === "skipped") return { grade: AGAIN, credit: false, reason: "not-answered" };
  if (outcome === "incorrect") return { grade: AGAIN, credit: true };

  if (
    isRecognitionPath(options.path) &&
    options.fastThresholdMs !== null &&
    latencyMs > 0 &&
    latencyMs < options.fastThresholdMs
  ) {
    return { grade: GOOD, credit: false, reason: "suspect-guess" };
  }

  // Fluent production - answered from memory, fast, with nothing on screen to
  // recognise - is the one case that genuinely earns Easy.
  if (
    isProductionPath(options.path) &&
    options.fastThresholdMs !== null &&
    latencyMs > 0 &&
    latencyMs < options.fastThresholdMs
  ) {
    return { grade: EASY, credit: true };
  }

  return { grade: GOOD, credit: true };
}

// ── Mastery ──────────────────────────────────────────────────────────────────

/** What the student is actually told, and the honest replacement for the single
 * "mastered" flag the feed sets today on one correct answer.
 *
 * `familiar` is what the current code calls mastered. Naming it separately is
 * most of the point: the label was doing the misleading, not the threshold. */
export type MasteryLevel = "met" | "familiar" | "holding" | "solid" | "fading";

/** A success this long after the previous one is the only real evidence of
 * durability. Familiarity survives a day; it does not survive a fortnight. */
const DELAYED_SUCCESS_DAYS = 7;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type MasteryEvidence = {
  level: MasteryLevel;
  successes: number;
  pathsPassed: RetrievalPath[];
  hasDelayedSuccess: boolean;
  hasProductionSuccess: boolean;
  /** A `knew-it` failure with no credited success on that same format since.
   * Blocks `solid` while it stands. */
  hasActiveConfidentFailure: boolean;
};

/** Evaluates a unit against the evidence bar, from its credited reviews alone.
 *
 * `solid` requires all four of: three successes across two different formats, one
 * success after a 7-day gap, one success on a production path, and no active
 * high-confidence failure.
 *
 * That fourth condition was one of two the original design named and this code
 * could not evaluate, because nothing recorded confidence. It does now (see
 * Confidence), and it is deliberately "active" rather than time-boxed: a student
 * who was sure and wrong has a misconception until they get that same format
 * right again, which is a fact about their memory rather than about the calendar.
 * The one still unevaluated condition - no active misconception recorded
 * independently of the student's own report - can only tighten this bar further;
 * it can never loosen it, so a unit called `solid` now stays at least `solid`.
 *
 * `fading` outranks the rest deliberately: a concept that was solid and is now
 * slipping is the single most useful thing to surface, and it is invisible if
 * mastery is treated as a one-way ratchet. */
export function masteryFor(
  reviews: readonly ReviewRecord[],
  memories: readonly MemoryRecord[],
  now = Date.now(),
): MasteryEvidence {
  const credited = reviews
    .filter((r) => r.credited)
    .slice()
    .sort((a, b) => a.reviewedAt - b.reviewedAt);
  const successes = credited.filter((r) => r.grade !== AGAIN);

  const pathsPassed = [...new Set(successes.map((r) => r.path))];
  const hasProductionSuccess = successes.some((r) => isProductionPath(r.path));

  // Gap measured against the previous credited review of the SAME path - a
  // fortnight-old cloze is delayed evidence; a fortnight-old cloze that was
  // warmed up by a swipe an hour earlier is not.
  const lastSeenByPath = new Map<RetrievalPath, number>();
  // Per format: does a `knew-it` failure stand un-answered? Set by a confident
  // failure, cleared only by a later credited success on that same format - a
  // `guessed` failure in between leaves it exactly as it was, because guessing
  // wrong again is no evidence the belief was fixed.
  const confidentFailureByPath = new Map<RetrievalPath, boolean>();
  let hasDelayedSuccess = false;
  for (const review of credited) {
    const previous = lastSeenByPath.get(review.path);
    if (
      review.grade !== AGAIN &&
      previous !== undefined &&
      review.reviewedAt - previous >= DELAYED_SUCCESS_DAYS * MS_PER_DAY
    ) {
      hasDelayedSuccess = true;
    }
    if (review.grade === AGAIN) {
      if (review.confidence === "knew-it") confidentFailureByPath.set(review.path, true);
    } else {
      confidentFailureByPath.set(review.path, false);
    }
    lastSeenByPath.set(review.path, review.reviewedAt);
  }
  const hasActiveConfidentFailure = [...confidentFailureByPath.values()].some(Boolean);

  const evidence = {
    successes: successes.length,
    pathsPassed,
    hasDelayedSuccess,
    hasProductionSuccess,
    hasActiveConfidentFailure,
  };

  const isSolid =
    successes.length >= 3 &&
    pathsPassed.length >= 2 &&
    hasDelayedSuccess &&
    hasProductionSuccess &&
    !hasActiveConfidentFailure;

  if (isSolid) {
    // Solid but slipping. Checked against every path's own target so a concept
    // is only "fading" when some way of asking it has genuinely decayed.
    const slipping = memories.some(
      (m) =>
        retrievability(
          { stability: m.stability, difficulty: m.difficulty },
          (now - m.lastReviewedAt) / MS_PER_DAY,
        ) < m.desiredRetention,
    );
    return { ...evidence, level: slipping ? "fading" : "solid" };
  }

  if (successes.length === 0) return { ...evidence, level: "met" };
  if (pathsPassed.length >= 2) return { ...evidence, level: "holding" };
  return { ...evidence, level: "familiar" };
}

// ── Due selection ────────────────────────────────────────────────────────────

/** Current recall probability for one memory. The scheduler's view of "how much
 * is at risk here right now". */
export function currentRetrievability(memory: MemoryRecord, now = Date.now()): number {
  const state: MemoryState = { stability: memory.stability, difficulty: memory.difficulty };
  return retrievability(state, (now - memory.lastReviewedAt) / MS_PER_DAY, undefined);
}

/** Sorted worst-first: whatever is furthest below its own retention target
 * comes back first.
 *
 * Ranking on the SHORTFALL rather than on raw retrievability is what stops
 * low-importance material from crowding out high-yield material - a background
 * detail at 0.88 against a 0.86 target is fine, while an exam-critical concept
 * at 0.90 against a 0.95 target is not, even though 0.90 looks healthier.
 *
 * This is the whole scheduler's output for now. The value/cost session builder
 * that fills a time budget sits on top of this, and is the next piece. */
export function dueFirst(memories: readonly MemoryRecord[], now = Date.now()): MemoryRecord[] {
  return memories
    .map((memory) => ({ memory, shortfall: memory.desiredRetention - currentRetrievability(memory, now) }))
    .sort((a, b) => b.shortfall - a.shortfall)
    .map((entry) => entry.memory);
}

/** Whether this memory has decayed to the point where reviewing it is worth the
 * student's time. Note it is a comparison against the memory's own target, not
 * a wall-clock due date - which is what lets the engine answer "don't study
 * this tonight" for something Anki would have shown. */
export function isDue(memory: MemoryRecord, now = Date.now()): boolean {
  return currentRetrievability(memory, now) < memory.desiredRetention;
}
