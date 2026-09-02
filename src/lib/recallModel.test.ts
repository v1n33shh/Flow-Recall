import { describe, expect, it } from "vitest";
import { AGAIN, EASY, GOOD, desiredRetentionFor, type Grade } from "./fsrs";
import {
  type MemoryRecord,
  type RetrievalPath,
  type ReviewRecord,
  currentRetrievability,
  daysUntilExam,
  dueFirst,
  fastAnswerThreshold,
  gradeFor,
  isDue,
  isProductionPath,
  isRecognitionPath,
  masteryFor,
  masteryOver,
  memoryKey,
  soonestExamDate,
  pathsFor,
  projectedRecall,
  retrievabilityAt,
  unitIdFor,
  unitsFromDeck,
} from "./recallModel";
import type { Concept, Deck } from "./types";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 7, 31);

function concept(overrides: Partial<Concept> = {}): Concept {
  return {
    id: "c1",
    concept: "RAAS",
    question: "What triggers renin release?",
    answer: "reduced renal perfusion",
    distractor: "elevated serum sodium",
    cloze: "Renin is released in response to _____.",
    explanation: "A long paragraph.",
    ...overrides,
  };
}

function deck(concepts: Concept[]): Deck {
  return { id: "deck-1", title: "Renal", createdAt: NOW, concepts };
}

function review(overrides: Partial<ReviewRecord> = {}): ReviewRecord {
  return {
    id: crypto.randomUUID(),
    userId: "u1",
    unitId: "deck-1::c1",
    path: "cloze",
    reviewedAt: NOW,
    grade: GOOD as Grade,
    correct: true,
    latencyMs: 4000,
    credited: true,
    elapsedDays: 3,
    stabilityBefore: 5,
    stabilityAfter: 12,
    couplingOnSuccess: 0.35,
    couplingOnLapse: 0.6,
    ...overrides,
  };
}

function memory(overrides: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    key: memoryKey("u1", "deck-1::c1", "cloze"),
    userId: "u1",
    unitId: "deck-1::c1",
    path: "cloze",
    stability: 20,
    difficulty: 5,
    lastReviewedAt: NOW,
    dueAt: NOW + 20 * MS_PER_DAY,
    reps: 3,
    lapses: 0,
    desiredRetention: 0.9,
    ...overrides,
  };
}

describe("path classification", () => {
  it("splits recognition from production, since only production proves recall", () => {
    expect(isRecognitionPath("swipe")).toBe(true);
    expect(isRecognitionPath("mcq")).toBe(true);
    for (const path of ["cloze", "reverse", "explain"] as RetrievalPath[]) {
      expect(isProductionPath(path)).toBe(true);
      expect(isRecognitionPath(path)).toBe(false);
    }
  });
});

describe("unitsFromDeck", () => {
  it("derives ids from deck and concept so a re-import updates rather than duplicates", () => {
    const d = deck([concept(), concept({ id: "c2" })]);
    const first = unitsFromDeck(d, "u1");
    const again = unitsFromDeck(d, "u1");
    expect(first.map((u) => u.id)).toEqual(again.map((u) => u.id));
    expect(first[0].id).toBe(unitIdFor("deck-1", "c1"));
  });

  it("scopes every unit to the user, so two accounts on one device never merge", () => {
    const mine = unitsFromDeck(deck([concept()]), "u1");
    const theirs = unitsFromDeck(deck([concept()]), "u2");
    expect(mine[0].userId).toBe("u1");
    expect(theirs[0].userId).toBe("u2");
    expect(mine[0].id).toBe(theirs[0].id);
  });

  it("carries the concept through untouched, so the study feed keeps working", () => {
    const c = concept();
    expect(unitsFromDeck(deck([c]), "u1")[0].concept).toEqual(c);
  });
});

describe("pathsFor", () => {
  it("offers swipe and cloze for a well-formed concept", () => {
    expect(pathsFor(concept())).toEqual(["swipe", "cloze"]);
  });

  // Model output is not guaranteed to contain the blank the schema asks for.
  // Scheduling a cloze that cannot render one is worse than not offering it.
  it("drops cloze when the generator left no blank in it", () => {
    expect(pathsFor(concept({ cloze: "Renin is released after perfusion falls." }))).toEqual(["swipe"]);
  });

  it("drops swipe when there is no distractor to contrast against", () => {
    expect(pathsFor(concept({ distractor: "" }))).toEqual(["cloze"]);
  });
});

