import { describe, expect, it } from "vitest";
import type { Concept, ConceptEdge } from "@/lib/types";
import { MAX_PER_ROW, groupForConcept, learningPath, validateEdges } from "./conceptGraph";

function makeConcept(id: string, label: string): Concept {
  return {
    id,
    concept: label,
    question: `What about ${label}?`,
    answer: `Answer ${id}`,
    distractor: `Distractor ${id}`,
    cloze: `The answer is _____ for ${label}.`,
  };
}

const preload = makeConcept("p", "Preload");
const starling = makeConcept("s", "Frank-Starling Mechanism");
const stroke = makeConcept("v", "Stroke Volume");
const deck = [preload, starling, stroke];

describe("validateEdges", () => {
  it("resolves the model's labels to concept ids", () => {
    const edges = validateEdges(
      [{ from: "Preload", to: "Frank-Starling Mechanism", relation: "prerequisite" }],
      deck,
    );
    expect(edges).toEqual([{ from: "p", to: "s", relation: "prerequisite" }]);
  });

  it("matches a label through casing, an article and a plural s", () => {
    const edges = validateEdges(
      [{ from: "the preloads", to: "stroke volume", relation: "explains" }],
      deck,
    );
    expect(edges).toEqual([{ from: "p", to: "v", relation: "explains" }]);
  });

  it("drops an edge naming a concept the deck does not contain", () => {
    expect(
      validateEdges([{ from: "Preload", to: "Afterload", relation: "prerequisite" }], deck),
    ).toEqual([]);
  });

  // The device pass asked the real model to map a real 3-concept deck and it
  // answered "Franks-Starling Mechanism" - one stray letter, inside a hyphenated
  // word, on the one relationship the deck actually has. Dropping that edge left
  // the sheet telling the student these ideas "do not lean on each other", which
  // is a confident falsehood the model had not made.
  it("resolves a label the model misspelt inside a hyphenated word", () => {
    const edges = validateEdges(
      [{ from: "Franks-Starling Mechanism", to: "Stroke Volume", relation: "explains" }],
      deck,
    );
    expect(edges).toEqual([{ from: "s", to: "v", relation: "explains" }]);
  });

  it("resolves a hyphen the model wrote as a space", () => {
    const edges = validateEdges(
      [{ from: "Frank Starling Mechanism", to: "Stroke Volume", relation: "explains" }],
      deck,
    );
    expect(edges).toEqual([{ from: "s", to: "v", relation: "explains" }]);
  });

  it("drops a near label rather than guessing, because ATP and ADP are not each other", () => {
    const atp = makeConcept("a1", "ATP Yield");
    expect(
      validateEdges([{ from: "ADP Yield", to: "Preload", relation: "explains" }], [...deck, atp]),
    ).toEqual([]);
  });

  it("drops an edge naming a label two cards share, rather than guessing", () => {
    const twin = makeConcept("p2", "Preload");
    const edges = validateEdges(
      [
        { from: "Preload", to: "Stroke Volume", relation: "explains" },
        { from: "Frank-Starling Mechanism", to: "Stroke Volume", relation: "explains" },
      ],
      [...deck, twin],
    );
    expect(edges).toEqual([{ from: "s", to: "v", relation: "explains" }]);
  });

  it("drops self-edges and unknown relations", () => {
    expect(
      validateEdges(
        [
          { from: "Preload", to: "Preload", relation: "prerequisite" },
          { from: "Preload", to: "Stroke Volume", relation: "related_to" },
        ],
        deck,
      ),
    ).toEqual([]);
  });

  it("keeps both directions of a prerequisite, because reversing it changes the claim", () => {
    const edges = validateEdges(
      [
        { from: "Preload", to: "Stroke Volume", relation: "prerequisite" },
        { from: "Stroke Volume", to: "Preload", relation: "prerequisite" },
      ],
      deck,
    );
    expect(edges).toHaveLength(2);
  });

  it("collapses a contrast asserted in both directions into one edge", () => {
    const edges = validateEdges(
      [
        { from: "Preload", to: "Stroke Volume", relation: "contrast" },
        { from: "Stroke Volume", to: "Preload", relation: "contrast" },
      ],
      deck,
    );
    expect(edges).toEqual([{ from: "p", to: "v", relation: "contrast" }]);
  });

  it("drops a repeat of an identical edge", () => {
    const twice = [
      { from: "Preload", to: "Stroke Volume", relation: "explains" },
      { from: "Preload", to: "Stroke Volume", relation: "explains" },
    ];
    expect(validateEdges(twice, deck)).toHaveLength(1);
  });
});

