import { describe, expect, it } from "vitest";
import { normalizeForCompare } from "./clozeMatch";

function matches(a: string, b: string): boolean {
  return normalizeForCompare(a) === normalizeForCompare(b);
}

describe("normalizeForCompare", () => {
  it("is case-insensitive", () => {
    expect(matches("Mitochondria use chemical energy", "mitochondria use chemical energy")).toBe(true);
  });

  it("ignores a leading article", () => {
    expect(matches("a proton gradient", "proton gradient")).toBe(true);
  });

  it("ignores trailing punctuation", () => {
    expect(matches("proton gradient.", "proton gradient")).toBe(true);
  });

  it("ignores extra whitespace", () => {
    expect(matches("  proton   gradient  ", "proton gradient")).toBe(true);
  });

  it("ignores a plural/singular mismatch", () => {
    expect(matches("proton gradients", "proton gradient")).toBe(true);
  });

  // The bug found live on 2026-08-22: a naive end-of-string-only trailing-s
  // strip missed a verb-conjugation mismatch earlier in a multi-word answer.
  it("ignores a verb-conjugation mismatch on a non-final word", () => {
    expect(matches("excite electrons to higher energy states", "excites electrons to higher energy states")).toBe(
      true,
    );
  });

  it("still rejects a genuinely different answer", () => {
    expect(matches("proton gradient", "electron transport chain")).toBe(false);
  });

  it("still rejects a confusingly similar but distinct term", () => {
    expect(matches("ATP synthesis", "ATP synthase")).toBe(false);
  });

  it("still rejects swapped clauses in a compound answer", () => {
    expect(
      matches(
        "mitochondria use light, chloroplasts use chemical energy",
        "mitochondria use chemical energy, chloroplasts use light",
      ),
    ).toBe(false);
  });
});
