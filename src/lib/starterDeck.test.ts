import { describe, expect, it } from "vitest";
import { validateEdges, learningPath } from "@/lib/conceptGraph";
import {
  buildStarterDeck,
  isStarterDeck,
  STARTER_CONCEPT_MAP,
  STARTER_CONCEPTS,
  STARTER_DECK_ID,
  STARTER_USER_ID,
} from "@/lib/starterDeck";

/** This deck is shipped rather than generated, so nothing upstream validates it. Every
 * guarantee the rest of the app assumes about a deck has to be asserted here instead. */

const ids = new Set(STARTER_CONCEPTS.map((c) => c.id));

describe("the concepts", () => {
  it("ships twelve", () => {
    expect(STARTER_CONCEPTS).toHaveLength(12);
  });

  it("fills every field the card formats require", () => {
    for (const concept of STARTER_CONCEPTS) {
      // The swipe needs a claim and a plausible false one; the cloze needs a blank.
      for (const field of ["id", "concept", "question", "answer", "distractor", "cloze"] as const) {
        expect(concept[field], `${concept.id}.${field}`).toBeTruthy();
      }
      // The optional three are what the revision sheet and the map node sheet are for.
      // Absent is legal for a generated deck but would be a hole in a curated one.
      expect(concept.explanation, `${concept.id}.explanation`).toBeTruthy();
      expect(concept.misconception, `${concept.id}.misconception`).toBeTruthy();
      expect(concept.whyItMatters, `${concept.id}.whyItMatters`).toBeTruthy();
    }
  });

  it("leaves a blank in every cloze", () => {
    for (const concept of STARTER_CONCEPTS) {
      expect(concept.cloze, `${concept.id}.cloze`).toContain("_____");
    }
  });

  it("never claims a source it does not have", () => {
    // There is no uploaded material behind this deck. A sourceQuote would be invented
    // provenance - see the docblock in starterDeck.ts.
    for (const concept of STARTER_CONCEPTS) {
      expect(concept.sourceQuote, `${concept.id}.sourceQuote`).toBeUndefined();
    }
  });

  it("keeps ids unique", () => {
    expect(ids.size).toBe(STARTER_CONCEPTS.length);
  });

  it("keeps labels unique, which is what makes the map resolvable", () => {
    // validateEdges poisons a label it sees twice (it cannot know which card an edge
    // meant), so a duplicate label would silently drop edges pointing at it.
    const labels = new Set(STARTER_CONCEPTS.map((c) => c.concept.trim().toLowerCase()));
    expect(labels.size).toBe(STARTER_CONCEPTS.length);
  });

  it("never offers the same string as both the answer and the false option", () => {
    for (const concept of STARTER_CONCEPTS) {
      expect(concept.answer, `${concept.id}`).not.toBe(concept.distractor);
    }
  });
});

describe("the shipped concept map", () => {
  it("points only at concepts in this deck, and never at itself", () => {
    for (const edge of STARTER_CONCEPT_MAP) {
      expect(ids.has(edge.from), `from ${edge.from}`).toBe(true);
      expect(ids.has(edge.to), `to ${edge.to}`).toBe(true);
      expect(edge.from).not.toBe(edge.to);
    }
  });

  it("survives validateEdges unchanged", () => {
    // The real proof. validateEdges is what every generated map passes through, and it
    // silently DROPS anything it cannot resolve - so a hand-written map that loses an
    // edge here would draw a graph that quietly lies about the deck. Round-trip the
    // shipped edges through the same resolver the model's output goes through, by
    // expressing them the way the model does: keyed on labels.
    const byId = new Map(STARTER_CONCEPTS.map((c) => [c.id, c.concept]));
    const asLabels = STARTER_CONCEPT_MAP.map((edge) => ({
      from: byId.get(edge.from)!,
      to: byId.get(edge.to)!,
      relation: edge.relation as string,
    }));

    const kept = validateEdges(asLabels, STARTER_CONCEPTS);
    expect(kept).toHaveLength(STARTER_CONCEPT_MAP.length);
    expect(kept).toEqual([...STARTER_CONCEPT_MAP]);
  });

  it("orders into a learning path that covers every concept", () => {
    // The map screen lays nodes out in learningPath order; a concept missing from it
    // would still be drawn, but the deck would have no readable route through it.
    const path = learningPath([...ids], STARTER_CONCEPT_MAP);
    expect(new Set(path)).toEqual(ids);
  });

  it("names at least one confusable pair", () => {
    // "The trap" on the node sheet is the most exam-relevant thing the map shows, and a
    // deck about memory with no confusable pairs would be a poor demonstration of it.
    expect(STARTER_CONCEPT_MAP.filter((e) => e.relation === "contrast").length).toBeGreaterThan(0);
  });
});

describe("buildStarterDeck", () => {
  it("is owned by the reserved id, which is what keeps it out of the account", () => {
    const deck = buildStarterDeck();
    expect(deck.userId).toBe(STARTER_USER_ID);
    // syncNow pushes decks where userId is undefined or the signed-in user's. A reserved
    // owner satisfies neither, so this deck can never be uploaded.
    expect(deck.userId).not.toBeUndefined();
    expect(isStarterDeck(deck)).toBe(true);
  });

  it("carries no pending chunks, so the library never offers to generate a rest", () => {
    expect(buildStarterDeck().pendingChunks).toBeUndefined();
  });

  it("dates itself from the caller's clock", () => {
    const deck = buildStarterDeck(1_700_000_000_000);
    expect(deck.createdAt).toBe(1_700_000_000_000);
    expect(deck.updatedAt).toBe(1_700_000_000_000);
  });

  it("hands out a fresh copy each time", () => {
    // It goes into localStorage and gets mutated there - renamed, given an exam date. A
    // shared object would leak those edits back into the module constant.
    const a = buildStarterDeck();
    const b = buildStarterDeck();
    expect(a.concepts).not.toBe(b.concepts);
    expect(a.concepts[0]).not.toBe(b.concepts[0]);
    expect(a.conceptMap).not.toBe(b.conceptMap);
    a.concepts[0].concept = "mutated";
    expect(b.concepts[0].concept).not.toBe("mutated");
    expect(STARTER_CONCEPTS[0].concept).not.toBe("mutated");
  });

  it("keeps a stable id, so seeding twice cannot make two of it", () => {
    expect(buildStarterDeck().id).toBe(STARTER_DECK_ID);
    expect(buildStarterDeck().id).toBe(buildStarterDeck().id);
  });

  it("does not think an ordinary deck is the starter", () => {
    expect(isStarterDeck({})).toBe(false);
    expect(isStarterDeck({ userId: "user_123" })).toBe(false);
  });
});
