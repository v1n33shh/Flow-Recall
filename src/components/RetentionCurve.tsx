"use client";

import { motion, useReducedMotion } from "motion/react";
import { useIsNative } from "@/lib/useIsNative";
import {
  asPercent,
  CURVE,
  DAY_TICKS,
  PLOT_H,
  PLOT_W,
  plotX,
  plotY,
  TARGET_RETENTION,
  toPath,
} from "@/lib/forgettingCurve";

/** The forgetting curve, drawn from the scheduler that will actually schedule the student.
 *
 * Geometry and every number come from src/lib/forgettingCurve.ts, which computes them at
 * module load out of src/lib/fsrs.ts - so the paths below are server-rendered into the
 * initial HTML and this component adds no arithmetic of its own.
 *
 * PERFORMANCE CONTRACT (StreakCounter.tsx / PageTransition.tsx) says transform and opacity
 * only. The one-shot `pathLength` draw here is a deliberate, bounded exception, and the
 * bounds are the argument:
 *
 *   - It is a single 1.1s entrance on two short paths, fired once by whileInView, never a
 *     loop. The contract exists to stop per-frame repaints for the lifetime of a screen.
 *   - It is not blur and not box-shadow, which are the two the contract names.
 *   - The cheap Android phone the contract was written to protect NEVER RUNS IT: the draw
 *     is gated on `isNative === false`, exactly as the hero's grid and glow orbs already
 *     are in page.tsx. Native gets the finished curve, which is the half that carries the
 *     argument anyway.
 *   - prefers-reduced-motion gets the finished curve too.
 *
 * TEXT IS HTML, NOT <text>. Every label sits in an absolutely-positioned overlay rather
 * than inside the SVG, because the SVG scales from ~328px on a 360dp phone to ~760px on a
 * desktop and SVG type scales with it - a 13px label would render at 6px on the phone. As
 * HTML it gets ordinary responsive classes and the real design tokens. The SVG draws
 * nothing but geometry. */

// The box the overlay positions against: the plot, plus a left gutter for the 90% label, a
// right gutter for the two end labels, and a strip underneath for the day axis.
const PAD_LEFT = 72;
const PAD_TOP = 22;
const PAD_RIGHT = 72;
const PAD_BOTTOM = 44;
const VIEW_W = PAD_LEFT + PLOT_W + PAD_RIGHT;
const VIEW_H = PAD_TOP + PLOT_H + PAD_BOTTOM;

/** Plot coordinates as percentages of the whole viewBox, so an HTML label can be pinned to
 * a point on the curve and stay there at every width. */
function leftPct(day: number): string {
  return `${((PAD_LEFT + plotX(day)) / VIEW_W) * 100}%`;
}
function topPct(recall: number): string {
  return `${((PAD_TOP + plotY(recall)) / VIEW_H) * 100}%`;
}

const REVIEWED_PATH = toPath(CURVE.reviewed);
const STUDIED_ONCE_PATH = toPath(CURVE.studiedOnce);
const TARGET_Y = plotY(TARGET_RETENTION);
const DRAW = { duration: 1.1, ease: "easeInOut" as const };
const VIEWPORT = { once: true, margin: "-80px" } as const;

