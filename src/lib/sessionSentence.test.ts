import { describe, expect, it } from "vitest";
import type { SessionPlan } from "@/lib/sessionBuilder";
import { sessionSentence } from "@/lib/sessionSentence";

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

// `items` only ever needs a length here - the sentence never looks inside it.
const cards = (n: number) => Array.from({ length: n }) as SessionPlan["items"];

describe("what it leads with", () => {
  it("puts what is nearly gone above everything else", () => {
    const s = sessionSentence(plan({ items: cards(30), urgent: 3, slipping: 11, fresh: 97 }));
    expect(s.lead).toBe("Three questions are nearly gone.");
  });

  it("falls to slipping when nothing is urgent", () => {
    const s = sessionSentence(plan({ items: cards(30), slipping: 11, fresh: 97 }));
    expect(s.lead).toBe("Eleven questions are slipping.");
  });

  it("falls to new when nothing is slipping", () => {
    const s = sessionSentence(plan({ items: cards(30), fresh: 8 }));
    expect(s.lead).toBe("Eight questions you have not met yet.");
    expect(s.offer).toContain("starts them");
  });

  it("has something to say about a session that is only still-building", () => {
    // The state the home screen is in the moment a student finishes a session.
    const s = sessionSentence(plan({ items: cards(6), building: 6 }));
    expect(s.lead).toBe("Six questions are still building.");
    expect(s.offer).toContain("moves them on");
  });
});

describe("questions, not concepts", () => {
  // slipping/urgent/fresh/building count selected CARDS, and one concept contributes two
  // of them. Calling them concepts put this count directly above the projection's concept
  // count and the screen contradicted itself on device: "Eleven concepts are nearly gone"
  // over "Of the 9 you have studied".
  it("never calls a card count a concept count", () => {
    for (const p of [
      plan({ items: cards(11), urgent: 11 }),
      plan({ items: cards(11), slipping: 11 }),
      plan({ items: cards(11), fresh: 11 }),
      plan({ items: cards(11), building: 11 }),
    ]) {
      expect(sessionSentence(p).lead).not.toMatch(/concept/i);
    }
  });

  it("still says concepts for resting, which genuinely is one", () => {
    expect(sessionSentence(plan({ items: [], resting: 4 })).offer).toMatch(/concepts/i);
  });
});

describe("the card count never appears", () => {
  it("is absent from a large session, which is the whole point", () => {
    // "Start 108 cards" was the complaint. 108 is a wall; twenty minutes is an evening.
    const s = sessionSentence(plan({ items: cards(108), slipping: 11, estimatedMinutes: 20 }));
    expect(s.lead).not.toContain("108");
    expect(s.offer).not.toContain("108");
    expect(s.offer).toBe("Twenty minutes clears them.");
  });
});

describe("numbers as words", () => {
  it("spells counts up to fifteen", () => {
    expect(sessionSentence(plan({ items: cards(2), slipping: 2 })).lead).toBe(
      "Two questions are slipping.",
    );
    expect(sessionSentence(plan({ items: cards(15), slipping: 15 })).lead).toBe(
      "Fifteen questions are slipping.",
    );
  });

  it("stays numeric above that, where spelling out reads as twee", () => {
    expect(sessionSentence(plan({ items: cards(42), slipping: 42 })).lead).toBe(
      "42 questions are slipping.",
    );
  });

  it("agrees with itself about one", () => {
    const s = sessionSentence(plan({ items: cards(1), slipping: 1 }));
    expect(s.lead).toBe("One question is slipping.");
  });

  it("says 'a minute' rather than 'one minutes'", () => {
    expect(sessionSentence(plan({ items: cards(1), slipping: 1, estimatedMinutes: 1 })).offer).toBe(
      "A minute clears them.",
    );
  });

  it("keeps an odd budget numeric rather than inventing a word for it", () => {
    expect(
      sessionSentence(plan({ items: cards(9), slipping: 9, estimatedMinutes: 37 })).offer,
    ).toBe("37 minutes clears them.");
  });
});

describe("an empty session", () => {
  it("treats resting as the good news it is, not as an absence", () => {
    const s = sessionSentence(plan({ items: [], resting: 12 }));
    expect(s.lead).toBe("Nothing needs you tonight.");
    expect(s.offer).toContain("resting");
    expect(s.offer).toContain("solidly");
  });

  it("says something true when there is nothing resting either", () => {
    const s = sessionSentence(plan({ items: [], resting: 0 }));
    expect(s.lead).toBe("Nothing is due tonight.");
    expect(s.offer).toBeTruthy();
  });
});

describe("every branch produces a real sentence", () => {
  const cases: SessionPlan[] = [
    plan({ items: cards(5), urgent: 5 }),
    plan({ items: cards(5), slipping: 5 }),
    plan({ items: cards(5), fresh: 5 }),
    plan({ items: cards(5), building: 5 }),
    plan({ items: [], resting: 3 }),
    plan({ items: [] }),
  ];

  it("never renders undefined, an empty string, or a stray full stop", () => {
    for (const p of cases) {
      const s = sessionSentence(p);
      expect(s.lead.length).toBeGreaterThan(4);
      expect(s.lead.endsWith(".")).toBe(true);
      expect(s.lead).not.toContain("undefined");
      expect(s.lead).not.toContain("NaN");
      if (s.offer !== null) {
        expect(s.offer).not.toContain("undefined");
        expect(s.offer).not.toContain("NaN");
      }
    }
  });
});
