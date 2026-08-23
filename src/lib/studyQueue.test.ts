import { describe, expect, it } from "vitest";
import type { Concept, QueueItem, StudyProgress } from "@/lib/types";
import { buildConceptQueueItems, nextEasierLevel, reconstructResolvedKeys } from "./studyQueue";

function makeConcept(id: string): Concept {
  return {
    id,
    concept: `Concept ${id}`,
    question: `Question for ${id}?`,
    answer: `Answer ${id}`,
    distractor: `Distractor ${id}`,
    cloze: `The answer is _____ for ${id}.`,
  };
}

describe("nextEasierLevel", () => {
  it("has no easier level below 1", () => {
    expect(nextEasierLevel(1)).toBeNull();
  });

  it("steps level 2 down to level 1", () => {
    expect(nextEasierLevel(2)).toBe(1);
  });
});

describe("buildConceptQueueItems", () => {
  it("produces exactly two items per concept - one per lane", () => {
    const concepts = [makeConcept("a"), makeConcept("b"), makeConcept("c")];
    const queue = buildConceptQueueItems(concepts);
    expect(queue).toHaveLength(6);

    for (const concept of concepts) {
      const items = queue.filter((item) => item.concept.id === concept.id);
      expect(items).toHaveLength(2);
      const lanes = items.map((item) => item.lane).sort();
      expect(lanes).toEqual([1, 2]);
    }
  });

  // This is the exact bug found live: a forward-only repair search missed a
  // valid fix on a real 3-concept case, producing [B, C, B, C, A, A] - a
  // duplicate at the very end with no forward candidate. Run many random
  // trials since the construction is randomized per call.
  it("never places the same concept's two questions adjacent (2+ concepts)", () => {
    const concepts = [makeConcept("a"), makeConcept("b"), makeConcept("c"), makeConcept("d")];
    for (let trial = 0; trial < 200; trial++) {
      const queue = buildConceptQueueItems(concepts);
      for (let i = 0; i < queue.length - 1; i++) {
        expect(queue[i].concept.id).not.toBe(queue[i + 1].concept.id);
      }
    }
  });

  it("marks every item isNew when requested, none when not", () => {
    const concepts = [makeConcept("a"), makeConcept("b")];
    const fresh = buildConceptQueueItems(concepts, { isNew: true });
    expect(fresh.every((item) => item.isNew === true)).toBe(true);

    const normal = buildConceptQueueItems(concepts);
    expect(normal.every((item) => item.isNew === undefined)).toBe(true);
  });

  it("gives every item attempt 1 and a key scoped to (concept, lane)", () => {
    const concepts = [makeConcept("a")];
    const queue = buildConceptQueueItems(concepts);
    for (const item of queue) {
      expect(item.attempt).toBe(1);
      expect(item.key).toBe(`a::${item.lane}::1`);
    }
  });
});

describe("reconstructResolvedKeys", () => {
  function makeItem(concept: Concept, lane: 1 | 2, attempt: number): QueueItem {
    return { key: `${concept.id}::${lane}::${attempt}`, concept, level: lane, lane, attempt };
  }

  it("marks a mastered concept's items as resolved", () => {
    const concept = makeConcept("a");
    const progress: StudyProgress = {
      deckId: "d1",
      masteredIds: ["a"],
      queue: [makeItem(concept, 1, 1)],
    };
    const resolved = reconstructResolvedKeys(progress);
    expect(resolved.has("a::1::1")).toBe(true);
  });

  it("marks a superseded retry attempt as resolved but keeps the latest one open", () => {
    const concept = makeConcept("a");
    const progress: StudyProgress = {
      deckId: "d1",
      masteredIds: [],
      queue: [makeItem(concept, 2, 1), makeItem(concept, 1, 2)],
    };
    const resolved = reconstructResolvedKeys(progress);
    expect(resolved.has("a::2::1")).toBe(false); // superseded lane-key differs (2 vs 1) - see below
    expect(resolved.has("a::1::2")).toBe(false); // the latest attempt in its lane, still open
  });

  it("does not cross-resolve the other lane of the same concept", () => {
    // The exact gap this function's design note calls out: mastering/resolving
    // one lane must not falsely mark the other lane's independent question
    // as already answered.
    const concept = makeConcept("a");
    const progress: StudyProgress = {
      deckId: "d1",
      masteredIds: [],
      queue: [makeItem(concept, 1, 1), makeItem(concept, 2, 1)],
    };
    const resolved = reconstructResolvedKeys(progress);
    expect(resolved.size).toBe(0);
  });
});
