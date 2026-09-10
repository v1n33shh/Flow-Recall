import { describe, expect, it } from "vitest";
import type { Concept, ConceptEdge } from "@/lib/types";
import {
  MAX_PER_ROW,
  contrastPairs,
  groupForConcept,
  MAX_CHAIN,
  keystone,
  prerequisiteChain,
  learningPath,
  validateEdges,
} from "./conceptGraph";

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

describe("contrastPairs", () => {
  const ids = deck.map((c) => c.id); // p, s, v - deck order

  const edge = (from: string, to: string, relation: ConceptEdge["relation"] = "contrast"): ConceptEdge => ({
    from,
    to,
    relation,
  });

  it("finds the pairs a student actually mixes up", () => {
    expect(contrastPairs(ids, [edge("p", "v"), edge("s", "v")])).toEqual([
      ["p", "v"],
      ["s", "v"],
    ]);
  });

  it("ignores the two relations that are not symmetric", () => {
    // prerequisite and explains have a direction and belong to the learning path;
    // reading them as confusable pairs would invent a warning the model never gave.
    expect(contrastPairs(ids, [edge("p", "s", "prerequisite"), edge("s", "v", "explains")])).toEqual([]);
  });

  it("shows a pair once however many directions it was asserted in", () => {
    expect(contrastPairs(ids, [edge("p", "v"), edge("v", "p")])).toEqual([["p", "v"]]);
  });

  it("puts the earlier concept of each pair first, whichever way the edge points", () => {
    // Otherwise the same pair reads "Stroke Volume vs Preload" on one render and the
    // reverse on the next, depending only on which way the model happened to type it.
    expect(contrastPairs(ids, [edge("v", "p")])).toEqual([["p", "v"]]);
  });

  it("orders by deck position, so the list does not reshuffle between visits", () => {
    const shuffled = [edge("s", "v"), edge("p", "s"), edge("p", "v")];
    expect(contrastPairs(ids, shuffled)).toEqual([
      ["p", "s"],
      ["p", "v"],
      ["s", "v"],
    ]);
  });

  it("drops an edge naming a card the deck no longer holds", () => {
    // validateEdges cannot catch this one: it ran when the card still existed, and the
    // student deleted it afterwards. A pair naming a concept that is gone is unopenable.
    expect(contrastPairs(ids, [edge("p", "deleted"), edge("p", "v")])).toEqual([["p", "v"]]);
  });

  it("ignores an edge from a concept to itself", () => {
    expect(contrastPairs(ids, [edge("p", "p")])).toEqual([]);
  });

  it("answers with nothing for a deck that was never mapped", () => {
    expect(contrastPairs(ids, [])).toEqual([]);
  });
});

// The one line that turns the map from a diagram into advice. Everything about it is
// a judgement about what a student should do next, so every judgement gets a test.
describe("keystone", () => {
  const prereq = (from: string, to: string): ConceptEdge => ({ from, to, relation: "prerequisite" });
  const weakEverywhere = () => true;

  it("names the weak concept the most other concepts lean on", () => {
    // a holds up b and c; d holds up nothing.
    const found = keystone(["a", "b", "c", "d"], [prereq("a", "b"), prereq("a", "c")], weakEverywhere);
    expect(found).toEqual({ id: "a", dependents: 2 });
  });

  // Out-degree would rank a fan-out of two above a chain of nine, which is exactly
  // backwards: everything downstream falls over, not just the next thing along.
  it("counts dependents transitively, not as a fan-out", () => {
    const chain = [prereq("a", "b"), prereq("b", "c"), prereq("c", "d")];
    const fan = [prereq("x", "y"), prereq("x", "z")];
    const found = keystone(["a", "b", "c", "d", "x", "y", "z"], [...chain, ...fan], weakEverywhere);
    expect(found).toEqual({ id: "a", dependents: 3 });
  });

  it("ignores concepts the student already has solid", () => {
    const isWeak = (id: string) => id !== "a";
    const found = keystone(["a", "b", "c"], [prereq("a", "b"), prereq("b", "c")], isWeak);
    expect(found).toEqual({ id: "b", dependents: 1 });
  });

  // A weak concept holding nothing up is the scheduler's business, not the map's.
  it("says nothing when the only weak concepts are leaves", () => {
    expect(keystone(["a", "b"], [prereq("a", "b")], (id) => id === "b")).toBeNull();
  });

  it("says nothing when every load-bearing concept is solid", () => {
    expect(keystone(["a", "b"], [prereq("a", "b")], () => false)).toBeNull();
  });

  it("says nothing about a deck with no prerequisites at all", () => {
    expect(keystone(["a", "b"], [{ from: "a", to: "b", relation: "contrast" }], weakEverywhere)).toBeNull();
  });

  it("breaks a tie by deck order, so the same deck always names the same concept", () => {
    const edges = [prereq("a", "x"), prereq("b", "y")];
    expect(keystone(["a", "b", "x", "y"], edges, weakEverywhere)?.id).toBe("a");
    expect(keystone(["b", "a", "x", "y"], edges, weakEverywhere)?.id).toBe("b");
  });

  it("survives a cycle", () => {
    const found = keystone(["a", "b", "c"], [prereq("a", "b"), prereq("b", "a"), prereq("b", "c")], weakEverywhere);
    expect(found?.dependents).toBe(2);
  });

  it("ignores edges naming a concept the deck no longer holds", () => {
    const found = keystone(["a", "b"], [prereq("a", "b"), prereq("a", "ghost")], weakEverywhere);
    expect(found).toEqual({ id: "a", dependents: 1 });
  });
});

