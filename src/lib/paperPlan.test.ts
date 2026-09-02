import { describe, expect, it } from "vitest";
import {
  MARKS,
  PATH_BY_TYPE,
  buildPaper,
  recallProbability,
  resolveEdges,
  typesFor,
  type PaperEdge,
} from "./paperPlan";
import { memoryKey, unitIdFor, type KnowledgeUnit, type MemoryRecord } from "./recallModel";
import type { Concept } from "./types";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 8, 1);

// Retrievability values measured against the real FSRS-6 curve rather than guessed,
// because the curve is much flatter than intuition suggests - stability 1 left for
// sixty days still returns 0.53, not something near zero. Each row below is
// annotated with what recallProbability actually returns for it, so a test that
// depends on a band is reading a checked number.
const SOLID = { stability: 20, daysAgo: 0 }; //   R = 1.0000
const MIDDLING = { stability: 10, daysAgo: 20 }; // R = 0.8459
const WEAK = { stability: 1, daysAgo: 60 }; //     R = 0.5321

function concept(overrides: Partial<Concept> = {}): Concept {
  return {
    id: "c1",
    concept: "RAAS",
    question: "What triggers renin release?",
    answer: "reduced renal perfusion",
    distractor: "elevated serum sodium",
    cloze: "Renin is released in response to _____.",
    explanation: "A paragraph explaining the mechanism in detail.",
    ...overrides,
  };
}

function unit(id: string, conceptOverrides: Partial<Concept> = {}): KnowledgeUnit {
  return {
    id,
    userId: "u1",
    sourceDeckId: "deck-1",
    label: id,
    importance: 0.5,
    concept: concept({ id: `${id}-concept`, ...conceptOverrides }),
    createdAt: NOW,
  };
}

function memory(
  unitId: string,
  state: { stability: number; daysAgo: number },
  path: MemoryRecord["path"] = "cloze",
): MemoryRecord {
  return {
    key: memoryKey("u1", unitId, path),
    userId: "u1",
    unitId,
    path,
    stability: state.stability,
    difficulty: 5,
    lastReviewedAt: NOW - state.daysAgo * DAY,
    dueAt: NOW,
    reps: 3,
    lapses: 0,
    desiredRetention: 0.9,
  };
}

describe("recallProbability", () => {
  it("is the mean across the formats a concept has been asked in, not the best of them", () => {
    // The rule projectedRecall uses, reused here so the paper's weighting cannot
    // disagree with the number the home screen prints. Taking the max would assume
    // the exam probes whichever format the student is strongest at.
    const memories = [memory("u-1", SOLID, "cloze"), memory("u-1", WEAK, "swipe")];
    const mean = recallProbability("u-1", memories, NOW);
    expect(mean).toBeCloseTo((1.0 + 0.5321) / 2, 3);
    expect(mean).toBeLessThan(1);
  });

  it("is 0 for a concept never asked at all", () => {
    expect(recallProbability("u-1", [], NOW)).toBe(0);
  });
});

describe("typesFor", () => {
  it("offers no prose question for a card with no explanation", () => {
    // explanation is optional on Concept because decks predate it. Without this
    // gate such a deck would produce a 10-mark essay with nothing to mark against.
    const types = typesFor(unit("u-1", { explanation: undefined }));
    expect(types).not.toContain("long");
    expect(types).not.toContain("short");
    expect(types).toContain("recall");
  });

  it("offers no mcq for a card whose distractor never generated", () => {
    expect(typesFor(unit("u-1", { distractor: "" }))).not.toContain("mcq");
  });
});

