import { describe, expect, it } from "vitest";
import { AGAIN, COUPLING_ON_LAPSE, COUPLING_ON_SUCCESS, GOOD, nextState } from "./fsrs";
import { memoryKey, type KnowledgeUnit, type ReviewRecord } from "./recallModel";
import { PUSH_SAFETY_MS, planSync, rebuildMemory, replayDivergences, type SyncPayload } from "./recallSync";
import type { TeachBackRecord } from "./recallStorage";
import type { Concept, Deck } from "./types";

const USER = "u1";
const UNIT = "deck-a::c1";
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const T0 = 1_700_000_000_000;

function concept(id = "c1"): Concept {
  return {
    id,
    concept: "Stroke volume",
    question: "What is stroke volume?",
    answer: "EDV minus ESV",
    distractor: "EDV times heart rate",
    cloze: "Stroke volume is end-diastolic volume minus _____.",
  };
}

function unit(overrides: Partial<KnowledgeUnit> = {}): KnowledgeUnit {
  return {
    id: UNIT,
    userId: USER,
    sourceDeckId: "deck-a",
    label: "Stroke volume",
    importance: 0.5,
    concept: concept(),
    createdAt: T0,
    ...overrides,
  };
}

/** Mirrors what recordReview stores, INCLUDING stabilityAfter - which is the
 * whole point. `stabilityAfter` here is computed by calling the same `nextState`
 * the live path calls, so a replay that reads the wrong previous state, the wrong
 * elapsed time, or ignores `credited` shows up as a divergence rather than as a
 * plausible-looking number. */
function review(overrides: Partial<ReviewRecord> = {}): ReviewRecord {
  const base: ReviewRecord = {
    id: "r1",
    userId: USER,
    unitId: UNIT,
    path: "cloze",
    reviewedAt: T0,
    grade: GOOD,
    correct: true,
    latencyMs: 4000,
    credited: true,
    elapsedDays: 0,
    stabilityBefore: null,
    stabilityAfter: 0,
    couplingOnSuccess: COUPLING_ON_SUCCESS,
    couplingOnLapse: COUPLING_ON_LAPSE,
  };
  return { ...base, ...overrides };
}

/** Builds a chain of reviews on one path with the stability each step really
 * produced, so the fixture is a faithful stand-in for device history. */
function chain(steps: { grade: typeof GOOD | typeof AGAIN; afterDays: number; credited?: boolean }[]) {
  const rows: ReviewRecord[] = [];
  let state: { stability: number; difficulty: number } | null = null;
  let at = T0;
  steps.forEach((step, i) => {
    const credited = step.credited ?? true;
    at += step.afterDays * MS_PER_DAY;
    const elapsedDays = i === 0 ? 0 : step.afterDays;
    const advanced = credited
      ? nextState(state, step.grade, elapsedDays)
      : (state ?? nextState(null, AGAIN, 0));
    rows.push(
      review({
        id: `r${i + 1}`,
        reviewedAt: at,
        grade: step.grade,
        correct: step.grade !== AGAIN,
        credited,
        elapsedDays,
        stabilityBefore: state?.stability ?? null,
        stabilityAfter: advanced.stability,
      }),
    );
    state = advanced;
  });
  return rows;
}

