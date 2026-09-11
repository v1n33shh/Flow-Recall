import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ContinuousProgress } from "@/lib/ingestChunks";
import ContinuationProgress from "@/components/ContinuationProgress";

// The library's half of a continuous run. Its states were driven on the device, but
// never asserted - and the one below that the device could not hold still long enough
// to notice is the first one here.

const progress: ContinuousProgress = {
  currentSection: 90,
  totalSections: 121,
  cardsSoFar: 267,
  waitingReason: null,
  stopping: false,
};

/** No default parameter on purpose: a JS default fires for an explicit `undefined`, so
 * `renderProgress(undefined)` would have rendered the running state and quietly tested
 * nothing - which is exactly what it did the first time. */
function renderProgress(p: ContinuousProgress | undefined) {
  const onStop = vi.fn();
  render(<ContinuationProgress progress={p} onStop={onStop} />);
  return onStop;
}

/** How full the bar is, 0 to 1, as the component actually set it.
 *
 * Reads the transform rather than the width: the fill is scaled, not resized, because
 * animating width lays out every frame and the performance contract forbids it. The
 * proportion being asserted is the same one as before that change. */
function barFill(): number {
  const bar = document.querySelector<HTMLElement>(".bg-accent");
  const match = /scaleX\(([\d.]+)\)/.exec(bar?.style.transform ?? "");
  return match ? Number(match[1]) : Number.NaN;
}

describe("before the runner's first tick", () => {
  it("does not claim to be finished", () => {
    // progress is undefined for the moment between the tap and the first tick, and
    // both counts fall back to 1 - which read "section 1 of 1" over a bar filled to
    // 100% at the start of a 386-section run.
    renderProgress(undefined);
    expect(screen.getByText("Starting...")).toBeTruthy();
    expect(screen.queryByText(/section 1 of 1/)).toBeNull();
    expect(barFill()).toBe(0);
  });

  it("still offers Stop, because the first request is already in flight", () => {
    const onStop = renderProgress(undefined);
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(onStop).toHaveBeenCalledOnce();
  });
});

describe("once it is running", () => {
  it("counts the section across the whole run, not within the batch", () => {
    renderProgress(progress);
    expect(screen.getByText(/Generating section 90 of 121/)).toBeTruthy();
    expect(barFill()).toBeCloseTo(0.74, 2);
  });

  it("reports only the cards already persisted", () => {
    // Anything not yet handed to onBatch would vanish if the app died, so counting it
    // would overstate what the student actually has.
    renderProgress(progress);
    expect(screen.getByText(/267 cards so far/)).toBeTruthy();
  });

  it("counts a single card as a card", () => {
    renderProgress({ ...progress, cardsSoFar: 1 });
    expect(screen.getByText(/1 card so far/)).toBeTruthy();
  });

  it("surfaces a rate-limit wait, because silence in a twenty-minute run reads as a hang", () => {
    renderProgress({ ...progress, waitingReason: "Rate limit - waiting 43s." });
    expect(screen.getByText("Rate limit - waiting 43s.")).toBeTruthy();
  });

  it("says it is stopping and refuses a second Stop", () => {
    const onStop = renderProgress({ ...progress, stopping: true });
    const stop = screen.getByRole("button", { name: /Finishing this section/ });
    expect((stop as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(stop);
    expect(onStop).not.toHaveBeenCalled();
    expect(screen.getByText(/finishing this section/)).toBeTruthy();
  });
});
