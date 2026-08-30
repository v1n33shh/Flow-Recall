import { describe, expect, it } from "vitest";
import {
  clampDim,
  DIM_MAX,
  DIM_MIN,
  DIM_STEP,
  eyeFilterColor,
  isEyeFilterActive,
  WARMTH_IDS,
  type EyeFilterWarmth,
} from "./eyeFilter";

// --- WCAG contrast, so the legibility claims in eyeFilter.ts's DIM_MAX comment
// are checked rather than asserted. Test-only: the app never needs to compute a
// contrast ratio at runtime.

function channel(v: number): number {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function luminance([r, g, b]: [number, number, number]): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a: [number, number, number], b: [number, number, number]): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function parse(color: string): [number, number, number] {
  const m = color.match(/rgb\((\d+), (\d+), (\d+)\)/);
  if (!m) throw new Error(`not an rgb() string: ${color}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** What `mix-blend-mode: multiply` does to one colour, per channel. */
function multiply(base: [number, number, number], filter: string): [number, number, number] {
  const f = parse(filter);
  return [0, 1, 2].map((i) => (base[i] * f[i]) / 255) as [number, number, number];
}

// The reader's actual body text and page, from globals.css.
const TEXT: [number, number, number] = [250, 250, 250];
const PAGE: [number, number, number] = [5, 5, 5];

describe("eyeFilterColor", () => {
  it("renders nothing at all when the filter is off", () => {
    expect(eyeFilterColor({ warmth: "off", dim: 0 })).toBeNull();
    expect(isEyeFilterActive({ warmth: "off", dim: 0 })).toBe(false);
  });

  it("is active as soon as either axis moves", () => {
    expect(isEyeFilterActive({ warmth: "soft", dim: 0 })).toBe(true);
    expect(isEyeFilterActive({ warmth: "off", dim: DIM_STEP })).toBe(true);
  });

  it("cuts blue hardest and leaves red alone - that ordering IS the filter", () => {
    const [r, g, b] = parse(eyeFilterColor({ warmth: "amber", dim: 0 })!);
    expect(r).toBe(255);
    expect(g).toBeLessThan(r);
    expect(b).toBeLessThan(g);
  });

  it("warms monotonically across the steps", () => {
    const blues = WARMTH_IDS.map((warmth: EyeFilterWarmth) => {
      const color = eyeFilterColor({ warmth, dim: DIM_STEP });
      return parse(color!)[2];
    });
    for (let i = 1; i < blues.length; i++) expect(blues[i]).toBeLessThan(blues[i - 1]);
  });

  it("dims all three channels equally, so dim alone adds no hue", () => {
    const [r, g, b] = parse(eyeFilterColor({ warmth: "off", dim: DIM_MAX })!);
    expect(r).toBe(g);
    expect(g).toBe(b);
    expect(r).toBeLessThan(255);
  });
});

describe("the DIM_MAX legibility floor", () => {
  it("keeps body text past WCAG AA at the darkest non-amber setting", () => {
    const filter = eyeFilterColor({ warmth: "off", dim: DIM_MAX })!;
    expect(contrast(multiply(TEXT, filter), multiply(PAGE, filter))).toBeGreaterThanOrEqual(4.5);
  });

  it("sits just above the floor, not comfortably clear of it", () => {
    // What makes DIM_MAX a measured cap rather than a round number: there is
    // barely a step of headroom left. Raising the cap drops this under 4.5;
    // weakening the filter pushes it over 5.5. Either way the comment in
    // eyeFilter.ts would be stale, and this fails.
    const filter = eyeFilterColor({ warmth: "off", dim: DIM_MAX })!;
    const ratio = contrast(multiply(TEXT, filter), multiply(PAGE, filter));
    expect(ratio).toBeGreaterThanOrEqual(4.5);
    expect(ratio).toBeLessThan(5.5);
  });

  it("is enforced where the colour is built, not just by the stepper's bounds", () => {
    // A dim value can reach eyeFilterColor from localStorage as easily as from
    // the UI, so the cap has to hold on the render path too - otherwise a
    // hand-edited preference could black the page out.
    expect(eyeFilterColor({ warmth: "off", dim: DIM_MAX + DIM_STEP })).toBe(
      eyeFilterColor({ warmth: "off", dim: DIM_MAX }),
    );
    expect(eyeFilterColor({ warmth: "off", dim: 500 })).toBe(eyeFilterColor({ warmth: "off", dim: DIM_MAX }));
  });

  it("documents the one combination that is knowingly under AA", () => {
    // Amber at full dim lands ~3.5:1. Disclosed, not prevented: it is a
    // deliberate one-tap-reversible choice by someone who asked for a darker
    // page. If a change ever brings this back over AA, the comment is stale.
    const darkest = eyeFilterColor({ warmth: "amber", dim: DIM_MAX })!;
    expect(contrast(multiply(TEXT, darkest), multiply(PAGE, darkest))).toBeLessThan(4.5);
  });
});

describe("clampDim", () => {
  it("holds the bounds", () => {
    expect(clampDim(-20)).toBe(DIM_MIN);
    expect(clampDim(999)).toBe(DIM_MAX);
  });

  it("rounds, and refuses a non-finite value rather than blanking the page", () => {
    expect(clampDim(12.4)).toBe(12);
    expect(clampDim(NaN)).toBe(DIM_MIN);
    expect(clampDim(Infinity)).toBe(DIM_MIN);
  });
});
