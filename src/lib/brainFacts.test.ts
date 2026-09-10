import { describe, expect, it } from "vitest";
import { BRAIN_FACTS, factAt, nextCursor } from "./brainFacts";

describe("factAt", () => {
  it("walks the set in order", () => {
    expect(factAt(0)).toBe(BRAIN_FACTS[0]);
    expect(factAt(1)).toBe(BRAIN_FACTS[1]);
    expect(factAt(BRAIN_FACTS.length - 1)).toBe(BRAIN_FACTS[BRAIN_FACTS.length - 1]);
  });

  it("wraps rather than falling off the end", () => {
    expect(factAt(BRAIN_FACTS.length)).toBe(BRAIN_FACTS[0]);
    expect(factAt(BRAIN_FACTS.length * 3 + 2)).toBe(BRAIN_FACTS[2]);
  });

  // The cursor comes out of localStorage, where a value from a build with a different
  // number of facts - or a hand-edited one - can be sitting.
  it("survives a cursor no build of this app would have written", () => {
    expect(BRAIN_FACTS).toContain(factAt(-1));
    expect(BRAIN_FACTS).toContain(factAt(-999));
    expect(BRAIN_FACTS).toContain(factAt(1.7));
    expect(BRAIN_FACTS).toContain(factAt(999_999));
  });
});

describe("nextCursor", () => {
  it("advances by one", () => {
    expect(nextCursor(0)).toBe(1);
    expect(nextCursor(3)).toBe(4);
  });

  it("comes back round at the end of the set", () => {
    expect(nextCursor(BRAIN_FACTS.length - 1)).toBe(0);
  });

  it("stays inside the set for any stored value", () => {
    for (const cursor of [-1, -50, 1.9, 10_000]) {
      const next = nextCursor(cursor);
      expect(next).toBeGreaterThanOrEqual(0);
      expect(next).toBeLessThan(BRAIN_FACTS.length);
    }
  });

  // The whole reason for a cursor rather than a random pick: a student meets every
  // fact before meeting any of them a second time.
  it("shows every fact once before repeating any", () => {
    const seen: string[] = [];
    let cursor = 0;
    for (let i = 0; i < BRAIN_FACTS.length; i++) {
      seen.push(factAt(cursor));
      cursor = nextCursor(cursor);
    }
    expect(new Set(seen).size).toBe(BRAIN_FACTS.length);
    expect(cursor).toBe(0);
  });
});

describe("the set itself", () => {
  it("is worth having", () => {
    expect(BRAIN_FACTS.length).toBeGreaterThanOrEqual(12);
  });

  it("holds no duplicates", () => {
    expect(new Set(BRAIN_FACTS).size).toBe(BRAIN_FACTS.length);
  });

  // A misattributed quotation is worse than no quotation. Nothing here may acquire
  // a name, however plausible it looks in a pull request.
  it("attributes nothing to anybody", () => {
    for (const fact of BRAIN_FACTS) {
      expect(fact).not.toMatch(/[—–-]\s*[A-Z][a-z]+\s+[A-Z]/);
      expect(fact).not.toMatch(/["“”]/);
    }
  });

  it("fits two lines on a 360dp phone", () => {
    for (const fact of BRAIN_FACTS) {
      expect(fact.length).toBeLessThanOrEqual(110);
    }
  });
});
