import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";
import { asPercent, CURVE, DAY_TICKS, toPath } from "@/lib/forgettingCurve";

/** What this guards is the CLAIM, not the styling: that the chart on the landing page shows
 * the geometry the scheduler produced, labels both endpoints, and still says the same thing
 * to a student who has asked their OS for less motion. */

const motionState = vi.hoisted(() => ({ reduceMotion: false }));

vi.mock("motion/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("motion/react")>();
  return { ...actual, useReducedMotion: () => motionState.reduceMotion };
});

const { default: RetentionCurve } = await import("@/components/RetentionCurve");

/** framer's whileInView needs an IntersectionObserver, which jsdom does not ship. A stub
 * that never reports an intersection is the right shape here: it leaves each animated
 * element parked on its `initial` state, which is exactly the case worth asserting. */
class NeverIntersecting implements IntersectionObserver {
  readonly root = null;
  readonly rootMargin = "";
  readonly thresholds: readonly number[] = [];
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

/** The two series, found by their precomputed `d` rather than by a test id - if the
 * geometry ever stops matching the library, that is the defect, not a selector miss. */
function series(container: HTMLElement) {
  const paths = Array.from(container.querySelectorAll("path"));
  return {
    reviewed: paths.find((p) => p.getAttribute("d") === toPath(CURVE.reviewed)),
    studiedOnce: paths.find((p) => p.getAttribute("d") === toPath(CURVE.studiedOnce)),
  };
}

async function draw() {
  const view = render(<RetentionCurve />);
  // useIsNative resolves on a microtask, and the draw only mounts once it reports web.
  await act(async () => {});
  return view;
}

describe("RetentionCurve", () => {
  beforeEach(() => {
    motionState.reduceMotion = false;
    vi.stubGlobal("IntersectionObserver", NeverIntersecting);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("draws both series, exactly as the scheduler computed them", async () => {
    const { container } = await draw();
    const { reviewed, studiedOnce } = series(container);
    expect(reviewed).toBeDefined();
    expect(studiedOnce).toBeDefined();
    // Neither may be empty: an empty `d` renders as a blank card that still reads as a chart.
    expect(reviewed!.getAttribute("d")!.length).toBeGreaterThan(100);
    expect(studiedOnce!.getAttribute("d")!.length).toBeGreaterThan(100);
  });

  it("marks every review the schedule produced", async () => {
    const { container } = await draw();
    expect(container.querySelectorAll("circle")).toHaveLength(CURVE.reviews.length);
  });

  it("labels both endpoints and the retention the scheduler aims at", async () => {
    const { container } = await draw();
    const text = container.textContent ?? "";
    expect(text).toContain(`${asPercent(CURVE.endRecall.reviewed)}%`);
    expect(text).toContain(`${asPercent(CURVE.endRecall.studiedOnce)}%`);
    expect(text).toContain("90%");
  });

  it("prints the real day under every gridline, so the square-root axis is disclosed", async () => {
    const { container } = await draw();
    const text = container.textContent ?? "";
    expect(text).toContain("day 0");
    for (const day of DAY_TICKS.slice(1)) expect(text).toContain(String(day));
  });

  it("says the whole comparison out loud for a screen reader", async () => {
    const { container } = await draw();
    const label = container.querySelector("svg")?.getAttribute("aria-label") ?? "";
    expect(label).toContain(String(asPercent(CURVE.endRecall.studiedOnce)));
    expect(label).toContain(String(asPercent(CURVE.endRecall.reviewed)));
  });

  it("animates the draw on the web", async () => {
    const { container } = await draw();
    // framer drives pathLength through the attribute of the same name.
    const { reviewed } = series(container);
    expect(reviewed!.hasAttribute("pathLength")).toBe(true);
  });

  it("hands the finished curve to anyone who asked for less motion", async () => {
    motionState.reduceMotion = true;
    const { container } = await draw();
    const { reviewed, studiedOnce } = series(container);
    // Same geometry, no partial draw to sit through.
    expect(reviewed!.hasAttribute("pathLength")).toBe(false);
    expect(studiedOnce!.hasAttribute("pathLength")).toBe(false);
    expect(container.querySelectorAll("circle")).toHaveLength(CURVE.reviews.length);
  });
});
