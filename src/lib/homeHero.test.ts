import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Concept, Deck } from "@/lib/types";

// getProgress reads localStorage, which does not exist in the node project this file runs
// in. Mocked at the module boundary so the DECISION can be tested without a DOM - the
// whole reason chooseHero is a pure function in lib rather than logic inside a component.
const store = vi.hoisted(() => new Map<string, number>());
vi.mock("@/lib/storage", () => ({
  getProgress: (deckId: string) => {
    const answered = store.get(deckId);
    if (answered === undefined) return null;
    // Two lanes per concept, which is what a real saved session holds - the count must be
    // of distinct CONCEPTS, not of answered lanes.
    const resolvedKeys = Array.from({ length: answered }, (_, i) => [`c${i}::swipe`, `c${i}::cloze`]).flat();
    return { deckId, masteredIds: [], resolvedKeys, queue: [] };
  },
}));

const { chooseHero, deckProgress } = await import("@/lib/homeHero");

function concept(i: number): Concept {
  return {
    id: `c${i}`,
    concept: `Concept ${i}`,
    question: "q",
    answer: "a",
    distractor: "d",
    cloze: "_____",
  };
}

function deck(id: string, size: number, touchedAt = 1000): Deck {
  return {
    id,
    title: id,
    createdAt: touchedAt,
    updatedAt: touchedAt,
    concepts: Array.from({ length: size }, (_, i) => concept(i)),
  };
}

describe("chooseHero", () => {
  beforeEach(() => store.clear());
  afterEach(() => store.clear());

  it("leads with the projection whenever the engine has one", () => {
    // It is the best number in the app and outranks every local count.
    expect(chooseHero({ decks: [deck("a", 10)], hasProjection: true })).toEqual({
      kind: "projection",
    });
  });

  it("prefers the projection even with no decks at all", () => {
    expect(chooseHero({ decks: [], hasProjection: true }).kind).toBe("projection");
  });

  it("says nothing when there is nothing true to say", () => {
    expect(chooseHero({ decks: [], hasProjection: false })).toEqual({ kind: "empty" });
  });

  it("treats a deck with no concepts as nothing to lead with", () => {
    expect(chooseHero({ decks: [deck("a", 0)], hasProjection: false }).kind).toBe("empty");
  });

  it("counts local progress when the engine has nothing - which needs no account", () => {
    store.set("a", 3);
    expect(chooseHero({ decks: [deck("a", 12)], hasProjection: false })).toMatchObject({
      kind: "progress",
      answered: 3,
      total: 12,
    });
  });

  it("falls back to what is waiting when a deck is untouched", () => {
    expect(chooseHero({ decks: [deck("a", 12)], hasProjection: false })).toMatchObject({
      kind: "waiting",
      total: 12,
    });
  });

  it("picks the deck that is started but unfinished over a newer untouched one", () => {
    // The one they are in the middle of is what "keep going" means, even if they made
    // another deck since.
    store.set("started", 4);
    const decks = [deck("started", 12, 500), deck("fresh", 30, 9000)];
    expect(chooseHero({ decks, hasProjection: false })).toMatchObject({
      kind: "progress",
      answered: 4,
    });
    expect(chooseHero({ decks, hasProjection: false })).toHaveProperty("deck.id", "started");
  });

  it("does not call a finished deck 'in progress'", () => {
    // Fully answered is not something to keep going with; the newest deck wins instead.
    store.set("done", 12);
    const decks = [deck("done", 12, 500), deck("newer", 8, 9000)];
    const hero = chooseHero({ decks, hasProjection: false });
    expect(hero.kind).toBe("waiting");
    expect(hero).toHaveProperty("deck.id", "newer");
  });

  it("falls back to the most recently touched deck when none is mid-flight", () => {
    const decks = [deck("old", 5, 100), deck("recent", 7, 9999)];
    expect(chooseHero({ decks, hasProjection: false })).toHaveProperty("deck.id", "recent");
  });
});

describe("deckProgress", () => {
  beforeEach(() => store.clear());

  it("is zero for a deck never opened", () => {
    expect(deckProgress(deck("a", 10))).toBe(0);
  });

  it("never exceeds the deck, however stale the saved session is", () => {
    // A deck edited down after a session was saved would otherwise render "14 of 10".
    store.set("a", 14);
    expect(deckProgress(deck("a", 10))).toBe(10);
  });

  it("counts a concept once even though it has two lanes", () => {
    // The mock writes both a swipe and a cloze key per concept. Counting keys rather
    // than concepts would double every number on the home screen.
    store.set("a", 3);
    expect(deckProgress(deck("a", 12))).toBe(3);
  });
});