describe("rebuildMemory", () => {
  it("reproduces the stability every review recorded at the time", () => {
    // The load-bearing invariant. If this fails, a sync rewrites a student's
    // schedule - which is worse than not syncing at all.
    const rows = chain([
      { grade: GOOD, afterDays: 0 },
      { grade: GOOD, afterDays: 3 },
      { grade: AGAIN, afterDays: 9 },
      { grade: GOOD, afterDays: 1 },
    ]);
    expect(replayDivergences(rows, [unit()])).toEqual([]);
  });

  it("rebuilds one row per reviewed format", () => {
    const memory = rebuildMemory(
      [review({ id: "a", path: "cloze" }), review({ id: "b", path: "swipe", reviewedAt: T0 + 1000 })],
      [unit()],
    );
    expect(memory.map((m) => m.path).sort()).toEqual(["cloze", "swipe"]);
    expect(memory.every((m) => m.key === memoryKey(USER, UNIT, m.path))).toBe(true);
  });

  it("counts every review as a rep, and only credited failures as lapses", () => {
    const rows = [
      review({ id: "a", grade: GOOD }),
      review({ id: "b", grade: AGAIN, correct: false, reviewedAt: T0 + MS_PER_DAY, elapsedDays: 1 }),
      // Scrolled past unanswered: recorded, but it must not count against a
      // memory that was never actually tested.
      review({ id: "c", grade: AGAIN, correct: false, credited: false, reviewedAt: T0 + 2 * MS_PER_DAY }),
    ];
    const [memory] = rebuildMemory(rows, [unit()]);
    expect(memory.reps).toBe(3);
    expect(memory.lapses).toBe(1);
  });

  it("does not move lastReviewedAt for an uncredited answer", () => {
    // A suspiciously fast "correct" is evidence, not recall. Advancing the clock
    // on it would silently shorten the next interval's elapsed time.
    const rows = [
      review({ id: "a", reviewedAt: T0 }),
      review({ id: "b", reviewedAt: T0 + 5 * MS_PER_DAY, credited: false, stabilityAfter: 0 }),
    ];
    const [memory] = rebuildMemory(rows, [unit()]);
    expect(memory.lastReviewedAt).toBe(T0);
  });

  it("couples a sibling format, using the constants the review was written with", () => {
    // Two formats, cloze reviewed twice so the second review has a previous state
    // (coupling only fires when it does). The swipe row must move without having
    // been reviewed.
    const swipeFirst = review({ id: "s1", path: "swipe", reviewedAt: T0 });
    const clozeOne = review({ id: "c1", path: "cloze", reviewedAt: T0 + 1000 });
    const clozeTwo = review({
      id: "c2",
      path: "cloze",
      reviewedAt: T0 + 4 * MS_PER_DAY,
      elapsedDays: 4,
      couplingOnSuccess: 1,
    });
    const withCoupling = rebuildMemory([swipeFirst, clozeOne, clozeTwo], [unit()]);
    const withoutSecond = rebuildMemory([swipeFirst, clozeOne], [unit()]);
    const movedTo = withCoupling.find((m) => m.path === "swipe")!.stability;
    const wasAt = withoutSecond.find((m) => m.path === "swipe")!.stability;
    expect(movedTo).not.toBeCloseTo(wasAt, 9);
  });

  it("replays in global time order, not in the order the rows arrive", () => {
    const ordered = chain([
      { grade: GOOD, afterDays: 0 },
      { grade: GOOD, afterDays: 3 },
      { grade: GOOD, afterDays: 8 },
    ]);
    const shuffled = [ordered[2], ordered[0], ordered[1]];
    expect(rebuildMemory(shuffled, [unit()])).toEqual(rebuildMemory(ordered, [unit()]));
  });

  it("dates a starred concept sooner, because retention comes from importance now", () => {
    const rows = chain([{ grade: GOOD, afterDays: 0 }, { grade: GOOD, afterDays: 4 }]);
    const [casual] = rebuildMemory(rows, [unit({ importance: 0 })]);
    const [starred] = rebuildMemory(rows, [unit({ importance: 1 })]);
    expect(starred.desiredRetention).toBeGreaterThan(casual.desiredRetention);
    expect(starred.dueAt).toBeLessThan(casual.dueAt);
    // And the memory itself is untouched by it - only the target moved.
    expect(starred.stability).toBeCloseTo(casual.stability, 12);
  });

  it("survives a review for a unit it knows nothing about", () => {
    // A review can arrive from another device before that device's units do.
    // Dropping it would lose history; guessing wildly would corrupt it. The
    // fallback is the same flat 0.5 importance every unit has today.
    const memory = rebuildMemory([review()], []);
    expect(memory).toHaveLength(1);
    expect(memory[0].desiredRetention).toBeCloseTo(0.905, 3);
  });

  it("has nothing to rebuild from an empty log", () => {
    expect(rebuildMemory([], [unit()])).toEqual([]);
  });
});

function deck(overrides: Partial<Deck> = {}): Deck {
  return { id: "deck-a", title: "Cardio", createdAt: T0, concepts: [concept()], ...overrides };
}

function teachBack(overrides: Partial<TeachBackRecord> = {}): TeachBackRecord {
  return {
    id: "tb1",
    userId: "u1",
    unitId: "deck-a::c1",
    attempt: "The heart fills, then squeezes.",
    correct: ["You got the order right."],
    missing: [],
    wrong: [],
    attemptedAt: T0,
    ...overrides,
  };
}

function payload(overrides: Partial<SyncPayload> = {}): SyncPayload {
  return { decks: [], units: [], reviews: [], asks: [], teachBacks: [], ...overrides };
}

