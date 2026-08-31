import { describe, expect, it } from "vitest";
import { createRetrievalClock, latencyFor, markEntered } from "./retrievalClock";

describe("markEntered", () => {
  it("records the first entry", () => {
    const clock = createRetrievalClock();
    markEntered(clock, "c1::1::1", 1_000);
    expect(latencyFor(clock, "c1::1::1", 4_000)).toBe(3_000);
  });

  it("ignores a later entry for the same card", () => {
    const clock = createRetrievalClock();
    markEntered(clock, "c1::1::1", 1_000);
    // The student scrolled away and came back. Restarting the clock here would
    // turn a long deliberation into a suspiciously fast answer.
    markEntered(clock, "c1::1::1", 30_000);
    expect(latencyFor(clock, "c1::1::1", 31_000)).toBe(30_000);
  });

  it("keeps cards independent", () => {
    const clock = createRetrievalClock();
    markEntered(clock, "a::1::1", 1_000);
    markEntered(clock, "b::2::1", 5_000);
    expect(latencyFor(clock, "a::1::1", 6_000)).toBe(5_000);
    expect(latencyFor(clock, "b::2::1", 6_000)).toBe(1_000);
  });
});

describe("latencyFor", () => {
  it("reads the resolving card's own clock after the view has moved on", () => {
    // The regression this module exists for. The student reads a cloze for four
    // seconds, submits, and scrolls to the next card while the grade request is
    // still in flight. When the verdict lands, the card on screen is a different
    // one that entered a moment ago - and looking the latency up by "whatever is
    // in view" would credit the cloze with ~100ms, which grades EASY on a
    // production path and inflates stability on a card they laboured over.
    const clock = createRetrievalClock();
    markEntered(clock, "cloze-card::2::1", 10_000);
    markEntered(clock, "next-card::1::1", 14_000);

    const verdictLandedAt = 14_100;
    expect(latencyFor(clock, "cloze-card::2::1", verdictLandedAt)).toBe(4_100);
    // What the old index-based lookup would have reported instead.
    expect(latencyFor(clock, "next-card::1::1", verdictLandedAt)).toBe(100);
  });

  it("is unaffected by cards being spliced into the queue", () => {
    // A failed lane is requeued three slides ahead and Infinite Recall inserts
    // right after the current card, so every index after the insertion point
    // shifts. Keys do not move.
    const clock = createRetrievalClock();
    markEntered(clock, "seen::1::1", 2_000);
    for (const key of ["inserted-a::1::1", "inserted-b::2::1"]) {
      markEntered(clock, key, 9_000);
    }
    expect(latencyFor(clock, "seen::1::1", 5_000)).toBe(3_000);
  });

  it("returns 0 for a card that never entered the viewport", () => {
    const clock = createRetrievalClock();
    expect(latencyFor(clock, "never-seen::1::1", 5_000)).toBe(0);
  });

  it("never returns a negative latency", () => {
    const clock = createRetrievalClock();
    markEntered(clock, "c1::1::1", 5_000);
    expect(latencyFor(clock, "c1::1::1", 4_000)).toBe(0);
  });
});
