import { describe, expect, it } from "vitest";
import { MAX_DECK_TITLE, normaliseDeckTitle } from "./deckTitle";

describe("normaliseDeckTitle", () => {
  it("keeps an ordinary title as it was typed", () => {
    expect(normaliseDeckTitle("Krebs Cycle — Lecture 4")).toBe("Krebs Cycle — Lecture 4");
  });

  it("trims what a phone keyboard adds on its own", () => {
    expect(normaliseDeckTitle("  Cardiac Cycle ")).toBe("Cardiac Cycle");
  });

  it("collapses internal runs of whitespace, so one title cannot become two", () => {
    expect(normaliseDeckTitle("Krebs   Cycle")).toBe("Krebs Cycle");
    expect(normaliseDeckTitle("Krebs\tCycle\nNotes")).toBe("Krebs Cycle Notes");
  });

  it("refuses an empty or whitespace-only title, which callers read as 'keep the old one'", () => {
    expect(normaliseDeckTitle("")).toBeNull();
    expect(normaliseDeckTitle("    ")).toBeNull();
    expect(normaliseDeckTitle("\n\t")).toBeNull();
  });

  it("caps a pasted wall of text without leaving a dangling space", () => {
    const long = normaliseDeckTitle("word ".repeat(200));
    expect(long).not.toBeNull();
    expect(long!.length).toBeLessThanOrEqual(MAX_DECK_TITLE);
    expect(long!.endsWith(" ")).toBe(false);
  });

  it("stays well under the 500 /api/sync accepts", () => {
    expect(MAX_DECK_TITLE).toBeLessThan(500);
  });
});