describe("fastAnswerThreshold", () => {
  it("withholds judgement until there is enough history to judge against", () => {
    expect(fastAnswerThreshold([100, 200, 300])).toBeNull();
    expect(fastAnswerThreshold(Array.from({ length: 9 }, (_, i) => 1000 + i))).toBeNull();
  });

  it("returns a low percentile of this student's own times, not a fixed number", () => {
    const slowReader = Array.from({ length: 100 }, (_, i) => 8000 + i * 100);
    const fastReader = Array.from({ length: 100 }, (_, i) => 900 + i * 10);
    const slow = fastAnswerThreshold(slowReader);
    const fast = fastAnswerThreshold(fastReader);
    expect(slow).not.toBeNull();
    expect(fast).not.toBeNull();
    // A fast reader's normal pace must not be treated as a guess.
    expect(slow!).toBeGreaterThan(fast!);
  });

  it("ignores missing and nonsensical latencies rather than skewing on them", () => {
    const withJunk = [...Array.from({ length: 20 }, () => 5000), 0, -1, Number.NaN];
    expect(fastAnswerThreshold(withJunk)).toBe(5000);
  });
});

describe("gradeFor", () => {
  const fast = { path: "swipe" as RetrievalPath, fastThresholdMs: 1200 };

  it("credits a wrong answer as a real failure", () => {
    expect(gradeFor("incorrect", 5000, fast)).toEqual({ grade: AGAIN, credit: true });
  });

  // Scrolling past a card is evidence of nothing. It still requeues (grade
  // AGAIN) and is still logged, but it must not decay a memory that was never
  // actually tested - otherwise thumb movement writes the memory model.
  it("records a skipped card without letting it move the memory model", () => {
    const graded = gradeFor("skipped", 5000, fast);
    expect(graded.grade).toBe(AGAIN);
    expect(graded.credit).toBe(false);
    expect(graded.reason).toBe("not-answered");
  });

  it("credits a normally-paced correct answer as Good", () => {
    expect(gradeFor("correct", 5000, fast)).toEqual({ grade: GOOD, credit: true });
  });

  // The direct fix for a two-option swipe being winnable by luck half the time:
  // record the answer, refuse to let it advance the interval.
  it("refuses to credit a correct recognition answer that arrived too fast to be recall", () => {
    const graded = gradeFor("correct", 300, fast);
    expect(graded.credit).toBe(false);
    expect(graded.reason).toBe("suspect-guess");
  });

  it("still credits a fast recognition answer when there is no history to judge it against", () => {
    expect(gradeFor("correct", 300, { path: "swipe", fastThresholdMs: null }).credit).toBe(true);
  });

  // Nothing is on screen to recognise on a production path, so speed there is
  // fluency rather than luck.
  it("reads a fast production answer as fluent, not suspicious", () => {
    const graded = gradeFor("correct", 300, { path: "cloze", fastThresholdMs: 1200 });
    expect(graded).toEqual({ grade: EASY, credit: true });
  });

  it("treats an unmeasured latency as trustworthy rather than suspect", () => {
    expect(gradeFor("correct", 0, fast).credit).toBe(true);
  });
});

