import { describe, expect, it } from "vitest";
import {
  AGAIN,
  COUPLING_ON_LAPSE,
  COUPLING_ON_SUCCESS,
  DEFAULT_PARAMS,
  EASY,
  GOOD,
  HARD,
  coupleSibling,
  desiredRetentionFor,
  initialState,
  intervalFor,
  nextState,
  retrievability,
} from "./fsrs";

// The two anchors that define the whole model: stability IS the 90%-recall
// interval. If either of these drifts, `factor` has been derived wrong and
// every interval in the product is subtly off - so they're asserted against
// several decay values, not just the default w20.
describe("the 90% anchor", () => {
  const decays = [0.1, 0.1542, 0.3, 0.8];

  it("puts recall at exactly 90% after `stability` days, for any decay", () => {
    for (const decay of decays) {
      const params = [...DEFAULT_PARAMS];
      params[20] = decay;
      for (const stability of [0.5, 2, 37, 4000]) {
        expect(retrievability({ stability, difficulty: 5 }, stability, params)).toBeCloseTo(0.9, 10);
      }
    }
  });

  it("returns `stability` as the interval at 0.9 desired retention, for any decay", () => {
    for (const decay of decays) {
      const params = [...DEFAULT_PARAMS];
      params[20] = decay;
      for (const stability of [0.5, 2, 37, 4000]) {
        expect(intervalFor(stability, 0.9, params)).toBeCloseTo(stability, 6);
      }
    }
  });
});

describe("retrievability", () => {
  const state = { stability: 10, difficulty: 5 };

  it("is 1 before any time has passed", () => {
    expect(retrievability(state, 0)).toBe(1);
    expect(retrievability(state, -3)).toBe(1);
  });

  it("decays monotonically", () => {
    const points = [1, 5, 10, 30, 100, 365].map((d) => retrievability(state, d));
    for (let i = 1; i < points.length; i++) {
      expect(points[i]).toBeLessThan(points[i - 1]);
    }
  });

  it("decays more slowly the more stable the memory", () => {
    const shaky = retrievability({ stability: 2, difficulty: 5 }, 30);
    const solid = retrievability({ stability: 60, difficulty: 5 }, 30);
    expect(solid).toBeGreaterThan(shaky);
  });

  // The flat tail is the entire argument for "don't study this tonight": a
  // well-established concept loses almost nothing over a month.
  it("leaves a solid memory nearly intact over a month", () => {
    expect(retrievability({ stability: 60, difficulty: 5 }, 30)).toBeGreaterThan(0.85);
  });
});

describe("intervalFor", () => {
  it("asks for a shorter interval the higher the retention target", () => {
    const at86 = intervalFor(20, 0.86);
    const at95 = intervalFor(20, 0.95);
    expect(at95).toBeLessThan(at86);
  });

  it("clamps an absurd retention target instead of returning nonsense", () => {
    expect(intervalFor(20, 0)).toBeGreaterThan(0);
    expect(Number.isFinite(intervalFor(20, 1))).toBe(true);
  });
});

describe("initialState", () => {
  it("reads initial stability straight off w0-w3, one per grade", () => {
    expect(initialState(AGAIN).stability).toBeCloseTo(DEFAULT_PARAMS[0], 10);
    expect(initialState(HARD).stability).toBeCloseTo(DEFAULT_PARAMS[1], 10);
    expect(initialState(GOOD).stability).toBeCloseTo(DEFAULT_PARAMS[2], 10);
    expect(initialState(EASY).stability).toBeCloseTo(DEFAULT_PARAMS[3], 10);
  });

  it("sets difficulty to w4 when the first answer is a failure", () => {
    expect(initialState(AGAIN).difficulty).toBeCloseTo(DEFAULT_PARAMS[4], 10);
  });

  it("keeps difficulty inside 1-10 even where the formula runs past the bound", () => {
    for (const grade of [AGAIN, HARD, GOOD, EASY] as const) {
      const { difficulty } = initialState(grade);
      expect(difficulty).toBeGreaterThanOrEqual(1);
      expect(difficulty).toBeLessThanOrEqual(10);
    }
  });

  it("treats a better first grade as easier and more stable", () => {
    expect(initialState(EASY).difficulty).toBeLessThan(initialState(AGAIN).difficulty);
    expect(initialState(EASY).stability).toBeGreaterThan(initialState(AGAIN).stability);
  });
});

