import { describe, expect, it } from "vitest";
import { AGAIN, EASY, GOOD, type Grade } from "./fsrs";
import {
  type MemoryRecord,
  type RetrievalPath,
  type ReviewRecord,
  currentRetrievability,
  dueFirst,
  fastAnswerThreshold,
  gradeFor,
  isDue,
  isProductionPath,
  isRecognitionPath,
  masteryFor,
  memoryKey,
  pathsFor,
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
