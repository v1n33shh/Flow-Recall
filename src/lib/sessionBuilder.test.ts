import { describe, expect, it } from "vitest";
import { buildSession, estimatePerCardMs } from "./sessionBuilder";
import { memoryKey, type KnowledgeUnit, type MemoryRecord, type ReviewRecord } from "./recallModel";
import { GOOD, type Grade } from "./fsrs";
import type { Concept } from "./types";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 8, 1);

function concept(overrides: Partial<Concept> = {}): Concept {
  return {
    id: "c1",
    concept: "RAAS",
    question: "What triggers renin release?",
    answer: "reduced renal perfusion",
    distractor: "elevated serum sodium",
    cloze: "Renin is released in response to _____.",
    explanation: "A paragraph.",
    ...overrides,
  };
}

function unit(id: string, overrides: Partial<KnowledgeUnit> = {}): KnowledgeUnit {
  return {
    id,
    userId: "u1",
    sourceDeckId: "deck-1",
    label: id,
    importance: 0.5,
    concept: concept({ id: `${id}-concept` }),
    createdAt: NOW,
    ...overrides,
  };
}

function memory(unitId: string, overrides: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    key: memoryKey("u1", unitId, overrides.path ?? "cloze"),
    userId: "u1",
    unitId,
    path: "cloze",
    stability: 20,
    difficulty: 5,
    lastReviewedAt: NOW,
    dueAt: NOW,
    reps: 3,
    lapses: 0,
    desiredRetention: 0.9,
    ...overrides,
  };
}

function review(unitId: string, overrides: Partial<ReviewRecord> = {}): ReviewRecord {
  return {
    id: crypto.randomUUID(),
    userId: "u1",
    unitId,
    path: "cloze",
    reviewedAt: NOW,
    grade: GOOD as Grade,
    correct: true,
    latencyMs: 4000,
    credited: true,
    elapsedDays: 3,
    stabilityBefore: 5,
    stabilityAfter: 20,
    couplingOnSuccess: 0.35,
    couplingOnLapse: 0.6,
    ...overrides,
  };
}

describe("estimatePerCardMs", () => {
  it("falls back to the per-format constant with too little history", () => {
    // Cloze's fallback. Two gaps is not a median.
    const reviews = [review("a", { reviewedAt: NOW }), review("a", { reviewedAt: NOW + 20_000 })];
    expect(estimatePerCardMs(reviews, "cloze")).toBe(30_000);
    expect(estimatePerCardMs(reviews, "swipe")).toBe(15_000);
  });

  it("takes the median gap between consecutive reviews in one sitting", () => {
    // The measurement that needed no new instrumentation: the gap between two
    // answers IS the time the second one took, reading the debrief included.
    const gaps = [10_000, 12_000, 14_000, 16_000, 60_000];
    let at = NOW;
    const reviews = [review("a", { reviewedAt: at })];
    for (const gap of gaps) {
      at += gap;
      reviews.push(review("a", { reviewedAt: at }));
    }
    expect(estimatePerCardMs(reviews, "cloze")).toBe(14_000);
  });

  it("ignores a gap between sittings rather than calling it a slow card", () => {
    let at = NOW;
    const reviews = [review("a", { reviewedAt: at })];
    for (const gap of [10_000, 10_000, 10_000, 10_000, 10_000]) {
      at += gap;
      reviews.push(review("a", { reviewedAt: at }));
    }
    // A week later, one more review. That 7-day gap must not enter the median.
    reviews.push(review("a", { reviewedAt: at + 7 * MS_PER_DAY }));
    expect(estimatePerCardMs(reviews, "cloze")).toBe(10_000);
  });

  it("times each format separately, attributing a gap to the later review", () => {
    let at = NOW;
    const reviews: ReviewRecord[] = [review("a", { reviewedAt: at, path: "swipe" })];
    for (let i = 0; i < 6; i++) {
      at += 8_000;
      reviews.push(review("a", { reviewedAt: at, path: "swipe" }));
    }
    expect(estimatePerCardMs(reviews, "swipe")).toBe(8_000);
    // No cloze samples at all, so cloze still falls back.
    expect(estimatePerCardMs(reviews, "cloze")).toBe(30_000);
  });
});

