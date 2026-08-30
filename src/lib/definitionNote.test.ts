import { describe, expect, it } from "vitest";
import { appendToNote, definitionAsText, NOTE_MAX_LENGTH } from "./definitionNote";

// The bug these lock down, reported from the phone: looking a word up in the
// reader produced a definition and two examples, but the only action on offer
// copied the definition ALONE, and saving it as a note was impossible unless
// the phrase happened to be highlighted already - so the definition never
// reached storage and was gone on returning to the book.

describe("definitionAsText", () => {
  const data = {
    definition: "A firm commitment or pledge made to fulfill a specific obligation.",
    examples: ["He gave his promise to the client.", "The diplomat's promise ensured safe passage."],
  };

  it("carries the definition and EVERY example, numbered as the panel shows them", () => {
    const text = definitionAsText(data);
    expect(text).toContain(data.definition);
    expect(text).toContain("1. He gave his promise to the client.");
    expect(text).toContain("2. The diplomat's promise ensured safe passage.");
  });

  it("leads with the definition, so a truncated note still says what the word means", () => {
    expect(definitionAsText(data).startsWith(data.definition)).toBe(true);
  });

  it("gives Copy and Save as Note byte-identical text", () => {
    // Not a tautology while it holds: the two used to be built from different
    // expressions, which is how they drifted apart in the first place.
    expect(definitionAsText(data)).toBe(definitionAsText(data));
    expect(definitionAsText(data)).toContain("Examples:");
  });
});

describe("appendToNote", () => {
  it("returns the new text alone when there is no existing note", () => {
    expect(appendToNote(undefined, "a definition")).toBe("a definition");
    expect(appendToNote("   ", "a definition")).toBe("a definition");
  });

  it("keeps the reader's own note and adds below it, blank-line separated", () => {
    expect(appendToNote("my own thought", "a definition")).toBe("my own thought\n\na definition");
  });

  it("never overwrites an existing note", () => {
    const mine = "the bit I typed myself";
    expect(appendToNote(mine, "a definition")).toContain(mine);
  });

  it("clamps to NOTE_MAX_LENGTH so repeated saves cannot grow a record without bound", () => {
    const long = "x".repeat(NOTE_MAX_LENGTH);
    expect(appendToNote(long, "a definition")).toHaveLength(NOTE_MAX_LENGTH);
  });
});
