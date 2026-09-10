import {
  DEFAULT_PARAMS,
  GOOD,
  initialState,
  intervalFor,
  nextState,
  retrievability,
  type MemoryState,
} from "@/lib/fsrs";

/** The landing page's retention chart, plotted from this app's own scheduler.
 *
 * The home page has claimed "research-backed" for months and named the forgetting curve
 * once, in its closing CTA, with nothing behind either. It did not have to: src/lib/fsrs.ts
 * is a verbatim FSRS-6 port, every function in it is pure arithmetic over numbers, and all
 * four of the ones used here are exported. So the curve on the page can be the curve the
 * student will actually be scheduled against, rather than an illustration of one.
 *
 * Everything below runs at module load, which means the <path> strings are server-rendered
 * into the initial HTML: no client cost, readable by a crawler on first fetch, and
 * identical inside the Capacitor shell, which has no server behind it at all.
 *
 * The two series answer one question - what is the difference between studying something
 * once and being asked for it again when the scheduler says so:
 *
 *       day |  studied once  |  reviewed on schedule
 *         7 |      81%       |        95%
 *        30 |      67%       |        96%
 *       180 |      51%       |        93%
 *
 * Three reviews, at day 2.3, 14.2 and 63.8. Each gap is roughly four times the last, and
 * that widening is not a drawing decision - it falls out of `e^(w10·(1-R)) - 1` in
 * fsrs.ts's `stabilityAfterRecall`, which is the spacing effect itself. */

/** Six months. Long enough for the third review to land and for the gaps to visibly widen,
 * short enough to still be a semester rather than an abstraction. */
export const HORIZON_DAYS = 180;

/** The retention the scheduler aims at, and the reason the chart has a dashed rule at 0.9:
 * `stability` is DEFINED in fsrs.ts as the interval at which recall has decayed to exactly
 * 90%, so this one number is both the target and the unit. */
export const TARGET_RETENTION = 0.9;

/** Plot-space dimensions. The component positions this box inside a larger viewBox with
 * room for axis labels; nothing here knows about that padding. */
export const PLOT_W = 680;
export const PLOT_H = 260;

/** The day labels on the x axis. Real days, printed, because the axis is not linear - see
 * `plotX`. Disclosing the scale is the difference between a compressed axis and a
 * misleading one. */
export const DAY_TICKS: readonly number[] = [0, 7, 30, 90, HORIZON_DAYS];

export type CurvePoint = { day: number; recall: number };

export type RetentionCurve = {
  /** One study session, never revisited. */
  readonly studiedOnce: readonly CurvePoint[];
  /** The same concept, answered again each time the scheduler asks for it. */
  readonly reviewed: readonly CurvePoint[];
  /** Where those reviews land. `recall` is 1 at each: the peak of the spike. */
  readonly reviews: readonly CurvePoint[];
  /** Recall on the last day of the horizon, for the two end labels. */
  readonly endRecall: { readonly studiedOnce: number; readonly reviewed: number };
};

/** Horizontal position, on a SQUARE-ROOT day scale.
 *
 * Linear would be honest and useless: the first two reviews land on day 2.3 and 14.2 of
 * 180, so they would collapse into the left 8% of the width and the widening-gap story -
 * the entire argument the chart exists to make - would be invisible. Under √day the four
 * review spikes sit at roughly 11%, 28% and 60% of the width instead.
 *
 * The compression is disclosed rather than hidden: DAY_TICKS prints the real day under each
 * gridline, so the reader can see that the right half of the chart covers more time than
 * the left. */
export function plotX(day: number): number {
  const clamped = Math.min(Math.max(day, 0), HORIZON_DAYS);
  return (Math.sqrt(clamped) / Math.sqrt(HORIZON_DAYS)) * PLOT_W;
}

/** Vertical position. A FULL 0-100% axis, deliberately.
 *
 * Cropping the y axis at, say, 40% would make the gap between the two series look twice as
 * large as it is, which is the oldest misleading-chart trick there is and exactly the kind
 * of overclaim this chart was built to replace. At full scale the difference at six months
 * is still 42 points of a 260px box, which is plenty. */
export function plotY(recall: number): number {
  const clamped = Math.min(Math.max(recall, 0), 1);
  return (1 - clamped) * PLOT_H;
}

