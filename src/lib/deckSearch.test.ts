import { describe, expect, it } from "vitest";
import { searchDecks } from "./deckSearch";
import type { Concept, Deck } from "./types";

function concept(label: string): Concept {
  return {
    id: `c-${label}`,
    concept: label,
    question: "Question?",
    answer: "Answer",
    distractor: "Not the answer",
    cloze: "The answer is _____.",
    explanation: "A paragraph about myocardium that must never be searched.",
  };
}

function deck(title: string, labels: string[] = []): Deck {
  return { id: `d-${title}`, title, createdAt: 1, concepts: labels.map(concept) };
}

const LIBRARY: Deck[] = [
  deck("Krebs Cycle — Lecture 4", ["Acetyl-CoA entry", "Oxidative decarboxylation"]),
  deck("Cardiac Cycle & Haemodynamics", ["Stroke volume", "Myocardium layers", "Préload"]),
  deck("The Norman Conquest", ["Harold Godwinson", "Stamford Bridge"]),
];

const titles = (decks: { deck: Deck }[]) => decks.map((m) => m.deck.title);

describe("searchDecks", () => {
  it("returns every deck, unfiltered and in order, for a blank query", () => {
    expect(titles(searchDecks(LIBRARY, ""))).toEqual(LIBRARY.map((d) => d.title));
    expect(titles(searchDecks(LIBRARY, "   "))).toEqual(LIBRARY.map((d) => d.title));
    expect(searchDecks(LIBRARY, "").every((m) => m.cardMatches === 0)).toBe(true);
  });

  it("matches a deck by title, case-insensitively", () => {
    expect(titles(searchDecks(LIBRARY, "krebs"))).toEqual(["Krebs Cycle — Lecture 4"]);
    expect(titles(searchDecks(LIBRARY, "NORMAN"))).toEqual(["The Norman Conquest"]);
  });

  it("matches a deck by what is IN it, which is the search a student actually runs", () => {
    const found = searchDecks(LIBRARY, "myocardium");
    expect(titles(found)).toEqual(["Cardiac Cycle & Haemodynamics"]);
    expect(found[0].cardMatches).toBe(1);
  });

  it("counts card matches separately from inclusion", () => {
    // "cycle" is in two TITLES and in no card label at all.
    const found = searchDecks(LIBRARY, "cycle");
    expect(titles(found)).toEqual(["Krebs Cycle — Lecture 4", "Cardiac Cycle & Haemodynamics"]);
    expect(found.map((m) => m.cardMatches)).toEqual([0, 0]);
  });

  it("ignores diacritics in both directions", () => {
    expect(titles(searchDecks(LIBRARY, "preload"))).toEqual(["Cardiac Cycle & Haemodynamics"]);
    expect(titles(searchDecks(LIBRARY, "préload"))).toEqual(["Cardiac Cycle & Haemodynamics"]);
  });

  it("requires every token, so a second word narrows rather than widens", () => {
    expect(titles(searchDecks(LIBRARY, "cycle lecture"))).toEqual(["Krebs Cycle — Lecture 4"]);
    expect(titles(searchDecks(LIBRARY, "cycle 1066"))).toEqual([]);
  });

  it("does not spread one query's tokens across a title and an unrelated card", () => {
    // "norman" is a title word in deck 3; "myocardium" is a card label in deck 2.
    // Neither deck holds both, so neither may be returned.
    expect(titles(searchDecks(LIBRARY, "norman myocardium"))).toEqual([]);
  });

  it("never searches explanation prose", () => {
    // Every card's explanation contains "myocardium"; only the deck whose LABEL
    // does may come back.
    expect(titles(searchDecks(LIBRARY, "paragraph"))).toEqual([]);
  });

  it("returns nothing for a query that matches nothing", () => {
    expect(searchDecks(LIBRARY, "photosynthesis")).toEqual([]);
  });

  it("handles an empty library", () => {
    expect(searchDecks([], "krebs")).toEqual([]);
  });
});