describe("masteryFor", () => {
  const day = (n: number) => NOW - (30 - n) * MS_PER_DAY;

  it("calls a never-passed unit `met`, not mastered", () => {
    const evidence = masteryFor([review({ grade: AGAIN, correct: false })], [], NOW);
    expect(evidence.level).toBe("met");
    expect(evidence.successes).toBe(0);
  });

  // This is the exact state the current code labels "mastered": one correct
  // answer on one format. Naming it separately is most of the fix.
  it("calls one success on one format `familiar` - what the feed calls mastered today", () => {
    expect(masteryFor([review()], [], NOW).level).toBe("familiar");
  });

  it("calls two formats without a delayed pass `holding`", () => {
    const evidence = masteryFor(
      [review({ path: "swipe" }), review({ path: "cloze" }), review({ path: "cloze" })],
      [],
      NOW,
    );
    expect(evidence.level).toBe("holding");
    expect(evidence.pathsPassed.sort()).toEqual(["cloze", "swipe"]);
  });

  it("reaches `solid` only with three successes, two formats, a delayed pass and production", () => {
    const evidence = masteryFor(
      [
        review({ path: "swipe", reviewedAt: day(0) }),
        review({ path: "cloze", reviewedAt: day(1) }),
        review({ path: "cloze", reviewedAt: day(20) }),
      ],
      [memory({ lastReviewedAt: day(20) })],
      NOW,
    );
    expect(evidence.level).toBe("solid");
    expect(evidence.hasDelayedSuccess).toBe(true);
    expect(evidence.hasProductionSuccess).toBe(true);
  });

  // Recognition alone can never be solid, however many times it is passed -
  // this is the illusion of knowledge, asserted as a test.
  it("refuses `solid` for a unit only ever passed on recognition formats", () => {
    const evidence = masteryFor(
      [
        review({ path: "swipe", reviewedAt: day(0) }),
        review({ path: "mcq", reviewedAt: day(1) }),
        review({ path: "swipe", reviewedAt: day(20) }),
      ],
      [memory()],
      NOW,
    );
    expect(evidence.hasProductionSuccess).toBe(false);
    expect(evidence.level).not.toBe("solid");
  });

  // A gap only counts if it is a gap on the SAME format. A fortnight-old cloze
  // warmed up by a swipe an hour earlier is not delayed evidence.
  it("measures the delay per format, not across the whole unit", () => {
    const evidence = masteryFor(
      [
        review({ path: "swipe", reviewedAt: day(0) }),
        review({ path: "cloze", reviewedAt: day(20) }),
        review({ path: "cloze", reviewedAt: day(21) }),
      ],
      [memory()],
      NOW,
    );
    expect(evidence.hasDelayedSuccess).toBe(false);
  });

  it("ignores uncredited answers entirely, so a lucky guess cannot build mastery", () => {
    const evidence = masteryFor(
      [
        review({ path: "swipe", credited: false, reviewedAt: day(0) }),
        review({ path: "swipe", credited: false, reviewedAt: day(20) }),
        review({ path: "cloze", credited: false, reviewedAt: day(21) }),
      ],
      [memory()],
      NOW,
    );
    expect(evidence.successes).toBe(0);
    expect(evidence.level).toBe("met");
  });

  // Mastery is not a ratchet: a solid concept that has decayed past its own
  // target is the single most useful thing to surface.
  it("reports a decayed solid unit as `fading`", () => {
    const reviews = [
      review({ path: "swipe", reviewedAt: day(0) }),
      review({ path: "cloze", reviewedAt: day(1) }),
      review({ path: "cloze", reviewedAt: day(20) }),
    ];
    const stale = memory({ stability: 2, lastReviewedAt: NOW - 200 * MS_PER_DAY, desiredRetention: 0.9 });
    expect(masteryFor(reviews, [stale], NOW).level).toBe("fading");
  });
});

describe("due selection", () => {
  it("ranks on the shortfall against each unit's own target, not raw recall", () => {
    // Healthier-looking but exam-critical, versus lower but well within target.
    const highYield = memory({
      key: "a", path: "cloze", stability: 30,
      lastReviewedAt: NOW - 12 * MS_PER_DAY, desiredRetention: 0.95,
    });
    const background = memory({
      key: "b", path: "swipe", stability: 30,
      lastReviewedAt: NOW - 10 * MS_PER_DAY, desiredRetention: 0.86,
    });
    expect(currentRetrievability(highYield, NOW)).toBeGreaterThan(0.9);
    expect(dueFirst([background, highYield], NOW)[0].key).toBe("a");
  });

  it("treats a memory inside its own target as not worth the student's time", () => {
    const solid = memory({ stability: 120, lastReviewedAt: NOW - 5 * MS_PER_DAY, desiredRetention: 0.9 });
    expect(isDue(solid, NOW)).toBe(false);
  });

  it("treats a decayed memory as due", () => {
    const slipping = memory({ stability: 3, lastReviewedAt: NOW - 40 * MS_PER_DAY, desiredRetention: 0.9 });
    expect(isDue(slipping, NOW)).toBe(true);
  });

  it("leaves the caller's array untouched", () => {
    const rows = [memory({ key: "a" }), memory({ key: "b" })];
    dueFirst(rows, NOW);
    expect(rows.map((r) => r.key)).toEqual(["a", "b"]);
  });
});

