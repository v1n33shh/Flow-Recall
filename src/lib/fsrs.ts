// FSRS-6, ported rather than invented.
//
// This is the "retention layer": given how a retrieval went, when is this at
// risk of being forgotten? It is deliberately boring, deliberately verbatim,
// and deliberately free of any product opinion - every judgement about WHAT to
// show a student lives above this file, not in it.
//
// Sources cross-checked before writing (two, because a scheduler that is
// subtly wrong is invisible until months of review history are already built
// on top of it):
//   https://github.com/open-spaced-repetition/awesome-fsrs/wiki/The-Algorithm
//   https://expertium.github.io/Algorithm.html
//
// Everything here is pure arithmetic on numbers - no window, no IndexedDB, no
// network. That is what lets it run inside the Capacitor shell, which has no
// server behind it at all (see src/lib/apiUrl.ts), and stay fully functional
// offline. It is also why every function below is directly unit-testable in
// vitest's node environment.

/** Anki's four buttons. `Again` is the only failing grade - `Hard` is a PASS
 * that merely earns a smaller stability increase (w15 below), which is why it
 * must never be treated as a lapse. */
export const AGAIN = 1;
export const HARD = 2;
export const GOOD = 3;
export const EASY = 4;

export type Grade = typeof AGAIN | typeof HARD | typeof GOOD | typeof EASY;

/** The two numbers that describe a memory. `stability` is the interval, in
 * days, at which recall probability has decayed to exactly 90%; `difficulty`
 * is 1-10 and scales how much each successful retrieval buys. */
export type MemoryState = {
  stability: number;
  difficulty: number;
};

/** FSRS-6's 21 optimizable weights, at their published defaults. These are
 * the population-level fit - a per-student refit needs a real review history
 * to train against, which is exactly what recallStorage.ts starts collecting.
 * Until then everyone gets these, which is the correct cold-start behaviour.
 *
 *   w0-w3   initial stability, one per grade
 *   w4,w5   initial difficulty
 *   w6,w7   difficulty update, then mean reversion toward D0(Easy)
 *   w8-w10  stability gain on a successful recall
 *   w11-w14 stability after a lapse
 *   w15     Hard penalty, in (0,1)
 *   w16     Easy bonus, in (1,6)
 *   w17-w19 same-day ("short-term") stability
 *   w20     forgetting-curve decay, in [0.1,0.8]
 */
export const DEFAULT_PARAMS: readonly number[] = [
  0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722, 0.1666,
  0.796, 1.4835, 0.0614, 0.2629, 1.6483, 0.6014, 1.8729, 0.5425, 0.0912, 0.0658,
  0.1542,
];

// Anki's own bounds. The stability floor matters more than it looks: a lapse on
// an already-tiny stability can otherwise produce a value that rounds to a
// zero-day interval and schedules the same item forever.
const MIN_STABILITY = 0.001;
const MAX_STABILITY = 36500;
const MIN_DIFFICULTY = 1;
const MAX_DIFFICULTY = 10;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** `factor` exists solely so that R(S, S) = 0.90 holds for any decay - i.e. so
 * "stability" keeps its definition as the 90%-recall interval no matter what
 * w20 is fitted to. Derived rather than hard-coded, because earlier FSRS
 * versions pinned decay (v4: -1, v4.5/5: -0.5) and FSRS-6 makes it trainable. */
function curveFactor(params: readonly number[]): number {
  return Math.pow(0.9, -1 / params[20]) - 1;
}

/** Probability the student still recalls this, `elapsedDays` after the last
 * successful review. A power curve, not an exponential - the long tail is
 * flatter than intuition suggests, which is precisely why reviewing a
 * well-established item today buys almost nothing. */
export function retrievability(
  state: MemoryState,
  elapsedDays: number,
  params: readonly number[] = DEFAULT_PARAMS,
): number {
  if (elapsedDays <= 0) return 1;
  const t = elapsedDays / Math.max(state.stability, MIN_STABILITY);
  return Math.pow(1 + curveFactor(params) * t, -params[20]);
}

/** Days until recall probability falls to `desiredRetention`. At 0.9 this
 * returns exactly `stability`, by construction. Returned unrounded and
 * unfuzzed - rounding is a scheduling-policy decision and belongs to the
 * caller, and fuzz is deliberately absent (see nextDue in recallModel.ts). */
export function intervalFor(
  stability: number,
  desiredRetention: number,
  params: readonly number[] = DEFAULT_PARAMS,
): number {
  const r = clamp(desiredRetention, 0.5, 0.99);
  return (Math.max(stability, MIN_STABILITY) / curveFactor(params)) * (Math.pow(r, -1 / params[20]) - 1);
}

// ── Initial state, from the very first grade ──────────────────────────────────