describe("buildSession", () => {
  const plan = (over: Partial<Parameters<typeof buildSession>[0]> = {}) =>
    buildSession({ units: [], memories: [], reviews: [], budgetMinutes: 20, now: NOW, ...over });

  it("returns an empty plan when there is nothing to study", () => {
    const p = plan();
    expect(p.items).toEqual([]);
    expect(p.estimatedMinutes).toBe(0);
    expect(p.deckCount).toBe(0);
  });

  it("includes never-studied concepts as fresh, so a new deck is not an empty session", () => {
    const p = plan({ units: [unit("a"), unit("b")] });
    expect(p.items).toHaveLength(2);
    expect(p.fresh).toBe(2);
    expect(p.slipping).toBe(0);
  });

  it("stamps the unit id on every item, since a session spans decks", () => {
    const p = plan({ units: [unit("a", { sourceDeckId: "d1" }), unit("b", { sourceDeckId: "d2" })] });
    expect(p.items.map((i) => i.unitId).sort()).toEqual(["a", "b"]);
    expect(p.deckCount).toBe(2);
  });

  it("puts what is slipping ahead of what has never been seen", () => {
    // Losing something known is worse than not yet knowing something.
    const decayed = unit("decayed");
    const brandNew = unit("new");
    const p = plan({
      units: [brandNew, decayed],
      memories: [memory("decayed", { stability: 2, lastReviewedAt: NOW - 40 * MS_PER_DAY })],
    });
    expect(p.items[0].unitId).toBe("decayed");
    expect(p.slipping).toBe(1);
    expect(p.fresh).toBe(1);
  });

  it("counts a badly-slipping card as urgent as well as slipping", () => {
    // Recall around 0.53 against a 0.9 target - a shortfall of ~0.37. Note the
    // curve is flat enough that stability 1 left for sixty days still recalls at
    // better than half, which is why urgency is measured against the target rather
    // than as a raw probability.
    const p = plan({
      units: [unit("gone")],
      memories: [memory("gone", { stability: 1, lastReviewedAt: NOW - 60 * MS_PER_DAY })],
    });
    expect(p.slipping).toBe(1);
    expect(p.urgent).toBe(1);
  });

  it("counts a barely-due card as slipping but not urgent", () => {
    // Recall just under a 0.9 target: due, but nowhere near lost.
    const p = plan({
      units: [unit("barely")],
      memories: [memory("barely", { stability: 10, lastReviewedAt: NOW - 45 * MS_PER_DAY })],
    });
    expect(p.slipping).toBe(1);
    expect(p.urgent).toBe(0);
  });

  it("asks a well-retained card that has not yet proven itself across formats", () => {
    // Inside its target but not solid, so it is not rested: more evidence is
    // exactly what it needs. Neither slipping nor fresh, and the reason `building`
    // exists - without it this card was selected and reported as nothing at all,
    // which is what the home block rendered as a blank line.
    const p = plan({
      units: [unit("comfortable")],
      // BOTH formats, or the unstudied one is fresh and the card is counted there -
      // which is itself the right behaviour, and was what this test first got wrong.
      memories: [
        memory("comfortable", { path: "cloze", stability: 400, lastReviewedAt: NOW - 5 * MS_PER_DAY }),
        memory("comfortable", { path: "swipe", stability: 400, lastReviewedAt: NOW - 5 * MS_PER_DAY }),
      ],
    });
    expect(p.items).toHaveLength(1);
    expect(p.resting).toBe(0);
    expect(p.slipping).toBe(0);
    expect(p.fresh).toBe(0);
    expect(p.building).toBe(1);
  });

  // The invariant behind that: every selected card lands in exactly one of the
  // three buckets, so the hero can always say why it is asking. Urgent is a subset
  // of slipping and is deliberately excluded from the sum.
  it("accounts for every selected card as slipping, fresh or building", () => {
    const p = plan({
      units: [unit("gone"), unit("new"), unit("comfortable")],
      memories: [
        memory("gone", { path: "cloze", stability: 0.5, lastReviewedAt: NOW - 30 * MS_PER_DAY }),
        memory("gone", { path: "swipe", stability: 0.5, lastReviewedAt: NOW - 30 * MS_PER_DAY }),
        memory("comfortable", { path: "cloze", stability: 400, lastReviewedAt: NOW - 5 * MS_PER_DAY }),
        memory("comfortable", { path: "swipe", stability: 400, lastReviewedAt: NOW - 5 * MS_PER_DAY }),
      ],
      budgetMinutes: 60,
    });
    expect(p.items).toHaveLength(3);
    expect(p.slipping + p.fresh + p.building).toBe(p.items.length);
    expect(p.urgent).toBeLessThanOrEqual(p.slipping);
  });

  it("rests a solid concept that is inside its own target instead of asking it", () => {
    // The whole point of the engine, and the line no other flashcard app prints.
    // Solid needs 3 successes over 2 formats, one after a 7-day gap, one on
    // production - so this history is built to clear exactly that bar.
    const solid = unit("solid");
    const reviews = [
      review("solid", { path: "swipe", reviewedAt: NOW - 30 * MS_PER_DAY }),
      review("solid", { path: "cloze", reviewedAt: NOW - 29 * MS_PER_DAY }),
      review("solid", { path: "cloze", reviewedAt: NOW - 1 * MS_PER_DAY }),
    ];
    const p = plan({
      units: [solid],
      reviews,
      memories: [
        memory("solid", { path: "cloze", stability: 400, lastReviewedAt: NOW - 1 * MS_PER_DAY }),
        memory("solid", { path: "swipe", stability: 400, lastReviewedAt: NOW - 1 * MS_PER_DAY }),
      ],
    });
    expect(p.resting).toBe(1);
    expect(p.items).toEqual([]);
  });

  it("stops at the budget and reports what it deferred", () => {
    const units = Array.from({ length: 12 }, (_, i) => unit(`u${i}`));
    // A fresh card is ranked on value-per-second, so the cheap swipe wins over the
    // cloze on the same concept: 15s each, and two minutes holds eight.
    const p = plan({ units, budgetMinutes: 2 });
    expect(p.items).toHaveLength(8);
    expect(p.items.every((i) => i.level === 1)).toBe(true);
    expect(p.deferred).toBe(4);
    expect(p.estimatedMinutes).toBe(2);
  });

  it("always returns at least one card, even on an impossible budget", () => {
    // A student who asks for 1 minute wants a short session, not an empty screen.
    const p = plan({ units: [unit("a"), unit("b")], budgetMinutes: 0 });
    expect(p.items).toHaveLength(1);
    expect(p.deferred).toBe(1);
  });

  it("asks each concept once per session", () => {
    const p = plan({ units: [unit("a")] });
    expect(p.items).toHaveLength(1);
  });

  it("skips a concept whose fields support no format the feed can draw", () => {
    // No distractor kills the swipe, no blank kills the cloze - pathsFor returns
    // nothing and there is no card to build.
    const broken = unit("broken", {
      concept: concept({ id: "x", distractor: "", cloze: "no blank here" }),
    });
    expect(plan({ units: [broken] }).items).toEqual([]);
  });

  it("prefers the format that has decayed furthest for a given concept", () => {
    const both = unit("both");
    const p = plan({
      units: [both],
      memories: [
        memory("both", { path: "cloze", stability: 400, lastReviewedAt: NOW }),
        memory("both", { path: "swipe", stability: 1, lastReviewedAt: NOW - 40 * MS_PER_DAY }),
      ],
    });
    expect(p.items).toHaveLength(1);
    expect(p.items[0].level).toBe(1);
  });
});