// The route into a concept a student did not follow. Everything about the order and
// the cap is a judgement about what actually helps, so each one gets a test.
describe("prerequisiteChain", () => {
  const P = (from: string, to: string): ConceptEdge => ({ from, to, relation: "prerequisite" });

  it("walks back to the root, in the order to learn them", () => {
    const ids = ["a", "b", "c"];
    expect(prerequisiteChain("c", ids, [P("a", "b"), P("b", "c")])).toEqual(["a", "b"]);
  });

  it("says nothing about a concept that rests on nothing", () => {
    expect(prerequisiteChain("a", ["a", "b"], [P("a", "b")])).toEqual([]);
  });

  it("collects every branch a concept stands on", () => {
    const ids = ["x", "y", "z"];
    expect(prerequisiteChain("z", ids, [P("x", "z"), P("y", "z")]).sort()).toEqual(["x", "y"]);
  });

  // Depth-first would spend the whole cap on one long branch and never mention the
  // thing sitting directly underneath.
  it("keeps the NEAREST prerequisites when a chain is deeper than the cap", () => {
    const ids = ["r", "a", "b", "c", "d", "target"];
    const edges = [P("r", "a"), P("a", "b"), P("b", "c"), P("c", "d"), P("d", "target")];
    const chain = prerequisiteChain("target", ids, edges);
    expect(chain).toHaveLength(MAX_CHAIN);
    expect(chain).toContain("d");
    expect(chain).not.toContain("r");
  });

  it("never returns more than the cap", () => {
    const ids = ["t", ...Array.from({ length: 12 }, (_, i) => `p${i}`)];
    const edges = ids.slice(1).map((id) => P(id, "t"));
    expect(prerequisiteChain("t", ids, edges).length).toBeLessThanOrEqual(MAX_CHAIN);
  });

  it("survives a cycle", () => {
    const chain = prerequisiteChain("b", ["a", "b"], [P("a", "b"), P("b", "a")]);
    expect(chain).toEqual(["a"]);
  });

  it("ignores an edge naming a concept the deck no longer holds", () => {
    expect(prerequisiteChain("b", ["a", "b"], [P("a", "b"), P("ghost", "b")])).toEqual(["a"]);
  });

  it("says nothing about a concept that is not in the deck", () => {
    expect(prerequisiteChain("missing", ["a", "b"], [P("a", "b")])).toEqual([]);
  });

  it("ignores relations that say nothing about order", () => {
    const edges: ConceptEdge[] = [
      { from: "a", to: "b", relation: "explains" },
      { from: "c", to: "b", relation: "contrast" },
    ];
    expect(prerequisiteChain("b", ["a", "b", "c"], edges)).toEqual([]);
  });
});