describe("planSync", () => {
  const NOW = T0 + 30 * MS_PER_DAY;

  it("pushes everything on a first sync, when there is no cursor to trust", () => {
    const local = payload({ decks: [deck()], units: [unit()], reviews: [review()] });
    const plan = planSync({ local, remote: payload(), since: null, now: NOW });
    expect(plan.toPush.decks).toHaveLength(1);
    expect(plan.toPush.units).toHaveLength(1);
    expect(plan.toPush.reviews).toHaveLength(1);
  });

  // The clock-skew guard. A review stamped behind the last successful sync - a
  // manual clock change is enough - would otherwise be skipped by the cursor and
  // never sent again, which is a silently unrecoverable loss.
  it("re-sends a window of rows behind the cursor", () => {
    const since = NOW;
    const justBehind = review({ id: "old", reviewedAt: since - PUSH_SAFETY_MS / 2 });
    const longGone = review({ id: "ancient", reviewedAt: since - PUSH_SAFETY_MS * 2 });
    const plan = planSync({
      local: payload({ reviews: [justBehind, longGone] }),
      remote: payload(),
      since,
      now: NOW,
    });
    expect(plan.toPush.reviews.map((r) => r.id)).toEqual(["old"]);
  });

  it("writes a remote review it has never seen and ignores one it already holds", () => {
    const mine = review({ id: "mine" });
    const theirs = review({ id: "theirs" });
    const plan = planSync({
      local: payload({ reviews: [mine] }),
      remote: payload({ reviews: [mine, theirs] }),
      since: T0,
      now: NOW,
    });
    expect(plan.toWrite.reviews.map((r) => r.id)).toEqual(["theirs"]);
  });

  it("pushes a teach-back after the cutoff and re-sends one just behind it", () => {
    const since = NOW;
    const plan = planSync({
      local: payload({
        teachBacks: [
          teachBack({ id: "fresh", attemptedAt: since + 10 }),
          teachBack({ id: "just-behind", attemptedAt: since - PUSH_SAFETY_MS / 2 }),
          teachBack({ id: "ancient", attemptedAt: since - PUSH_SAFETY_MS * 2 }),
        ],
      }),
      remote: payload(),
      since,
      now: NOW,
    });
    expect(plan.toPush.teachBacks.map((t) => t.id)).toEqual(["fresh", "just-behind"]);
  });

  // Immutable, so a second attempt at the same concept is a new row and the merge is
  // a union by id - never an overwrite of what the student wrote before.
  it("writes a remote teach-back it has never seen and never rewrites one it holds", () => {
    const mine = teachBack({ id: "mine", attempt: "what I wrote here" });
    const theirs = teachBack({ id: "theirs", attempt: "what I wrote on the laptop" });
    const edited = teachBack({ id: "mine", attempt: "SOMETHING ELSE" });
    const plan = planSync({
      local: payload({ teachBacks: [mine] }),
      remote: payload({ teachBacks: [edited, theirs] }),
      since: T0,
      now: NOW,
    });
    expect(plan.toWrite.teachBacks.map((t) => t.id)).toEqual(["theirs"]);
  });

  it("takes the newer deck when both sides changed it", () => {
    const plan = planSync({
      local: payload({ decks: [deck({ title: "Mine", updatedAt: T0 + 100 })] }),
      remote: payload({ decks: [deck({ title: "Theirs", updatedAt: T0 + 200 })] }),
      since: T0,
      now: NOW,
    });
    expect(plan.toWrite.decks.map((d) => d.title)).toEqual(["Theirs"]);
  });

  it("keeps a deck the other device deleted after this one last edited it", () => {
    // The resurrection bug, stated as a test: without tombstones the pull hands
    // back a deck the student deleted, and a deleted deck that reappears is the
    // kind of thing that ends trust in sync entirely.
    const plan = planSync({
      local: payload({ decks: [deck({ updatedAt: T0 + 100 })] }),
      remote: payload({ decks: [deck({ updatedAt: T0 + 100, deletedAt: T0 + 300 })] }),
      since: T0,
      now: NOW,
    });
    expect(plan.toWrite.decks).toHaveLength(1);
    expect(plan.deckTombstones).toEqual(["deck-a"]);
  });

  it("keeps an edit that postdates the other device's delete", () => {
    const plan = planSync({
      local: payload({ decks: [deck({ updatedAt: T0 + 500 })] }),
      remote: payload({ decks: [deck({ deletedAt: T0 + 300 })] }),
      since: T0,
      now: NOW,
    });
    expect(plan.toWrite.decks).toEqual([]);
    expect(plan.deckTombstones).toEqual([]);
  });

  it("does not report a tombstone for a deck this device never had", () => {
    const plan = planSync({
      local: payload(),
      remote: payload({ decks: [deck({ deletedAt: T0 + 300 })] }),
      since: T0,
      now: NOW,
    });
    expect(plan.deckTombstones).toEqual([]);
  });

  it("writes nothing when the server has exactly what this device has", () => {
    // Idempotence: syncing twice in a row is a no-op, which is what makes a
    // retry after a dropped connection safe.
    const local = payload({ decks: [deck()], units: [unit()], reviews: [review()] });
    const plan = planSync({ local, remote: local, since: T0, now: NOW });
    expect(plan.toWrite).toEqual(payload());
  });
});

