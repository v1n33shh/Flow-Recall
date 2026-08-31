import type { ChallengeLevel, QueueItem } from "./types";
import {
  currentRetrievability,
  isProductionPath,
  masteryFor,
  pathsFor,
  type KnowledgeUnit,
  type MemoryRecord,
  type RetrievalPath,
  type ReviewRecord,
} from "./recallModel";
import { levelForPath } from "./studyQueue";

// Builds the session the app actually asks a student to do tonight.
//
// Until this existed the scheduler was write-only: it recorded every answer,
// computed exactly what was slipping, and then had no say in what the student was
// shown - the feed built its queue from the whole deck in random order, the same
// as before any of it existed. This is the piece that lets the app answer "what
// should I study?" on the student's behalf, which is the question a deck list
// silently hands back to them.
//
// Pure over records, so all of it is testable in vitest's node environment. The
// IndexedDB reads live in recallStorage.

/** Two consecutive reviews closer together than this were the same sitting, so
 * the gap between them is real time-on-card - including reading the debrief,
 * which no timer measures. Further apart and it is a gap between sessions, which
 * says nothing about how long a card takes. */
const SAME_SITTING_MS = 5 * 60 * 1000;

/** Below this many measured gaps for a format, use the fallback instead. Same
 * cold-start posture as fastAnswerThreshold: a median over two samples is not a
 * median, and being wrong about the budget is more visible than being generic. */
const MIN_TIMING_SAMPLES = 5;

/** Unfitted, and marked as such like the coupling constants. Per format because
 * typing an answer is plainly slower than judging a claim. The review log already
 * carries what is needed to replace these with a real per-student measurement -
 * see estimatePerCardMs, which does exactly that as soon as there is enough
 * history to trust. */
const FALLBACK_COST_MS: Record<RetrievalPath, number> = {
  swipe: 15_000,
  mcq: 18_000,
  cloze: 30_000,
  reverse: 30_000,
  explain: 60_000,
};

/** How far below its own target a card has to fall before it counts as nearly
 * gone rather than merely due.
 *
 * Expressed as a shortfall, not as a raw recall probability. A raw threshold read
 * more naturally - "urgent means recall under 50%" - and measured as almost
 * unreachable: FSRS-6's forgetting curve is far flatter than intuition suggests,
 * and a memory with stability 1 left for sixty days still returns 0.53. Getting
 * under 0.5 needs roughly eighty times the stability in elapsed days, so nothing
 * with any real stability would ever have qualified. Against the card's own target
 * the number means something at every stability. */
const URGENT_SHORTFALL = 0.2;

/** How long this student actually spends on one card of this format.
 *
 * Measured, not guessed, from data already in the review log: the gap between two
 * consecutive reviews in the same sitting IS the time the second one took,
 * including reading the answer and the explanation. Nothing new had to be
 * instrumented to get it.
 *
 * The median rather than the mean, because one interrupted card - a student who
 * put the phone down mid-session - would otherwise drag the estimate far enough to
 * make a 20-minute budget hold four cards. */
export function estimatePerCardMs(
  reviews: readonly ReviewRecord[],
  path: RetrievalPath,
  now = Date.now(),
): number {
  void now;
  const ordered = reviews.slice().sort((a, b) => a.reviewedAt - b.reviewedAt);
  const gaps: number[] = [];
  for (let i = 1; i < ordered.length; i++) {
    const gap = ordered[i].reviewedAt - ordered[i - 1].reviewedAt;
    // Attributed to the LATER review, whose format is the one being timed.
    if (gap > 0 && gap < SAME_SITTING_MS && ordered[i].path === path) gaps.push(gap);
  }
  if (gaps.length < MIN_TIMING_SAMPLES) return FALLBACK_COST_MS[path];
  gaps.sort((a, b) => a - b);
  const mid = Math.floor(gaps.length / 2);
  return gaps.length % 2 === 0 ? Math.round((gaps[mid - 1] + gaps[mid]) / 2) : gaps[mid];
}

/** One way of asking one concept, with everything needed to rank it. */
export type SessionCandidate = {
  unit: KnowledgeUnit;
  path: RetrievalPath;
  level: ChallengeLevel;
  /** How far below this unit's own retention target it has fallen. Negative means
   * it is still comfortably inside target - see the resting note in buildSession. */
  shortfall: number;
  retrievability: number;
  costMs: number;
  /** Never answered on this format. Ranked after everything that is slipping,
   * because losing something known is worse than not yet knowing something. */
  isFresh: boolean;
};

export type SessionPlan = {
  items: QueueItem[];
  estimatedMinutes: number;
  /** Selected cards whose recall has fallen below their own target. */
  slipping: number;
  /** Of those, the ones already close to gone. */
  urgent: number;
  /** Selected cards never answered on that format. */
  fresh: number;
  /** Concepts held solidly with nothing due - deliberately NOT asked tonight. */
  resting: number;
  /** How many distinct decks the session draws from. */
  deckCount: number;
  /** Candidates that fitted the criteria but not the budget. */
  deferred: number;
};

