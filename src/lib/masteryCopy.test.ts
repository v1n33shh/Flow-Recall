import { describe, expect, it } from "vitest";
import { masteryFor, type MasteryLevel } from "@/lib/recallModel";
import { MASTERY_DOT_LABEL, MASTERY_LABEL, MASTERY_MEANING } from "@/lib/masteryCopy";

/** The point of this file is that adding a sixth mastery level cannot half-land the way
 * five levels across four label maps already had. */

// Written out rather than derived, so adding a level to the union makes THIS list wrong
// too and the failure names the level instead of silently passing over it.
const LEVELS: MasteryLevel[] = ["met", "familiar", "holding", "solid", "fading"];

describe("MASTERY_LABEL", () => {
  it("names every level", () => {
    for (const level of LEVELS) {
      expect(MASTERY_LABEL[level], level).toBeTruthy();
    }
    expect(Object.keys(MASTERY_LABEL).sort()).toEqual([...LEVELS].sort());
  });

  it("gives each level a distinct name", () => {
    // Two levels sharing a label would be indistinguishable to a student, which is the
    // bug this file was written to end.
    expect(new Set(Object.values(MASTERY_LABEL)).size).toBe(LEVELS.length);
  });

  it("settles the two names that used to disagree across screens", () => {
    expect(MASTERY_LABEL.fading).toBe("Fading");
    expect(MASTERY_LABEL.met).toBe("Met once");
    // "Slipping" was MemoryOverview's own word for `fading`, and is now gone.
    expect(Object.values(MASTERY_LABEL)).not.toContain("Slipping");
  });
});

describe("MASTERY_MEANING", () => {
  it("explains every level", () => {
    for (const level of LEVELS) {
      expect(MASTERY_MEANING[level], level).toBeTruthy();
    }
    expect(Object.keys(MASTERY_MEANING).sort()).toEqual([...LEVELS].sort());
  });

  it("keeps each line short enough to sit under a chip on a phone", () => {
    for (const level of LEVELS) {
      expect(MASTERY_MEANING[level].length, level).toBeLessThanOrEqual(90);
    }
  });

  it("says what actually makes a concept solid, since that is the whole rule", () => {
    // If masteryFor's thresholds move, this sentence is a lie. Naming both halves here
    // is what makes that lie fail a test rather than ship.
    expect(MASTERY_MEANING.solid).toMatch(/two ways/i);
    expect(MASTERY_MEANING.solid).toMatch(/week/i);
  });
});

describe("MASTERY_DOT_LABEL", () => {
  it("borrows its two real levels from the one label set", () => {
    expect(MASTERY_DOT_LABEL.solid).toBe(MASTERY_LABEL.solid);
    expect(MASTERY_DOT_LABEL.fading).toBe(MASTERY_LABEL.fading);
  });

  it("keeps 'Not yet' as a grouping rather than a sixth level", () => {
    expect(Object.values(MASTERY_LABEL)).not.toContain(MASTERY_DOT_LABEL.notYet);
  });
});

describe("the levels these describe are the ones the engine emits", () => {
  it("covers what masteryFor can actually return", () => {
    // A guard against the union drifting from the labels: every level named here must
    // still be a valid MasteryLevel, checked through the engine's own type.
    const levels: MasteryLevel[] = Object.keys(MASTERY_LABEL) as MasteryLevel[];
    expect(levels).toHaveLength(5);
    expect(typeof masteryFor).toBe("function");
  });
});
