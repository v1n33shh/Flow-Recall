import { describe, expect, it } from "vitest";
import { sourceKeyFor } from "@/lib/sourceKey";

const PROSE =
  "The mind creates hell through three attitudes: aversion, attachment, and indifference.";

describe("sourceKeyFor", () => {
  it("is deterministic", () => {
    expect(sourceKeyFor(PROSE)).toBe(sourceKeyFor(PROSE));
  });

  it("ignores how whitespace is laid out", () => {
    // The same paragraph as pdf.js might reflow it on a second extraction: a
    // different line width, a run of spaces where there was one, a trailing
    // newline. Same book, so it has to be the same key.
    const reflowed = `  The mind creates hell through three\n  attitudes:   aversion, attachment,\n\tand indifference.\n`;
    expect(sourceKeyFor(reflowed)).toBe(sourceKeyFor(PROSE));
  });

  it("treats the spaces PDF extraction actually emits as whitespace", () => {
    // NBSP, thin space, narrow NBSP and a leading BOM all come out of pdf.js's
    // glyph-position spacing. If any of them hashed as a real character, the same
    // file would key differently on re-extraction.
    // Written as escapes on purpose - these characters are invisible in a
    // source file, and a "fix" that silently replaced one with a plain space
    // would make this test pass while testing nothing.
    const exotic =
      "\uFEFFThe\u00A0mind\u2009creates\u202Fhell through three attitudes:\u00A0aversion, attachment, and indifference.";
    expect(sourceKeyFor(exotic)).toBe(sourceKeyFor(PROSE));
  });

  it("separates words that were only separated by whitespace", () => {
    // Collapsing must not mean deleting: "a b" and "ab" are different sources.
    expect(sourceKeyFor("a b")).not.toBe(sourceKeyFor("ab"));
  });

  it("differs on different text", () => {
    expect(sourceKeyFor(PROSE)).not.toBe(sourceKeyFor(`${PROSE} And a fourth.`));
    expect(sourceKeyFor("aversion")).not.toBe(sourceKeyFor("attachment"));
  });

  it("differs on transposed text of the same length", () => {
    // A hash that only accumulated character codes would collide here.
    expect(sourceKeyFor("aversion attachment")).not.toBe(sourceKeyFor("attachment aversion"));
  });

  it("handles empty and whitespace-only input without collapsing them together with real text", () => {
    expect(sourceKeyFor("")).toBe(sourceKeyFor("   \n\t  "));
    expect(sourceKeyFor("")).not.toBe(sourceKeyFor("a"));
  });

  it("keys long text without collisions between neighbouring slices", () => {
    // Guards the property the dedup actually depends on: two chunks of the same
    // book must not key the same as each other.
    const long = PROSE.repeat(400);
    const keys = new Set([
      sourceKeyFor(long),
      sourceKeyFor(long.slice(1)),
      sourceKeyFor(long.slice(0, -1)),
      sourceKeyFor(`${long}.`),
    ]);
    expect(keys.size).toBe(4);
  });
});