describe("groupForConcept", () => {
  const edges: ConceptEdge[] = [
    { from: "p", to: "s", relation: "prerequisite" },
    { from: "s", to: "v", relation: "explains" },
    { from: "s", to: "p", relation: "contrast" },
  ];

  it("reads one edge as 'build on first' from the end that needs it", () => {
    expect(groupForConcept("s", edges).prerequisites).toEqual(["p"]);
    expect(groupForConcept("p", edges).prerequisites).toEqual([]);
  });

  it("reads an explains edge only from the mechanism's end", () => {
    expect(groupForConcept("s", edges).explains).toEqual(["v"]);
    expect(groupForConcept("v", edges).explains).toEqual([]);
  });

  it("reads a contrast from either end", () => {
    expect(groupForConcept("s", edges).contrasts).toEqual(["p"]);
    expect(groupForConcept("p", edges).contrasts).toEqual(["s"]);
  });

  it("caps a row so it cannot push the concept's own text off the screen", () => {
    const many: ConceptEdge[] = Array.from({ length: MAX_PER_ROW + 3 }, (_, i) => ({
      from: `x${i}`,
      to: "s",
      relation: "prerequisite" as const,
    }));
    expect(groupForConcept("s", many).prerequisites).toHaveLength(MAX_PER_ROW);
  });
});

describe("learningPath", () => {
  it("puts a prerequisite before the concept that needs it", () => {
    const path = learningPath(["v", "s", "p"], [
      { from: "p", to: "s", relation: "prerequisite" },
      { from: "s", to: "v", relation: "prerequisite" },
    ]);
    expect(path).toEqual(["p", "s", "v"]);
  });

  it("keeps deck order among concepts nothing blocks", () => {
    expect(learningPath(["a", "b", "c"], [])).toEqual(["a", "b", "c"]);
  });

  it("ignores explains and contrast, which say nothing about sequence", () => {
    const path = learningPath(["b", "a"], [
      { from: "a", to: "b", relation: "explains" },
      { from: "a", to: "b", relation: "contrast" },
    ]);
    expect(path).toEqual(["b", "a"]);
  });

  it("ignores an edge pointing outside the deck", () => {
    expect(learningPath(["a"], [{ from: "ghost", to: "a", relation: "prerequisite" }])).toEqual([
      "a",
    ]);
  });

  it("emits every concept exactly once even when the model asserts a cycle", () => {
    const path = learningPath(["a", "b", "c"], [
      { from: "a", to: "b", relation: "prerequisite" },
      { from: "b", to: "a", relation: "prerequisite" },
      { from: "b", to: "c", relation: "prerequisite" },
    ]);
    expect([...path].sort()).toEqual(["a", "b", "c"]);
    expect(path).toHaveLength(3);
    // Broken at the earliest node in deck order, so c still comes after b.
    expect(path.indexOf("b")).toBeLessThan(path.indexOf("c"));
  });

  it("is stable: the same deck and edges give the same path", () => {
    const edges: ConceptEdge[] = [{ from: "c", to: "a", relation: "prerequisite" }];
    const first = learningPath(["a", "b", "c"], edges);
    expect(learningPath(["a", "b", "c"], edges)).toEqual(first);
    expect(first).toEqual(["b", "c", "a"]);
  });

  it("does not emit a duplicated concept id twice", () => {
    expect(learningPath(["a", "a", "b"], [])).toEqual(["a", "b"]);
  });
});
