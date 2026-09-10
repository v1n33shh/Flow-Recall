import { describe, expect, it } from "vitest";
import { DEFAULT_PARAMS, GOOD, initialState, retrievability } from "@/lib/fsrs";
import {
  asPercent,
  CURVE,
  DAY_TICKS,
  HORIZON_DAYS,
  plotX,
  plotY,
  PLOT_H,
  PLOT_W,
  TARGET_RETENTION,
  toPath,
  type CurvePoint,
} from "@/lib/forgettingCurve";

/** The chart is an evidence claim, so these assert the claim rather than the drawing:
 * that the two series really do diverge, that the review gaps really do widen, and that
 * the dashed 90% rule really is what `stability` means. If a future parameter refit
 * changes the shape, this suite is where it should be noticed. */

describe("the two series", () => {
  it("both start at full recall on day zero", () => {
    expect(CURVE.studiedOnce[0].recall).toBe(1);
    expect(CURVE.reviewed[0].recall).toBe(1);
  });

  it("ends with the reviewed concept well above the abandoned one", () => {
    expect(CURVE.endRecall.reviewed).toBeGreaterThan(CURVE.endRecall.studiedOnce);
    // The headline numbers the page prints beside the chart. Pinned, because copy
    // elsewhere quotes them and silently drifting apart is the failure mode.
    expect(asPercent(CURVE.endRecall.studiedOnce)).toBe(51);
    expect(asPercent(CURVE.endRecall.reviewed)).toBe(93);
  });

  it("keeps every sample inside a probability", () => {
    for (const series of [CURVE.studiedOnce, CURVE.reviewed]) {
      for (const { recall } of series) {
        expect(recall).toBeGreaterThan(0);
        expect(recall).toBeLessThanOrEqual(1);
      }
    }
  });

  it("spans exactly the horizon", () => {
    for (const series of [CURVE.studiedOnce, CURVE.reviewed]) {
      expect(series[0].day).toBe(0);
      expect(series[series.length - 1].day).toBeCloseTo(HORIZON_DAYS, 6);
    }
  });
});

describe("the abandoned series", () => {
  it("only ever falls", () => {
    for (let i = 1; i < CURVE.studiedOnce.length; i += 1) {
      expect(CURVE.studiedOnce[i].recall).toBeLessThan(CURVE.studiedOnce[i - 1].recall);
    }
  });

  it("is the app's own retrievability function, not a redrawn approximation", () => {
    const first = initialState(GOOD, DEFAULT_PARAMS);
    for (const { day, recall } of CURVE.studiedOnce) {
      expect(recall).toBe(retrievability(first, day, DEFAULT_PARAMS));
    }
  });
});

describe("the reviewed series", () => {
  it("lands three reviews inside six months", () => {
    expect(CURVE.reviews).toHaveLength(3);
    const days = CURVE.reviews.map((r) => Math.round(r.day * 10) / 10);
    expect(days).toEqual([2.3, 14.2, 63.8]);
  });

  it("widens every gap - the spacing effect, not a drawing choice", () => {
    const days = CURVE.reviews.map((r) => r.day);
    const gaps = days.map((day, i) => day - (i === 0 ? 0 : days[i - 1]));
    for (let i = 1; i < gaps.length; i += 1) {
      expect(gaps[i]).toBeGreaterThan(gaps[i - 1]);
    }
  });

  it("recovers to full recall at each review, and never drifts up between them", () => {
    const peaks = CURVE.reviewed.filter((p) => p.recall === 1 && p.day > 0);
    expect(peaks).toHaveLength(CURVE.reviews.length);

    // Inside a segment recall must fall. A rise anywhere other than a review instant
    // would mean the sawtooth had been stitched together in the wrong order.
    const reviewDays = new Set(CURVE.reviews.map((r) => r.day));
    for (let i = 1; i < CURVE.reviewed.length; i += 1) {
      const previous = CURVE.reviewed[i - 1];
      const current = CURVE.reviewed[i];
      if (reviewDays.has(current.day) && current.recall === 1) continue;
      expect(current.recall).toBeLessThanOrEqual(previous.recall);
    }
  });

  it("is answered at the target retention, which is what stability means", () => {
    // Each review is scheduled for the day recall reaches 0.9, so the sample taken
    // immediately before each spike should sit on that line.
    for (const review of CURVE.reviews) {
      const atReview = CURVE.reviewed.find((p) => p.day === review.day && p.recall < 1);
      expect(atReview).toBeDefined();
      expect(atReview!.recall).toBeCloseTo(TARGET_RETENTION, 6);
    }
  });

  it("never falls as far as the abandoned concept does", () => {
    const floor = Math.min(...CURVE.reviewed.map((p) => p.recall));
    expect(floor).toBeGreaterThan(CURVE.endRecall.studiedOnce);
  });
});

describe("plot space", () => {
  it("maps the horizon across the full width and clamps outside it", () => {
    expect(plotX(0)).toBe(0);
    expect(plotX(HORIZON_DAYS)).toBeCloseTo(PLOT_W, 6);
    expect(plotX(-10)).toBe(0);
    expect(plotX(HORIZON_DAYS * 4)).toBeCloseTo(PLOT_W, 6);
  });

  it("spreads the early reviews out instead of stacking them at the left edge", () => {
    // The reason the axis is √day at all: on a linear axis day 2.3 sits at 1.3% of the
    // width and day 14.2 at 7.9%, so both early spikes would overlap into one mark.
    const fractions = CURVE.reviews.map((r) => plotX(r.day) / PLOT_W);
    for (const f of fractions) expect(f).toBeGreaterThan(0.05);
    for (let i = 1; i < fractions.length; i += 1) {
      expect(fractions[i] - fractions[i - 1]).toBeGreaterThan(0.1);
    }
  });

  it("uses a full, uncropped recall axis", () => {
    expect(plotY(1)).toBe(0);
    expect(plotY(0)).toBeCloseTo(PLOT_H, 6);
    expect(plotY(0.5)).toBeCloseTo(PLOT_H / 2, 6);
  });

  it("keeps every day tick on the canvas and in order", () => {
    const xs = DAY_TICKS.map(plotX);
    expect(xs[0]).toBe(0);
    for (let i = 1; i < xs.length; i += 1) expect(xs[i]).toBeGreaterThan(xs[i - 1]);
    expect(xs[xs.length - 1]).toBeCloseTo(PLOT_W, 6);
  });
});

describe("toPath", () => {
  it("emits an empty string for no points rather than a broken `d`", () => {
    expect(toPath([])).toBe("");
  });

  it("opens with a move and continues with lines", () => {
    const points: CurvePoint[] = [
      { day: 0, recall: 1 },
      { day: 90, recall: 0.5 },
    ];
    expect(toPath(points)).toBe(`M0.00 0.00 L${plotX(90).toFixed(2)} ${plotY(0.5).toFixed(2)}`);
  });

  it("never emits NaN for either real series", () => {
    for (const series of [CURVE.studiedOnce, CURVE.reviewed]) {
      expect(toPath(series)).not.toMatch(/NaN/);
    }
  });

  it("is stable across calls, so the server and client strings agree", () => {
    expect(toPath(CURVE.reviewed)).toBe(toPath(CURVE.reviewed));
  });
});