describe("masteryFor: high-confidence failures", () => {
  const day = (n: number) => NOW - (30 - n) * MS_PER_DAY;

  /** The three reviews that otherwise clear every `solid` condition: three
   * successes, two formats, a delayed pass, and one on a production path. */
  function solidRuns(): ReviewRecord[] {
    return [
      review({ path: "swipe", reviewedAt: day(0) }),
      review({ path: "cloze", reviewedAt: day(1) }),
      review({ path: "cloze", reviewedAt: day(20) }),
    ];
  }

  it("keeps a unit off `solid` while a knew-it failure stands unanswered", () => {
    const evidence = masteryFor(
      [
        ...solidRuns(),
        review({ path: "swipe", reviewedAt: day(22), grade: AGAIN, correct: false, confidence: "knew-it" }),
      ],
      [memory({ lastReviewedAt: day(22) })],
      NOW,
    );
    expect(evidence.hasActiveConfidentFailure).toBe(true);
    expect(evidence.level).not.toBe("solid");
    // Every other condition still holds - it is this one condition doing the work.
    expect(evidence.hasDelayedSuccess).toBe(true);
    expect(evidence.hasProductionSuccess).toBe(true);
  });

  it("clears it once that same format is passed again", () => {
    const evidence = masteryFor(
      [
        ...solidRuns(),
        review({ path: "swipe", reviewedAt: day(22), grade: AGAIN, correct: false, confidence: "knew-it" }),
        review({ path: "swipe", reviewedAt: day(24) }),
      ],
      [memory({ lastReviewedAt: day(24) })],
      NOW,
    );
    expect(evidence.hasActiveConfidentFailure).toBe(false);
    expect(evidence.level).toBe("solid");
  });

  it("is not cleared by passing a DIFFERENT format", () => {
    // The misconception is about how this concept is asked that way. A cloze
    // success says nothing about a confidently wrong recognition judgement.
    const evidence = masteryFor(
      [
        ...solidRuns(),
        review({ path: "swipe", reviewedAt: day(22), grade: AGAIN, correct: false, confidence: "knew-it" }),
        review({ path: "cloze", reviewedAt: day(24) }),
      ],
      [memory({ lastReviewedAt: day(24) })],
      NOW,
    );
    expect(evidence.hasActiveConfidentFailure).toBe(true);
    expect(evidence.level).not.toBe("solid");
  });

  it("is not cleared by guessing wrong again on that format", () => {
    const evidence = masteryFor(
      [
        ...solidRuns(),
        review({ path: "swipe", reviewedAt: day(22), grade: AGAIN, correct: false, confidence: "knew-it" }),
        review({ path: "swipe", reviewedAt: day(24), grade: AGAIN, correct: false, confidence: "guessed" }),
      ],
      [memory({ lastReviewedAt: day(24) })],
      NOW,
    );
    expect(evidence.hasActiveConfidentFailure).toBe(true);
  });

  it("treats a guessed failure as no evidence of a misconception at all", () => {
    const evidence = masteryFor(
      [
        ...solidRuns(),
        review({ path: "swipe", reviewedAt: day(22), grade: AGAIN, correct: false, confidence: "guessed" }),
      ],
      [memory({ lastReviewedAt: day(22) })],
      NOW,
    );
    expect(evidence.hasActiveConfidentFailure).toBe(false);
    expect(evidence.level).toBe("solid");
  });

  it("treats a missing confidence as 'not asked', never as a confident failure", () => {
    // Every review written before this field existed, plus any failure the
    // student scrolled away from. Reading those as knew-it would retroactively
    // block solid across a whole existing history.
    const evidence = masteryFor(
      [
        ...solidRuns(),
        review({ path: "swipe", reviewedAt: day(22), grade: AGAIN, correct: false }),
      ],
      [memory({ lastReviewedAt: day(22) })],
      NOW,
    );
    expect(evidence.hasActiveConfidentFailure).toBe(false);
    expect(evidence.level).toBe("solid");
  });

  it("ignores an uncredited confident failure, as it ignores every uncredited row", () => {
    const evidence = masteryFor(
      [
        ...solidRuns(),
        review({
          path: "swipe", reviewedAt: day(22), grade: AGAIN, correct: false,
          confidence: "knew-it", credited: false,
        }),
      ],
      [memory({ lastReviewedAt: day(22) })],
      NOW,
    );
    expect(evidence.hasActiveConfidentFailure).toBe(false);
    expect(evidence.level).toBe("solid");
  });
});