describe("buildPaper", () => {
  it("spends the paper's marks on the concepts most likely to lose them", () => {
    const units = [unit("u-weak"), unit("u-mid"), unit("u-solid")];
    const memories = [
      memory("u-weak", WEAK),
      memory("u-mid", MIDDLING),
      memory("u-solid", SOLID),
    ];

    const paper = buildPaper({ units, memories, totalMarks: 50, now: NOW });
    const marksFor = (id: string) =>
      paper.slots.find((slot) => slot.unitIds.includes(id))?.marks;

    expect(marksFor("u-weak")).toBe(MARKS.long);
    expect(marksFor("u-mid")).toBe(MARKS.short);
    expect(marksFor("u-solid")).toBe(MARKS.recall);
  });

  it("still examines a deck the student knows cold, at one mark a concept", () => {
    // The deliberate inversion of buildSession, whose best feature is telling a
    // student what NOT to study. An exam has no such manners.
    const units = [unit("u-1"), unit("u-2"), unit("u-3")];
    const memories = units.map((row) => memory(row.id, SOLID));

    const paper = buildPaper({ units, memories, totalMarks: 50, now: NOW });

    expect(paper.slots).toHaveLength(3);
    expect(paper.totalMarks).toBe(3);
    expect(paper.slots.every((slot) => slot.marks === MARKS.recall)).toBe(true);
  });

  it("ranks a concept never opened above one merely decayed", () => {
    // The other inversion: buildSession gives isFresh a value of 0.05 because
    // losing something known is worse than not yet knowing something. In an exam
    // material never opened is the likeliest source of a zero.
    const units = [unit("u-decayed"), unit("u-never")];
    const paper = buildPaper({
      units,
      memories: [memory("u-decayed", MIDDLING)],
      totalMarks: 50,
      now: NOW,
    });

    expect(paper.slots[0].unitIds).toEqual(["u-never"]);
    expect(paper.slots[0].marks).toBe(MARKS.long);
  });

  it("never exceeds the mark budget", () => {
    const units = Array.from({ length: 12 }, (_, i) => unit(`u-${i}`));
    const paper = buildPaper({ units, memories: [], totalMarks: 30, now: NOW });

    expect(paper.totalMarks).toBeLessThanOrEqual(30);
    expect(paper.slots.length).toBeGreaterThan(0);
  });

  it("still sets one question when the budget cannot afford it", () => {
    // The same guard buildSession applies to its time budget: a paper of nothing is
    // worse than a paper of one question over the target.
    const paper = buildPaper({ units: [unit("u-1")], memories: [], totalMarks: 1, now: NOW });
    expect(paper.slots).toHaveLength(1);
    expect(paper.slots[0].marks).toBe(MARKS.long);
  });

  it("is deterministic, so a student cannot reroll for an easy paper", () => {
    const units = [unit("u-a"), unit("u-b"), unit("u-c")];
    const memories = [memory("u-a", SOLID), memory("u-b", SOLID), memory("u-c", SOLID)];
    const first = buildPaper({ units, memories, totalMarks: 20, now: NOW });
    const second = buildPaper({ units, memories, totalMarks: 20, now: NOW });
    expect(second).toEqual(first);
  });

  it("reports how much of the material it actually examined", () => {
    const units = Array.from({ length: 8 }, (_, i) => unit(`u-${i}`));
    const paper = buildPaper({ units, memories: [], totalMarks: 20, now: NOW });
    expect(paper.available).toBe(8);
    expect(paper.covered).toBe(paper.slots.length);
    expect(paper.covered).toBeLessThan(paper.available);
  });
});