describe("nextState on a long-term review", () => {
  const settled = { stability: 10, difficulty: 5 };

  it("treats a null previous state as a first review", () => {
    expect(nextState(null, GOOD, 0)).toEqual(initialState(GOOD));
  });

  it("never lets a successful recall reduce stability", () => {
    for (const grade of [HARD, GOOD, EASY] as const) {
      for (const elapsed of [1, 10, 200, 5000]) {
        expect(nextState(settled, grade, elapsed).stability).toBeGreaterThanOrEqual(settled.stability);
      }
    }
  });

  it("never lets a lapse increase stability", () => {
    for (const elapsed of [1, 10, 200, 5000]) {
      expect(nextState(settled, AGAIN, elapsed).stability).toBeLessThanOrEqual(settled.stability);
    }
  });

  // A lapse keeps a real share of what was built. This is the formal reason a
  // student returning after a month is not starting over.
  it("keeps some stability after a lapse rather than resetting to zero", () => {
    const after = nextState({ stability: 60, difficulty: 5 }, AGAIN, 90).stability;
    expect(after).toBeGreaterThan(0.5);
  });

  it("rewards Hard less than Good, and Good less than Easy", () => {
    const hard = nextState(settled, HARD, 12).stability;
    const good = nextState(settled, GOOD, 12).stability;
    const easy = nextState(settled, EASY, 12).stability;
    expect(hard).toBeLessThan(good);
    expect(good).toBeLessThan(easy);
  });

  // The spacing effect, stated as a test: a retrieval is worth more the closer
  // the memory was to being lost. This is what the selection layer prices
  // against, so it is the single most load-bearing property in the file.
  it("rewards a recall more the longer it was left", () => {
    const gains = [2, 10, 30, 90].map(
      (elapsed) => nextState(settled, GOOD, elapsed).stability - settled.stability,
    );
    for (let i = 1; i < gains.length; i++) {
      expect(gains[i]).toBeGreaterThan(gains[i - 1]);
    }
  });

  it("gives a harder concept a smaller gain than an easy one", () => {
    const hardConcept = nextState({ stability: 10, difficulty: 9 }, GOOD, 12).stability;
    const easyConcept = nextState({ stability: 10, difficulty: 2 }, GOOD, 12).stability;
    expect(hardConcept).toBeLessThan(easyConcept);
  });

  it("moves difficulty down on Easy and up on Again, staying inside 1-10", () => {
    expect(nextState(settled, EASY, 12).difficulty).toBeLessThan(settled.difficulty);
    expect(nextState(settled, AGAIN, 12).difficulty).toBeGreaterThan(settled.difficulty);
    for (const grade of [AGAIN, HARD, GOOD, EASY] as const) {
      const d = nextState({ stability: 10, difficulty: 9.99 }, grade, 12).difficulty;
      expect(d).toBeGreaterThanOrEqual(1);
      expect(d).toBeLessThanOrEqual(10);
    }
  });

  it("never produces a non-finite or non-positive stability, however extreme the input", () => {
    const extremes = [
      { stability: 0.001, difficulty: 1 },
      { stability: 0.001, difficulty: 10 },
      { stability: 36500, difficulty: 1 },
      { stability: 36500, difficulty: 10 },
    ];
    for (const state of extremes) {
      for (const grade of [AGAIN, HARD, GOOD, EASY] as const) {
        for (const elapsed of [0.1, 1, 10_000]) {
          const { stability, difficulty } = nextState(state, grade, elapsed);
          expect(Number.isFinite(stability)).toBe(true);
          expect(stability).toBeGreaterThan(0);
          expect(stability).toBeLessThanOrEqual(36500);
          expect(Number.isFinite(difficulty)).toBe(true);
        }
      }
    }
  });
});