describe("daysUntilExam", () => {
  const noon = new Date(2026, 8, 2, 12, 0, 0).getTime();
  const localDay = (y: number, m: number, d: number) => new Date(y, m, d).getTime();

  it("is null when no exam is set, which is not the same as one in the past", () => {
    expect(daysUntilExam(undefined, noon)).toBeNull();
  });

  // Zero, not -1: an exam TODAY is maximally inside the band that raises the
  // retention floor, and measuring from the current instant rather than from local
  // midnight would read this afternoon's paper as yesterday's.
  it("is 0 for an exam today, whatever time of day it is asked", () => {
    expect(daysUntilExam(localDay(2026, 8, 2), noon)).toBe(0);
    expect(daysUntilExam(localDay(2026, 8, 2), new Date(2026, 8, 2, 23, 59).getTime())).toBe(0);
  });

  it("counts whole days forward and backward", () => {
    expect(daysUntilExam(localDay(2026, 8, 23), noon)).toBe(21);
    expect(daysUntilExam(localDay(2026, 8, 24), noon)).toBe(22);
    expect(daysUntilExam(localDay(2026, 8, 1), noon)).toBe(-1);
  });

  // The two ends of the band desiredRetentionFor cares about, asserted together so
  // an off-by-one here cannot silently stop the floor from ever applying.
  it("lands inside the retention band exactly where fsrs expects", () => {
    expect(desiredRetentionFor(0, daysUntilExam(localDay(2026, 8, 23), noon))).toBeCloseTo(0.95, 10);
    expect(desiredRetentionFor(0, daysUntilExam(localDay(2026, 8, 24), noon))).toBeLessThan(0.95);
    expect(desiredRetentionFor(0, daysUntilExam(localDay(2026, 8, 1), noon))).toBeLessThan(0.95);
  });
});

describe("soonestExamDate", () => {
  const withExam = (id: string, at?: number): Deck => ({
    id,
    title: id,
    createdAt: NOW,
    concepts: [],
    examDate: at,
  });

  it("is null when nothing has an exam", () => {
    expect(soonestExamDate([withExam("a"), withExam("b")])).toBeNull();
  });

  // Soonest, because the paper next week is the one a student is worried about -
  // anchoring to a term-end exam would flatter every number between now and it.
  it("takes the soonest of several", () => {
    const soon = new Date(2026, 8, 9).getTime();
    const later = new Date(2026, 8, 30).getTime();
    expect(soonestExamDate([withExam("a", later), withExam("b", soon)])).toBe(soon);
  });

  // Reads no clock on purpose: a component cannot read one while rendering, so
  // "which exam" is resolved here and "is it still ahead" by daysUntilExam.
  it("returns a date already sat, leaving that judgement to daysUntilExam", () => {
    const past = new Date(2026, 7, 20).getTime();
    expect(soonestExamDate([withExam("a", past)])).toBe(past);
    expect(daysUntilExam(past, new Date(2026, 8, 2, 12).getTime())).toBeLessThan(0);
  });
});

describe("masteryOver", () => {
  const twoDecks = [
    ...unitsFromDeck(deck([concept({ id: "c1" }), concept({ id: "c2" })]), "u1"),
    ...unitsFromDeck(
      { id: "deck-2", title: "Cardio", createdAt: NOW, concepts: [concept({ id: "c3" })] },
      "u1",
    ),
  ];

  it("counts every unit it includes, studied or not", () => {
    const all = masteryOver(twoDecks, [], [], () => true);
    expect(all.summary.units).toBe(3);
    // No credited success anywhere, so everything is `met` and nothing is claimed.
    expect(all.summary.met).toBe(3);
    expect(all.summary.solid).toBe(0);
  });

  // The invariant that makes one cross-deck pass safe to substitute for a loop over
  // per-deck passes: the account-wide summary is the decks' summaries added up.
  it("account-wide totals equal the per-deck totals added together", () => {
    const reviews = [review({ unitId: "deck-1::c1" }), review({ unitId: "deck-2::c3" })];
    const all = masteryOver(twoDecks, [], reviews, () => true);
    const first = masteryOver(twoDecks, [], reviews, (u) => u.sourceDeckId === "deck-1");
    const second = masteryOver(twoDecks, [], reviews, (u) => u.sourceDeckId === "deck-2");

    for (const key of ["units", "solid", "fading", "holding", "familiar", "met", "resting"] as const) {
      expect(all.summary[key]).toBe(first.summary[key] + second.summary[key]);
    }
  });

  it("ignores a review belonging to a unit the filter excluded", () => {
    const reviews = [review({ unitId: "deck-2::c3" })];
    const first = masteryOver(twoDecks, [], reviews, (u) => u.sourceDeckId === "deck-1");
    expect(first.summary.units).toBe(2);
    expect(first.summary.familiar).toBe(0);
  });

  // `resting` is the claim no flashcard app makes - "you know this, do not spend
  // tonight on it" - so it must need BOTH solid evidence and nothing currently due.
  it("never rests a concept with no memory rows to be comfortable about", () => {
    const all = masteryOver(twoDecks, [], [], () => true);
    expect(all.summary.resting).toBe(0);
    expect(all.resting.size).toBe(0);
  });
});

