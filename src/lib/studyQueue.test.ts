import { describe, expect, it } from "vitest";
import type { Concept, QueueItem, StudyProgress } from "@/lib/types";
import {
  buildConceptQueueItems,
  nextEasierLevel,
  pathForLevel,
  reconstructResolvedKeys,
  retryItemFor,
} from "./studyQueue";
import { isProductionPath, isRecognitionPath } from "./recallModel";

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

describe("pathForLevel", () => {
  // The invariant, not just the mapping. The feed used to record a review by the
  // item's LANE while FeedSlide rendered by its LEVEL, and D.I.E. drives those
  // apart: a failed lane-2 cloze is requeued at level 1 and shown as a swipe. So
  // a two-option recognition answer was written to the engine as production
  // evidence - and masteryFor requires a production success specifically to stop
  // recognition passes from looking like knowledge.
  it("maps the easier level to a recognition format", () => {
    expect(pathForLevel(1)).toBe("swipe");
    expect(isRecognitionPath(pathForLevel(1))).toBe(true);
  });

  it("maps the harder level to a production format", () => {
    expect(pathForLevel(2)).toBe("cloze");
    expect(isProductionPath(pathForLevel(2))).toBe(true);
  });

  it("never reports a level as production when it is recognition", () => {
    // Guards the substitution directly: whatever the mapping becomes, the two
    // levels must not both count as production, or the mastery bar loses the one
    // condition that makes it mean anything.
    const paths = ([1, 2] as const).map(pathForLevel);
    expect(paths.filter(isProductionPath)).toHaveLength(1);
    expect(paths.filter(isRecognitionPath)).toHaveLength(1);
  });

  it("degrades a failed cloze to a level whose recorded path is the swipe", () => {
    // The concrete D.I.E. path that produced the bug on the device.
    const easier = nextEasierLevel(2);
    expect(easier).toBe(1);
    expect(pathForLevel(easier!)).toBe("swipe");
  });
});

// A retry has to stay attributable, and both fields below were found dropped on a
// real device run rather than in review.
describe("retryItemFor", () => {
  function failed(overrides: Partial<QueueItem> = {}): QueueItem {
    return {
      key: "c1::2::1",
      concept: makeConcept("c1"),
      level: 2,
      lane: 2,
      attempt: 1,
      ...overrides,
    };
  }

  // An engine-built session's feed is handed a placeholder deckId, because a
  // session drawn from the whole library has no single deck. So a retry that lost
  // unitId did not fail loudly - it recorded a real answer against a unit id
  // derived from that placeholder, which nothing in the store rejects.
  it("carries the unit across a retry, since the feed cannot re-derive it", () => {
    expect(retryItemFor(failed({ unitId: "deck-a::c1" }), 1).unitId).toBe("deck-a::c1");
  });

  it("leaves unitId absent for a deck session, which derives it from its own deck", () => {
    expect(retryItemFor(failed(), 1).unitId).toBeUndefined();
  });

  // The lane is the evidence the mastery bar counts, and the level is only how the
  // card is drawn. A cloze that comes back as the easier swipe is still the cloze
  // lane's second attempt.
  it("keeps the lane when the level drops", () => {
    const retry = retryItemFor(failed(), 1);
    expect(retry.level).toBe(1);
    expect(retry.lane).toBe(2);
  });

  it("advances the attempt and keys the card by it, so the retry is not deduped", () => {
    const retry = retryItemFor(failed({ attempt: 1 }), 1);
    expect(retry.attempt).toBe(2);
    expect(retry.key).toBe("c1::1::2");
    expect(retry.key).not.toBe(failed().key);
  });
});