function initialDifficulty(grade: Grade, params: readonly number[]): number {
  return clamp(params[4] - Math.exp(params[5] * (grade - 1)) + 1, MIN_DIFFICULTY, MAX_DIFFICULTY);
}

/** State after a concept's first-ever retrieval. Initial stability is looked up
 * per grade rather than computed: w0-w3 are fitted directly from measured
 * retention curves, so there is no formula to apply here. */
export function initialState(grade: Grade, params: readonly number[] = DEFAULT_PARAMS): MemoryState {
  return {
    stability: clamp(params[grade - 1], MIN_STABILITY, MAX_STABILITY),
    difficulty: initialDifficulty(grade, params),
  };
}

// ── Difficulty update ────────────────────────────────────────────────────────

/** Three stages, in order: a grade-proportional delta, linear damping, then
 * mean reversion.
 *
 * Damping (`(10 - D)/9`) is what makes difficulty approach 10 asymptotically
 * and never arrive - so a genuinely hard concept keeps earning some stability
 * from a success instead of flatlining. Mean reversion pulls toward D0(Easy),
 * so a long run of Good presses converges difficulty downward rather than
 * leaving it wherever the first bad day put it. At the default w7 = 0.001 that
 * pull is almost nil; it becomes meaningful only under a per-student refit. */
function nextDifficulty(difficulty: number, grade: Grade, params: readonly number[]): number {
  const delta = -params[6] * (grade - GOOD);
  const damped = difficulty + delta * ((MAX_DIFFICULTY - difficulty) / 9);
  const reverted = params[7] * initialDifficulty(EASY, params) + (1 - params[7]) * damped;
  return clamp(reverted, MIN_DIFFICULTY, MAX_DIFFICULTY);
}

// ── Stability update ─────────────────────────────────────────────────────────

/** Stability after a SUCCESSFUL retrieval (Hard, Good or Easy).
 *
 * The `(11 - D)` term makes hard concepts gain less, `S^-w9` saturates the gain
 * as stability grows, and `e^(w10·(1-R)) - 1` is the spacing effect itself: the
 * lower the recall probability at the moment of retrieval, the more that
 * retrieval is worth. That last term is the entire mathematical argument for
 * why cramming an item you already know well is close to worthless, and it is
 * what the selection layer above this file will price its choices against. */
function stabilityAfterRecall(
  state: MemoryState,
  retention: number,
  grade: Grade,
  params: readonly number[],
): number {
  const hardPenalty = grade === HARD ? params[15] : 1;
  const easyBonus = grade === EASY ? params[16] : 1;
  const increase =
    1 +
    Math.exp(params[8]) *
      (11 - state.difficulty) *
      Math.pow(state.stability, -params[9]) *
      (Math.exp(params[10] * (1 - retention)) - 1) *
      hardPenalty *
      easyBonus;
  // A success must never reduce stability. The formula can only violate this
  // through floating-point noise at extreme parameter values, but the invariant
  // is cheap to assert and expensive to debug later.
  return clamp(state.stability * Math.max(increase, 1), MIN_STABILITY, MAX_STABILITY);
}

/** Stability after a LAPSE (Again).
 *
 * Capped at the prior stability: forgetting something can never leave the
 * memory stronger than it was. Note this is not a reset to zero - FSRS keeps a
 * meaningful share of what was built, which is the formal reason a returning
 * student's old material is not worthless and does not need to be re-learned
 * from scratch. */
function stabilityAfterLapse(
  state: MemoryState,
  retention: number,
  params: readonly number[],
): number {
  const postLapse =
    params[11] *
    Math.pow(state.difficulty, -params[12]) *
    (Math.pow(state.stability + 1, params[13]) - 1) *
    Math.exp(params[14] * (1 - retention));
  return clamp(Math.min(postLapse, state.stability), MIN_STABILITY, MAX_STABILITY);
}

/** Stability after a SAME-DAY repeat.
 *
 * The published formula, and the wiki is candid that it is "a crude heuristic":
 * neither FSRS-5 nor -6 has a real short-term memory model. It matters here
 * anyway, because the current study feed requeues a failed card three slides
 * later (StudyFeed.tsx's RETRY_OFFSET) - so same-day repeats are the norm in
 * this app, not an edge case, and routing them through the long-term formula
 * would credit them with spacing they never earned. */
function stabilityShortTerm(
  state: MemoryState,
  grade: Grade,
  params: readonly number[],
): number {
  const increase =
    Math.exp(params[17] * (grade - GOOD + params[18])) * Math.pow(state.stability, -params[19]);
  const next = state.stability * increase;
  // Good and Easy must not lose ground on a same-day repeat.
  const floored = grade >= GOOD ? Math.max(next, state.stability) : next;
  return clamp(floored, MIN_STABILITY, MAX_STABILITY);
}

// ── The one entry point callers need ─────────────────────────────────────────