export default function RetentionCurve() {
  const reduceMotion = useReducedMotion();
  // null until resolved, so the first paint never guesses. The draw is mounted only once
  // this is known to be the web - see the contract note above.
  const isNative = useIsNative<boolean | null>(null);
  const draw = isNative === false && !reduceMotion;

  return (
    <div className="relative w-full">
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        className="h-auto w-full overflow-visible"
        role="img"
        aria-label={`Retention over six months. Studied once and never revisited, recall falls to ${asPercent(
          CURVE.endRecall.studiedOnce,
        )} percent. Reviewed on schedule ${CURVE.reviews.length} times, it holds at ${asPercent(
          CURVE.endRecall.reviewed,
        )} percent.`}
      >
        <g transform={`translate(${PAD_LEFT} ${PAD_TOP})`}>
          {/* Day gridlines. Unevenly spaced because the axis is √day - see plotX. */}
          {DAY_TICKS.map((day) => (
            <line
              key={`grid-${day}`}
              x1={plotX(day)}
              y1={0}
              x2={plotX(day)}
              y2={PLOT_H}
              className="stroke-foreground/[0.07]"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          ))}

          {/* Recall gridlines. The axis runs a full 0-100%, so the lower half is mostly
              empty by design - these give it structure and let a reader take a value off
              the chart instead of only comparing two shapes. */}
          {[0.25, 0.5, 0.75].map((recall) => (
            <line
              key={`recall-${recall}`}
              x1={0}
              y1={plotY(recall)}
              x2={PLOT_W}
              y2={plotY(recall)}
              className="stroke-foreground/[0.06]"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          ))}

          {/* Zero. Frames the plot and makes the uncropped axis visible as a fact. */}
          <line
            x1={0}
            y1={PLOT_H}
            x2={PLOT_W}
            y2={PLOT_H}
            className="stroke-foreground/15"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />

          {/* The line the scheduler aims at, and the definition of stability. */}
          <line
            x1={0}
            y1={TARGET_Y}
            x2={PLOT_W}
            y2={TARGET_Y}
            className="stroke-foreground/20"
            strokeWidth={1}
            strokeDasharray="3 5"
            vectorEffect="non-scaling-stroke"
          />

          {/* Studied once, never revisited. Dim, because it is the thing not to do. */}
          <CurveLine d={STUDIED_ONCE_PATH} draw={draw} dim />
          {/* Reviewed when asked. The only bright line on the chart. */}
          <CurveLine d={REVIEWED_PATH} draw={draw} />

          {/* Where the reviews land. Each is a tick down from the peak plus a dot on it, so
              the spikes read as events rather than as noise in the line. */}
          {CURVE.reviews.map((review, i) => (
            <motion.g
              key={`review-${review.day}`}
              initial={draw ? { opacity: 0, scale: 0.6 } : false}
              whileInView={draw ? { opacity: 1, scale: 1 } : undefined}
              viewport={VIEWPORT}
              transition={{ type: "spring", stiffness: 320, damping: 24, delay: 0.75 + i * 0.1 }}
              style={{ transformBox: "fill-box", transformOrigin: "center" }}
            >
              <circle
                cx={plotX(review.day)}
                cy={plotY(1)}
                r={4.5}
                className="fill-background stroke-foreground"
                strokeWidth={2}
                vectorEffect="non-scaling-stroke"
              />
            </motion.g>
          ))}
        </g>
      </svg>

      {/* ---- Labels. HTML, for the reasons in the docblock. ---- */}

      {/* The recall axis, in the left gutter. Only two marks: the target the scheduler
          aims at, and the midpoint that makes the scale legible.
          Anchored by their RIGHT edge to the plot's left edge, not by their left edge to
          the container. The gutter is 72 viewBox units, which is 80px of desktop but only
          24px at 360dp, so a left-aligned label outgrew it and sat on top of the first
          days of the curve. Right-aligned it can only ever grow away from the plot, into
          the figure's own padding. */}
      <span
        className="pointer-events-none absolute pr-2 text-[10px] font-medium tabular-nums text-muted-foreground sm:text-xs"
        style={{
          left: leftPct(0),
          top: topPct(TARGET_RETENTION),
          transform: "translate(-100%, -50%)",
        }}
      >
        {asPercent(TARGET_RETENTION)}%
      </span>
      <span
        className="pointer-events-none absolute pr-2 text-[10px] tabular-nums text-muted-foreground/60 sm:text-xs"
        style={{ left: leftPct(0), top: topPct(0.5), transform: "translate(-100%, -50%)" }}
      >
        50%
      </span>

      {/* The two endpoints, in the right gutter. The whole chart in two numbers. */}
      <span
        className="pointer-events-none absolute -translate-y-1/2 pl-2 text-[11px] font-semibold tabular-nums text-foreground sm:text-sm"
        style={{ left: leftPct(DAY_TICKS[DAY_TICKS.length - 1]), top: topPct(CURVE.endRecall.reviewed) }}
      >
        {asPercent(CURVE.endRecall.reviewed)}%
      </span>
      <span
        className="pointer-events-none absolute -translate-y-1/2 pl-2 text-[11px] font-medium tabular-nums text-muted-foreground sm:text-sm"
        style={{ left: leftPct(DAY_TICKS[DAY_TICKS.length - 1]), top: topPct(CURVE.endRecall.studiedOnce) }}
      >
        {asPercent(CURVE.endRecall.studiedOnce)}%
      </span>

      {/* The day axis. Real days under an axis that is not linear, which is what keeps the
          √ scale disclosed rather than quietly flattering. */}
      {DAY_TICKS.map((day, i) => (
        <span
          key={`tick-${day}`}
          className="pointer-events-none absolute text-[10px] tabular-nums text-muted-foreground/80 sm:text-xs"
          style={{
            left: leftPct(day),
            top: `${((PAD_TOP + PLOT_H + 12) / VIEW_H) * 100}%`,
            // Centred on its gridline, except at the two ends: the first would hang off the
            // left edge of the card and the last into the right gutter the end labels own.
            transform:
              i === 0
                ? undefined
                : i === DAY_TICKS.length - 1
                  ? "translateX(-100%)"
                  : "translateX(-50%)",
          }}
        >
          {i === 0 ? "day 0" : day}
        </span>
      ))}
    </div>
  );
}

/** One series. Split out so the draw-vs-static branch lives in exactly one place, and
 * module-level because react-hooks/static-components forbids defining it inside the render
 * body above. */
function CurveLine({ d, draw, dim = false }: { d: string; draw: boolean; dim?: boolean }) {
  const shared = {
    d,
    fill: "none" as const,
    // Deliberately NOT vector-effect="non-scaling-stroke", unlike every other stroke in
    // this file. Chrome measures a dash pattern in screen space when that is set, but
    // `pathLength` - which is how framer drives a draw-on - normalises in USER space, so
    // the two disagree by exactly the SVG's scale factor and the line stops short. It cost
    // an afternoon to find: at 1440px the chart scales by 1.12 and the curve rendered to
    // 1/1.12 = 89% of its length, ending just before the day-180 gridline while the dashed
    // 90% rule beside it (no pathLength, so no conflict) ran the full width. Letting these
    // two strokes scale with the chart is also the more correct chart-drawing behaviour:
    // line weight tracks the size of the thing it is drawn on.
    strokeWidth: dim ? 2 : 3,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className: dim ? "stroke-foreground/25" : "stroke-foreground",
  };
  if (!draw) return <path {...shared} />;
  return (
    <motion.path
      {...shared}
      initial={{ pathLength: 0 }}
      whileInView={{ pathLength: 1 }}
      viewport={VIEWPORT}
      transition={{ ...DRAW, delay: dim ? 0 : 0.18 }}
    />
  );
}
