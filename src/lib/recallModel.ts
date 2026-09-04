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
/** What a unit's `importance` is worth before the student has said anything.
 *
 * 0.5 rather than 0: the midpoint is "no signal either way", and `desiredRetentionFor`
 * reads it as a 0.905 retention target. Zero is a real statement - "actively
 * deprioritise this" - and no control in the app makes it, which is why unstarring
 * returns here rather than to the floor. */
export const IMPORTANCE_DEFAULT = 0.5;

/** A starred concept. The top of the range, giving a 0.95 retention target against
 * 0.905 - roughly a third less forgetting allowed before it comes back round. */
export const IMPORTANCE_STARRED = 1;

export type KnowledgeUnit = {
  id: string;
  userId: string;
  sourceDeckId: string;
  label: string;
  /** 0-1, and the one number the scheduler takes from the student rather than from
   * their answers - `desiredRetentionFor` turns it into a retention target, so a
   * higher value is scheduled to be forgotten less and therefore reviewed sooner.
   *
   * IMPORTANCE_DEFAULT until the student stars the concept, which is currently the
   * only thing that writes it (see setUnitImportance). Automatic evidence - source
   * dwell, highlights, syllabus match - is a later phase; inventing it before it is
   * measured would be a fabricated signal. */
  importance: number;
  concept: Concept;
  createdAt: number;
  /** Last local change, for sync's last-write-wins. Optional: units written
   * before sync existed have none and fall back to createdAt. Nothing edits a
   * unit today - importDeck rewrites it wholesale from the deck - so this exists
   * for the card editor that will. */
  updatedAt?: number;
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
    importance: IMPORTANCE_DEFAULT,
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

/** The one pass, over whichever units the caller cares about.
 *
 * Deck-scoped and account-wide views differ by a single predicate, so they share
 * this rather than each keeping their own copy of the grouping - a second copy is
 * how the two would drift into disagreeing about what `resting` means. */
export function masteryOver(
  allUnits: readonly KnowledgeUnit[],
  memories: readonly MemoryRecord[],
  reviews: readonly ReviewRecord[],
  include: (unit: KnowledgeUnit) => boolean,
): DeckMastery {
  const units = new Map(allUnits.filter(include).map((u) => [u.id, u]));
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

// ── Due selection ────────────────────────────────────────────────────────────

/** Current recall probability for one memory. The scheduler's view of "how much
 * is at risk here right now". */
export function currentRetrievability(memory: MemoryRecord, now = Date.now()): number {
  return retrievabilityAt(memory, now);
}

/** Local midnight of the day a timestamp falls in.
 *
 * Plain local getters, deliberately, unlike localDay.ts's offset-shifted versions:
 * that module exists because a SERVER cannot know the student's timezone, and this
 * one only ever runs on their own device, where the local getters are already right.
 * An exam date is a calendar day rather than an instant - "the 14th" means their
 * 14th, and storing 00:00 UTC would put it on the 13th for half the world. */
export function localMidnight(at: number | Date): number {
  const d = new Date(at);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Whole days from today to the exam, or `null` when there is no exam.
 *
 * Both ends are local midnights, so the difference is exact whole days with no
 * partial-day drift. Zero means the exam is TODAY and is inside the band that
 * raises the retention floor; a negative number means the paper is behind them and
 * falls outside it, which is why this returns a signed number rather than clamping
 * at zero - see desiredRetentionFor. */
export function daysUntilExam(examDate: number | undefined, now = Date.now()): number | null {
  if (examDate === undefined) return null;
  return Math.round((localMidnight(examDate) - localMidnight(now)) / MS_PER_DAY);
}

/** The soonest exam date across every deck, or `null` if none has one.
 *
 * Deliberately clock-free, and that is not a stylistic choice: a React component
 * must not read the clock while rendering, so "which exam" is resolved purely here
 * and "is it still ahead" is decided by `daysUntilExam` wherever the clock is
 * actually allowed - inside an effect.
 *
 * Soonest rather than furthest because a paper next week is what a student is worried
 * about; anchoring a projection to a term-end exam would flatter every number in
 * between. */
export function soonestExamDate(decks: readonly Deck[]): number | null {
  let soonest: number | null = null;
  for (const deck of decks) {
    if (deck.examDate === undefined) continue;
    soonest = soonest === null ? deck.examDate : Math.min(soonest, deck.examDate);
  }
  return soonest;
}

/** Recall probability for one memory at an arbitrary instant, past or future.
 *
 * `currentRetrievability` above is this with `atMs` pinned to now. It exists
 * separately so a projection does not have to reach into fsrs.ts and convert
 * milliseconds into elapsed days itself - the unit conversion is exactly the sort
 * of thing that is wrong once and then wrong everywhere. */
export function retrievabilityAt(memory: MemoryRecord, atMs: number): number {
  const state: MemoryState = { stability: memory.stability, difficulty: memory.difficulty };
  return retrievability(state, (atMs - memory.lastReviewedAt) / MS_PER_DAY, undefined);
}

/** How many concepts the student will still recall on a given day, if they do
 * nothing between now and then.
 *
 * The number no other flashcard app can print. Anki knows when a card is next
 * DUE, which carries no probability at all, so there is nothing there to project;
 * FSRS state is a decay curve per concept, and a decay curve can be evaluated at
 * any future date. Every input already exists on the device.
 *
 * Three judgements, none of them arithmetic, all of them chosen to make the number
 * harder on the student rather than kinder:
 *
 * 1. **A unit's probability is the MEAN across its formats**, not the best of
 *    them. Memory is tracked per (unit x path), so a concept has several rows.
 *    Taking the max would assume the exam always probes the format the student is
 *    strongest at - which is the flattery this number exists to avoid. The mean is
 *    the expected value when they do not get to choose how they are asked.
 * 2. **A unit with no memory rows contributes 0 and still counts in `total`.**
 *    Never-opened concepts belong in the denominator; dropping them would let the
 *    number climb by ignoring work rather than by doing it.
 * 3. **`expected` is a sum of probabilities**, so it is an expected count and not
 *    a count of certainties - 0.9 + 0.9 is 1.8 concepts, not 2. Rounding is a
 *    presentation decision and stays with the caller.
 *
 * Honest about what it is not: a projection assuming no further study, so the real
 * number on the day is higher for anyone who keeps going. That is the point of
 * showing it. */
export function projectedRecall(
  units: readonly KnowledgeUnit[],
  memories: readonly MemoryRecord[],
  atMs: number,
): { expected: number; total: number } {
  const byUnit = new Map<string, MemoryRecord[]>();
  for (const memory of memories) {
    const list = byUnit.get(memory.unitId);
    if (list) list.push(memory);
    else byUnit.set(memory.unitId, [memory]);
  }

  let expected = 0;
  for (const unit of units) {
    const rows = byUnit.get(unit.id);
    if (!rows || rows.length === 0) continue;
    const sum = rows.reduce((total, row) => total + retrievabilityAt(row, atMs), 0);
    expected += sum / rows.length;
  }

  return { expected, total: units.length };
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