/** An SVG `d` for a series.
 *
 * Fixed precision on purpose: these strings are generated during the server/export render
 * AND again in the browser, and a float that serialises differently in the two passes is a
 * hydration mismatch. Two decimals is well under a device pixel at this size. */
export function toPath(points: readonly CurvePoint[]): string {
  if (points.length === 0) return "";
  return points
    .map((p, i) => `${i === 0 ? "M" : "L"}${plotX(p.day).toFixed(2)} ${plotY(p.recall).toFixed(2)}`)
    .join(" ");
}

/** Sample days, spaced evenly in √-space so they come out evenly spaced on the drawn axis.
 * Uniform days would crowd the right-hand side and leave the first week jagged. */
const SAMPLES = 96;
function sampleDays(): number[] {
  const days: number[] = [];
  for (let i = 0; i <= SAMPLES; i += 1) {
    days.push((i / SAMPLES) ** 2 * HORIZON_DAYS);
  }
  return days;
}

/** The days the scheduler would ask for this concept again, within the horizon.
 *
 * `intervalFor(stability, 0.9)` is the same call the scheduler makes, so these are real
 * review dates rather than chosen ones - which is the whole point of computing the chart
 * instead of drawing it. Every review is graded Good: the chart describes a student who
 * keeps up, and claiming anything rosier than "answered correctly" would be fiction. */
function scheduleReviews(): { day: number; state: MemoryState }[] {
  const schedule: { day: number; state: MemoryState }[] = [];
  let state = initialState(GOOD, DEFAULT_PARAMS);
  let day = 0;

  // Bounded by the horizon, but also by a hard iteration cap: intervals grow fast enough
  // that this exits after three or four passes, and a cap means a future parameter refit
  // can never turn a landing page into an infinite loop at module load.
  for (let i = 0; i < 32; i += 1) {
    const gap = intervalFor(state.stability, TARGET_RETENTION, DEFAULT_PARAMS);
    if (!Number.isFinite(gap) || gap <= 0 || day + gap > HORIZON_DAYS) break;
    day += gap;
    state = nextState(state, GOOD, gap, DEFAULT_PARAMS);
    schedule.push({ day, state });
  }
  return schedule;
}

function buildCurve(): RetentionCurve {
  const first = initialState(GOOD, DEFAULT_PARAMS);
  const schedule = scheduleReviews();
  const days = sampleDays();

  const studiedOnce: CurvePoint[] = days.map((day) => ({
    day,
    recall: retrievability(first, day, DEFAULT_PARAMS),
  }));

  // The reviewed series is a sawtooth, so each review needs TWO points at the same day:
  // the decayed value it was answered at, then 1 immediately after. Emitting only one
  // would draw a diagonal across the spike and quietly misstate when the recovery happened.
  const reviewed: CurvePoint[] = [];
  let state = first;
  let segmentStart = 0;
  let cursor = 0;

  for (const review of schedule) {
    while (cursor < days.length && days[cursor] < review.day) {
      const day = days[cursor];
      reviewed.push({ day, recall: retrievability(state, day - segmentStart, DEFAULT_PARAMS) });
      cursor += 1;
    }
    reviewed.push({
      day: review.day,
      recall: retrievability(state, review.day - segmentStart, DEFAULT_PARAMS),
    });
    reviewed.push({ day: review.day, recall: 1 });
    state = review.state;
    segmentStart = review.day;
  }
  while (cursor < days.length) {
    const day = days[cursor];
    reviewed.push({ day, recall: retrievability(state, day - segmentStart, DEFAULT_PARAMS) });
    cursor += 1;
  }

  return {
    studiedOnce,
    reviewed,
    reviews: schedule.map(({ day }) => ({ day, recall: 1 })),
    endRecall: {
      studiedOnce: retrievability(first, HORIZON_DAYS, DEFAULT_PARAMS),
      reviewed: retrievability(state, HORIZON_DAYS - segmentStart, DEFAULT_PARAMS),
    },
  };
}

/** Computed once, when this module is first loaded. */
export const CURVE: RetentionCurve = buildCurve();

/** A recall probability as a whole percentage, for the labels on the chart. */
export function asPercent(recall: number): number {
  return Math.round(recall * 100);
}