/** Advances a memory by one review.
 *
 * `elapsedDays` is real elapsed time, fractional, since this memory's last
 * review - not the interval it was scheduled for. Anything under a day routes
 * to the short-term formula, matching Anki's same-day rule; that threshold is
 * a deliberate simplification of "same calendar day", which would need the
 * student's timezone here and would make this function impure for no
 * measurable gain.
 *
 * Pass `null` for a memory that has never been reviewed. */
export function nextState(
  previous: MemoryState | null,
  grade: Grade,
  elapsedDays: number,
  params: readonly number[] = DEFAULT_PARAMS,
): MemoryState {
  if (previous === null) return initialState(grade, params);

  const difficulty = nextDifficulty(previous.difficulty, grade, params);

  if (elapsedDays < 1) {
    return { stability: stabilityShortTerm(previous, grade, params), difficulty };
  }

  const retention = retrievability(previous, elapsedDays, params);
  const stability =
    grade === AGAIN
      ? stabilityAfterLapse(previous, retention, params)
      : stabilityAfterRecall(previous, retention, grade, params);

  return { stability, difficulty };
}

// ── FlowRecall's one extension to FSRS ───────────────────────────────────────

/** How much of a stability change carries across to the SAME concept's other
 * retrieval formats.
 *
 * The reason this exists: FSRS schedules cards, and FlowRecall schedules
 * concepts that can be asked several ways. Answering a cloze correctly is
 * evidence about the underlying memory, not just about that one phrasing - so
 * tracking each format's stability in total isolation would multiply a
 * student's workload by the number of formats and call it depth. Coupling is
 * what makes "one Knowledge Unit, several retrieval paths" cheaper than "several
 * cards" rather than identical to it.
 *
 * Failures couple harder than successes, deliberately and asymmetrically:
 * forgetting generalises (if you cannot produce it, you probably cannot
 * recognise it reliably either) while a success on a recognition format is weak
 * evidence that you could have produced it. Erring toward under-crediting
 * successes and over-crediting failures means the system reviews slightly more
 * than strictly necessary, which is the safe direction for the error to point.
 *
 * BOTH CONSTANTS ARE UNFITTED GUESSES. There is no literature behind them -
 * FSRS has no concept of sibling formats to have measured. They are stored
 * alongside every review (see recallStorage.ts) precisely so they can be fitted
 * later against real data instead of defended forever on intuition. */
export const COUPLING_ON_SUCCESS = 0.35;
export const COUPLING_ON_LAPSE = 0.6;

/** Applies a sibling format's stability change to this one, damped.
 *
 * Difficulty is intentionally left alone: it is a property of the concept, and
 * the direct review of any of its formats already updated it. Applying the
 * damped delta to difficulty as well would double-count the same evidence.
 *
 * `coupling` overrides the two module constants, and exists for exactly one
 * caller: replaying the review log (see rebuildMemory in recallSync.ts). Every
 * review row stamps the constants that were in force when it was written, which
 * is what lets a replay reproduce history even after they are refitted - the
 * whole reason they are stamped. Live callers omit it and get today's values. */
export function coupleSibling(
  sibling: MemoryState,
  stabilityBefore: number,
  stabilityAfter: number,
  grade: Grade,
  coupling_?: { onSuccess: number; onLapse: number },
): MemoryState {
  const onLapse = coupling_?.onLapse ?? COUPLING_ON_LAPSE;
  const onSuccess = coupling_?.onSuccess ?? COUPLING_ON_SUCCESS;
  const coupling = grade === AGAIN ? onLapse : onSuccess;
  const delta = (stabilityAfter - stabilityBefore) * coupling;
  return {
    stability: clamp(sibling.stability + delta, MIN_STABILITY, MAX_STABILITY),
    difficulty: sibling.difficulty,
  };
}

/** Desired retention for one concept, derived rather than configured.
 *
 * Anki exposes this as a slider that almost nobody sets correctly, so instead
 * it falls out of two things the app already knows. `importance` (0-1) is what
 * makes high-yield material get reviewed harder and background detail allowed
 * to fade - which is the mechanism behind "you already know this, don't spend
 * tonight on it" rather than a separate feature. An exam inside three weeks
 * raises the floor, because there is no value in an interval that peaks after
 * the paper.
 *
 * The 0.86-0.95 band is bounded on both sides on purpose: below ~0.85 the
 * student fails too often for the session to feel survivable, and above ~0.95
 * review load climbs steeply for very little retained knowledge. */
export function desiredRetentionFor(importance: number, daysUntilExam: number | null): number {
  const base = 0.86 + 0.09 * clamp(importance, 0, 1);
  if (daysUntilExam !== null && daysUntilExam >= 0 && daysUntilExam <= 21) {
    return Math.max(base, 0.95);
  }
  return clamp(base, 0.86, 0.95);
}