// Same-day repeats are the norm in this app, not an edge case: the study feed
// requeues a failed card three slides later, so these paths run constantly.
describe("nextState on a same-day repeat", () => {
  const settled = { stability: 10, difficulty: 5 };

  it("does not credit a same-day success with the spacing it never earned", () => {
    const sameDay = nextState(settled, GOOD, 0.02).stability;
    const properlySpaced = nextState(settled, GOOD, 12).stability;
    expect(sameDay).toBeLessThan(properlySpaced);
  });

  it("never loses ground on a same-day Good or Easy", () => {
    expect(nextState(settled, GOOD, 0.02).stability).toBeGreaterThanOrEqual(settled.stability);
    expect(nextState(settled, EASY, 0.02).stability).toBeGreaterThanOrEqual(settled.stability);
  });

  it("still updates difficulty", () => {
    expect(nextState(settled, AGAIN, 0.02).difficulty).toBeGreaterThan(settled.difficulty);
  });

  it("helps a shaky memory more than a settled one", () => {
    const shakyGain =
      nextState({ stability: 1, difficulty: 5 }, GOOD, 0.02).stability / 1;
    const settledGain = nextState(settled, GOOD, 0.02).stability / settled.stability;
    expect(shakyGain).toBeGreaterThan(settledGain);
  });
});

describe("coupleSibling", () => {
  const sibling = { stability: 10, difficulty: 4 };

  it("moves a sibling format in the same direction, but damped", () => {
    const coupled = coupleSibling(sibling, 10, 20, GOOD);
    expect(coupled.stability).toBeCloseTo(10 + 10 * COUPLING_ON_SUCCESS, 10);
    expect(coupled.stability).toBeGreaterThan(sibling.stability);
    expect(coupled.stability).toBeLessThan(20);
  });

  // Asymmetric on purpose: forgetting generalises across formats more than a
  // recognition success generalises to production.
  it("couples a lapse harder than a success", () => {
    expect(COUPLING_ON_LAPSE).toBeGreaterThan(COUPLING_ON_SUCCESS);
    const dropped = coupleSibling(sibling, 10, 4, AGAIN);
    expect(dropped.stability).toBeCloseTo(10 - 6 * COUPLING_ON_LAPSE, 10);
  });

  // Difficulty belongs to the concept and was already updated by the direct
  // review - touching it here would count the same evidence twice.
  it("leaves the sibling's difficulty untouched", () => {
    expect(coupleSibling(sibling, 10, 20, GOOD).difficulty).toBe(sibling.difficulty);
    expect(coupleSibling(sibling, 10, 2, AGAIN).difficulty).toBe(sibling.difficulty);
  });

  it("cannot drive a sibling to zero or below on a severe lapse", () => {
    const coupled = coupleSibling({ stability: 0.5, difficulty: 5 }, 300, 0.001, AGAIN);
    expect(coupled.stability).toBeGreaterThan(0);
  });

  it("is a no-op when the direct review changed nothing", () => {
    expect(coupleSibling(sibling, 10, 10, GOOD).stability).toBeCloseTo(sibling.stability, 10);
  });
});

describe("desiredRetentionFor", () => {
  it("asks for more retention on more important material", () => {
    expect(desiredRetentionFor(1, null)).toBeGreaterThan(desiredRetentionFor(0, null));
  });

  it("stays inside the 0.86-0.95 band away from an exam", () => {
    for (const importance of [-1, 0, 0.5, 1, 2]) {
      const r = desiredRetentionFor(importance, null);
      expect(r).toBeGreaterThanOrEqual(0.86);
      expect(r).toBeLessThanOrEqual(0.95);
    }
  });

  // Nothing should be scheduled to peak after the paper.
  it("raises even unimportant material to 0.95 inside the exam window", () => {
    expect(desiredRetentionFor(0, 10)).toBeCloseTo(0.95, 10);
    expect(desiredRetentionFor(0, 21)).toBeCloseTo(0.95, 10);
  });

  it("ignores an exam that is still far off, or already past", () => {
    expect(desiredRetentionFor(0, 22)).toBeLessThan(0.95);
    expect(desiredRetentionFor(0, -1)).toBeLessThan(0.95);
  });

  // The band exists so a shorter interval is always the consequence of caring
  // more - not just a different number.
  it("shortens the interval it implies as importance rises", () => {
    const casual = intervalFor(20, desiredRetentionFor(0, null));
    const highYield = intervalFor(20, desiredRetentionFor(1, null));
    expect(highYield).toBeLessThan(casual);
  });
});
