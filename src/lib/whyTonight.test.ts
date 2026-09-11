import { describe, expect, it } from "vitest";
import type { SessionPlan } from "@/lib/sessionBuilder";
import { whyTonight } from "@/lib/whyTonight";

function plan(over: Partial<SessionPlan> = {}): SessionPlan {
  return {
    items: [],
    estimatedMinutes: 20,
    slipping: 0,
    urgent: 0,
    fresh: 0,
    building: 0,
    resting: 0,
    deckCount: 1,
    deferred: 0,
    ...over,
  };
}
const cards = (n: number) => Array.from({ length: n }) as SessionPlan["items"];

describe("the explanation matches the session", () => {
  it("explains desirable difficulty for a slipping session", () => {
    expect(whyTonight(plan({ items: cards(9), slipping: 9 }))!.body).toMatch(/fade|harder/i);
  });

  it("explains the testing effect for a session of new cards", () => {
    // A paragraph about spacing over a session with nothing to space would be wrong,
    // which is the whole reason this is keyed to the plan rather than rotating freely.
    const why = whyTonight(plan({ items: cards(9), fresh: 9 }))!;
    expect(why.body).toMatch(/asked first|attempt/i);
    expect(why.body).not.toMatch(/faded|decayed/i);
  });

  it("explains the mastery bar for a still-building session", () => {
    expect(whyTonight(plan({ items: cards(4), building: 4 }))!.body).toMatch(/second way|week/i);
  });

  it("explains the restraint when nothing is asked", () => {
    // The engine's most counter-intuitive behaviour - silence here reads as a bug.
    const why = whyTonight(plan({ items: [], resting: 12 }))!;
    expect(why.title).toMatch(/not asking/i);
    expect(why.body).toMatch(/left alone|barely strengthens/i);
  });

  it("says nothing at all when there is nothing to explain", () => {
    // No session and nothing resting: an empty library. Inventing an explanation for a
    // decision that was never made would be filler.
    expect(whyTonight(plan({ items: [] }))).toBeNull();
  });
});

describe("ranking follows the statement above it", () => {
  it("prefers the urgent explanation when both urgent and slipping are present", () => {
    const why = whyTonight(plan({ items: cards(20), urgent: 3, slipping: 11 }))!;
    expect(why.title).toBe("Why these first");
  });
});

describe("house rules", () => {
  const all = [
    plan({ items: cards(3), urgent: 3 }),
    plan({ items: cards(3), slipping: 3 }),
    plan({ items: cards(3), fresh: 3 }),
    plan({ items: cards(3), building: 3 }),
    plan({ items: [], resting: 3 }),
  ].map((p) => whyTonight(p)!);

  it("attributes nothing to anybody, like BRAIN_FACTS", () => {
    for (const why of all) {
      expect(why.body).not.toMatch(/["“”]/);
      expect(why.body).not.toMatch(/[—–-]\s*[A-Z][a-z]+\s+[A-Z]/);
    }
  });

  it("stays short enough to read before starting", () => {
    for (const why of all) {
      expect(why.body.length).toBeLessThanOrEqual(260);
      expect(why.title.length).toBeLessThanOrEqual(32);
    }
  });

  it("gives every branch a distinct explanation", () => {
    expect(new Set(all.map((w) => w.body)).size).toBe(all.length);
  });
});