describe("buildPaper — relation questions", () => {
  const units = [unit("u-1"), unit("u-2"), unit("u-3"), unit("u-4")];
  const memories = units.map((row) => memory(row.id, SOLID));

  it("turns a contrast edge into a compare question and a prerequisite into a chain", () => {
    // The insight this whole feature leans on: the concept map already stores, and
    // has already validated, exactly the relationships an examiner asks about.
    const edges: PaperEdge[] = [
      { from: "u-1", to: "u-2", relation: "contrast" },
      { from: "u-3", to: "u-4", relation: "prerequisite" },
    ];
    const paper = buildPaper({ units, memories, edges, totalMarks: 50, now: NOW });

    expect(paper.slots[0]).toEqual({
      type: "contrast",
      marks: MARKS.contrast,
      unitIds: ["u-1", "u-2"],
    });
    expect(paper.slots[1]).toEqual({ type: "chain", marks: MARKS.chain, unitIds: ["u-3", "u-4"] });
  });

  it("reads an explains edge as a chain question too", () => {
    const edges: PaperEdge[] = [{ from: "u-1", to: "u-2", relation: "explains" }];
    const paper = buildPaper({ units, memories, edges, totalMarks: 50, now: NOW });
    expect(paper.slots[0].type).toBe("chain");
  });

  it("sets no relation question when the deck has no edges", () => {
    const paper = buildPaper({ units, memories, totalMarks: 50, now: NOW });
    expect(paper.slots.some((slot) => slot.unitIds.length > 1)).toBe(false);
  });

  it("claims its relation questions before the budget is spent worst-first", () => {
    // Without reserving them, a budget filled worst-first always spends itself
    // before reaching the questions that make the paper feel expertly set.
    const many = Array.from({ length: 20 }, (_, i) => unit(`u-${i}`));
    const edges: PaperEdge[] = [{ from: "u-18", to: "u-19", relation: "contrast" }];
    const paper = buildPaper({ units: many, memories: [], edges, totalMarks: 30, now: NOW });

    expect(paper.slots[0].type).toBe("contrast");
    expect(paper.totalMarks).toBeLessThanOrEqual(30);
  });

  it("carries at most two relation questions, however many edges the deck has", () => {
    const many = Array.from({ length: 10 }, (_, i) => unit(`u-${i}`));
    const edges: PaperEdge[] = [
      { from: "u-0", to: "u-1", relation: "contrast" },
      { from: "u-2", to: "u-3", relation: "contrast" },
      { from: "u-4", to: "u-5", relation: "prerequisite" },
      { from: "u-6", to: "u-7", relation: "explains" },
    ];
    const paper = buildPaper({ units: many, memories: [], edges, totalMarks: 100, now: NOW });
    expect(paper.slots.filter((slot) => slot.unitIds.length === 2)).toHaveLength(2);
  });

  it("asks each concept exactly once, relation questions included", () => {
    const edges: PaperEdge[] = [{ from: "u-1", to: "u-2", relation: "contrast" }];
    const paper = buildPaper({ units, memories, edges, totalMarks: 50, now: NOW });

    const asked = paper.slots.flatMap((slot) => slot.unitIds);
    expect(new Set(asked).size).toBe(asked.length);
  });

  it("drops a relation whose ends have no material to mark against", () => {
    // Half a compare-and-contrast question is worse than none: the marker would be
    // asked to judge one side against material that does not exist.
    const bare = [unit("u-1", { explanation: undefined }), unit("u-2")];
    const edges: PaperEdge[] = [{ from: "u-1", to: "u-2", relation: "contrast" }];
    const paper = buildPaper({ units: bare, memories: [], edges, totalMarks: 50, now: NOW });
    expect(paper.slots.some((slot) => slot.type === "contrast")).toBe(false);
  });

  it("ignores an edge naming a concept the paper's units do not include", () => {
    // A stored map outlives the concepts it names - ConceptEditor can delete a card
    // - and a deck may be one of several the paper draws on.
    const edges: PaperEdge[] = [{ from: "u-1", to: "u-gone", relation: "contrast" }];
    const paper = buildPaper({ units, memories, edges, totalMarks: 50, now: NOW });
    expect(paper.slots.every((slot) => slot.unitIds.length === 1)).toBe(true);
  });
});

describe("resolveEdges", () => {
  it("resolves both ends with the same id scheme every other caller uses", () => {
    const [edge] = resolveEdges("deck-1", [{ from: "c1", to: "c2", relation: "contrast" }]);
    expect(edge.from).toBe(unitIdFor("deck-1", "c1"));
    expect(edge.to).toBe(unitIdFor("deck-1", "c2"));
    expect(edge.relation).toBe("contrast");
  });
});

describe("PATH_BY_TYPE", () => {
  it("produces the three retrieval paths nothing else in the app has ever produced", () => {
    // recallModel.ts has declared five paths since the day it was written and
    // pathsFor produces two. These are the other three.
    expect(new Set(Object.values(PATH_BY_TYPE))).toEqual(new Set(["reverse", "mcq", "explain"]));
  });
});