/** Ranks every way of asking every unit, fills a time budget with the best of
 * them, and reports what it left alone.
 *
 * Value is the shortfall against each unit's OWN retention target rather than raw
 * recall probability, which is what lets a high-yield concept at 0.90 outrank a
 * background detail at 0.88 - see the dueFirst docblock. Cost is real measured
 * time per format. Ranking on value-per-second rather than value alone is what
 * stops five slow cloze cards eating a 10-minute session that could have covered
 * twelve.
 *
 * Worst first, deliberately. A student who abandons the session halfway has then
 * done the half that mattered; the alternative orderings all trade that away for
 * a gentler start.
 *
 * One card per concept per session. Asking the same idea twice in one sitting is
 * how a 20-minute budget turns into six concepts, and the paths rotate on their
 * own across sessions because answering the weakest one makes another the weakest
 * next time. */
export function buildSession(input: {
  units: readonly KnowledgeUnit[];
  memories: readonly MemoryRecord[];
  reviews: readonly ReviewRecord[];
  budgetMinutes: number;
  now?: number;
}): SessionPlan {
  const now = input.now ?? Date.now();
  const budgetMs = Math.max(0, input.budgetMinutes) * 60_000;

  const memoriesByUnit = groupBy(input.memories, (m) => m.unitId);
  const reviewsByUnit = groupBy(input.reviews, (r) => r.unitId);
  const costByPath = new Map<RetrievalPath, number>();
  const costFor = (path: RetrievalPath) => {
    const cached = costByPath.get(path);
    if (cached !== undefined) return cached;
    const cost = estimatePerCardMs(input.reviews, path, now);
    costByPath.set(path, cost);
    return cost;
  };

  const candidates: SessionCandidate[] = [];
  let resting = 0;

  for (const unit of input.units) {
    const unitMemories = memoriesByUnit.get(unit.id) ?? [];
    const unitReviews = reviewsByUnit.get(unit.id) ?? [];
    const evidence = masteryFor(unitReviews, unitMemories, now);

    // Best candidate for this unit: the format that has decayed furthest below its
    // own target, among the formats this card's fields actually support AND the
    // feed can actually draw.
    let best: SessionCandidate | null = null;
    for (const path of pathsFor(unit.concept)) {
      const level = levelForPath(path);
      if (level === null) continue;
      const memory = unitMemories.find((m) => m.path === path);
      const retrievability = memory ? currentRetrievability(memory, now) : 0;
      const target = memory?.desiredRetention ?? 0.9;
      const candidate: SessionCandidate = {
        unit,
        path,
        level,
        shortfall: target - retrievability,
        retrievability,
        costMs: costFor(path),
        isFresh: !memory,
      };
      if (!best || rank(candidate) > rank(best)) best = candidate;
    }
    if (!best) continue;

    // Solid and nothing slipping: the engine's answer to "don't study this
    // tonight", and the one thing no other flashcard app will tell anyone.
    if (evidence.level === "solid" && !best.isFresh && best.shortfall <= 0) {
      resting += 1;
      continue;
    }
    candidates.push(best);
  }

  candidates.sort((a, b) => rank(b) - rank(a));

  const items: QueueItem[] = [];
  let spentMs = 0;
  let deferred = 0;
  let slipping = 0;
  let urgent = 0;
  let fresh = 0;
  const decks = new Set<string>();

  for (const candidate of candidates) {
    if (spentMs + candidate.costMs > budgetMs && items.length > 0) {
      deferred += 1;
      continue;
    }
    spentMs += candidate.costMs;
    decks.add(candidate.unit.sourceDeckId);
    if (candidate.isFresh) fresh += 1;
    else if (candidate.shortfall > 0) {
      slipping += 1;
      if (candidate.shortfall >= URGENT_SHORTFALL) urgent += 1;
    }
    items.push({
      key: `${candidate.unit.id}::${candidate.level}::1`,
      concept: candidate.unit.concept,
      level: candidate.level,
      lane: candidate.level,
      attempt: 1,
      unitId: candidate.unit.id,
    });
  }

  return {
    items,
    estimatedMinutes: Math.round(spentMs / 60_000),
    slipping,
    urgent,
    fresh,
    resting,
    deckCount: decks.size,
    deferred,
  };
}

/** Value per second. A production format breaks a tie, since it is the stronger
 * evidence and the one mastery cannot be reached without. */
function rank(candidate: SessionCandidate): number {
  const value = candidate.isFresh ? 0.05 : Math.max(candidate.shortfall, 0.0001);
  const bonus = isProductionPath(candidate.path) ? 1.05 : 1;
  return (value * bonus) / (candidate.costMs / 1000);
}

function groupBy<T>(rows: readonly T[], key: (row: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const row of rows) {
    const k = key(row);
    const list = out.get(k);
    if (list) list.push(row);
    else out.set(k, [row]);
  }
  return out;
}