describe("retrievabilityAt", () => {
  it("agrees with currentRetrievability when the instant is now", () => {
    const m = memory({ lastReviewedAt: NOW - 10 * MS_PER_DAY });
    expect(retrievabilityAt(m, NOW)).toBeCloseTo(currentRetrievability(m, NOW), 12);
  });

  it("falls as the instant moves further out", () => {
    const m = memory({ stability: 20, lastReviewedAt: NOW });
    const week = retrievabilityAt(m, NOW + 7 * MS_PER_DAY);
    const month = retrievabilityAt(m, NOW + 30 * MS_PER_DAY);
    expect(week).toBeGreaterThan(month);
    expect(month).toBeGreaterThan(0);
  });

  it("is 1 at or before the last review, since there is nothing yet to forget", () => {
    const m = memory({ lastReviewedAt: NOW });
    expect(retrievabilityAt(m, NOW)).toBe(1);
    expect(retrievabilityAt(m, NOW - MS_PER_DAY)).toBe(1);
  });

  // Stability is defined as the 90%-recall interval, so this is the one value the
  // curve has to hit exactly whatever w20 is fitted to.
  it("returns 0.9 exactly one stability out", () => {
    const m = memory({ stability: 20, lastReviewedAt: NOW });
    expect(retrievabilityAt(m, NOW + 20 * MS_PER_DAY)).toBeCloseTo(0.9, 6);
  });
});

describe("projectedRecall", () => {
  const units = unitsFromDeck(deck([concept({ id: "c1" }), concept({ id: "c2" })]), "u1");

  it("counts a never-studied unit in the total and gives it no credit", () => {
    const projected = projectedRecall(units, [], NOW + 7 * MS_PER_DAY);
    expect(projected.total).toBe(2);
    expect(projected.expected).toBe(0);
  });

  // The whole point of a probability: 0.9 + 0.9 is 1.8 concepts, not 2. Rounding
  // belongs to whatever renders it.
  it("sums probabilities rather than counting certainties", () => {
    const rows = [
      memory({ unitId: "deck-1::c1", stability: 20, lastReviewedAt: NOW }),
      memory({ key: "k2", unitId: "deck-1::c2", stability: 20, lastReviewedAt: NOW }),
    ];
    const projected = projectedRecall(units, rows, NOW + 20 * MS_PER_DAY);
    expect(projected.expected).toBeCloseTo(1.8, 5);
    expect(projected.total).toBe(2);
  });

  // Averaging rather than taking the best is what stops the number flattering a
  // student who is strong on recognition and cannot produce the answer at all.
  it("averages a unit's formats instead of taking its strongest", () => {
    const strong = memory({ key: "a", path: "cloze", stability: 200, lastReviewedAt: NOW });
    const weak = memory({ key: "b", path: "swipe", stability: 1, lastReviewedAt: NOW });
    const at = NOW + 20 * MS_PER_DAY;
    const both = projectedRecall(units, [strong, weak], at).expected;
    const bestOnly = retrievabilityAt(strong, at);
    expect(both).toBeLessThan(bestOnly);
    expect(both).toBeCloseTo((retrievabilityAt(strong, at) + retrievabilityAt(weak, at)) / 2, 10);
  });

  it("ignores a memory row whose unit is not in the list", () => {
    const orphan = memory({ key: "x", unitId: "deck-9::c9", lastReviewedAt: NOW });
    expect(projectedRecall(units, [orphan], NOW + MS_PER_DAY).expected).toBe(0);
  });

  it("never exceeds the total, however well the student is doing", () => {
    const rows = units.map((u, i) =>
      memory({ key: `k${i}`, unitId: u.id, stability: 5000, lastReviewedAt: NOW }),
    );
    const projected = projectedRecall(units, rows, NOW + MS_PER_DAY);
    expect(projected.expected).toBeLessThanOrEqual(projected.total);
  });
});
