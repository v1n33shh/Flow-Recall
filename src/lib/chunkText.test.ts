import { describe, expect, it } from "vitest";
import { chunkText, splitSentences } from "./chunkText";

/** Every chunk edge, expressed as "the last 40 characters before the break" -
 * which is what actually has to look like the end of a sentence. */
function tails(chunks: string[]): string[] {
  return chunks.slice(0, -1).map((chunk) => chunk.slice(-40));
}

describe("splitSentences", () => {
  it("splits on the three terminators", () => {
    expect(splitSentences("One fact. A second? A third!")).toEqual([
      "One fact.",
      "A second?",
      "A third!",
    ]);
  });

  it("keeps an abbreviation with its sentence", () => {
    expect(splitSentences("Ask Dr. Bose about it. Then leave.")).toEqual([
      "Ask Dr. Bose about it.",
      "Then leave.",
    ]);
  });

  it("keeps e.g. and i.e. with their sentence", () => {
    expect(splitSentences("Use a marker, e.g. a pen. Then write.")).toEqual([
      "Use a marker, e.g. a pen.",
      "Then write.",
    ]);
  });

  it("keeps initials with their sentence", () => {
    expect(splitSentences("Read J. R. R. Tolkien first. Then rest.")).toEqual([
      "Read J. R. R. Tolkien first.",
      "Then rest.",
    ]);
  });

  it("does not split a decimal or a URL", () => {
    expect(splitSentences("The ratio is 3.5 at www.example.com today.")).toEqual([
      "The ratio is 3.5 at www.example.com today.",
    ]);
  });

  it("does not split where the text continues in lower case", () => {
    // The single defence that covers the abbreviations no list can enumerate.
    expect(splitSentences("He met Bhagwan. sri Rajneesh spoke.")).toEqual([
      "He met Bhagwan. sri Rajneesh spoke.",
    ]);
  });

  it("splits after an ellipsis", () => {
    expect(splitSentences("It simply is... The rest is silence.")).toEqual([
      "It simply is...",
      "The rest is silence.",
    ]);
  });

  it("splits a numbered heading from the sentence after it", () => {
    expect(splitSentences("Chapter 3. The seed must die.")).toEqual([
      "Chapter 3.",
      "The seed must die.",
    ]);
  });
});

describe("chunkText", () => {
  it("returns one chunk when the text fits", () => {
    expect(chunkText("Short enough.", 100)).toEqual(["Short enough."]);
  });

  it("drops empty paragraphs rather than emitting empty chunks", () => {
    const chunks = chunkText("First.\n\n\n\n   \n\nSecond.", 100);
    expect(chunks).toEqual(["First.\n\nSecond."]);
  });

  it("respects the size budget", () => {
    const paragraph = "A sentence of a certain length. ".repeat(60);
    for (const chunk of chunkText(paragraph, 200)) {
      expect(chunk.length).toBeLessThanOrEqual(200);
    }
  });

  it("breaks a long paragraph only at sentence ends", () => {
    // A PDF page arrives as ONE paragraph of several thousand characters, which
    // is exactly the case the old hard slice mutilated: it cut at a fixed offset,
    // mid-word, and every card generated from the fragment was built on half a
    // claim. Each break must now land after a terminator.
    const paragraph = Array.from(
      { length: 40 },
      (_, i) => `Sentence number ${i} says something worth remembering about the material.`,
    ).join(" ");

    const chunks = chunkText(paragraph, 300);
    expect(chunks.length).toBeGreaterThan(1);
    for (const tail of tails(chunks)) {
      expect(tail).toMatch(/[.!?…]["'”’)\]]*$/);
    }
  });

  it("never cuts a word in half", () => {
    const paragraph = "unpunctuated words running on and on ".repeat(40);
    const words = new Set(paragraph.trim().split(/\s+/));
    for (const chunk of chunkText(paragraph, 120)) {
      for (const word of chunk.split(/\s+/)) {
        expect(words.has(word)).toBe(true);
      }
    }
  });

  it("hard-splits a single word longer than the whole budget", () => {
    // Nothing left to respect, but it must still terminate rather than loop.
    const chunks = chunkText("x".repeat(250), 100);
    expect(chunks.map((chunk) => chunk.length)).toEqual([100, 100, 50]);
  });

  it("keeps packing paragraphs after a long one was split", () => {
    // The tail of a split paragraph is still short, so the paragraphs that
    // follow belong with it - otherwise a book of long pages sends one
    // near-empty request per page and burns the rate limit for nothing.
    const long = "A sentence that is long enough to matter here. ".repeat(6).trim();
    const chunks = chunkText(`${long}\n\nShort tail paragraph.`, 200);
    expect(chunks[chunks.length - 1]).toContain("Short tail paragraph.");
    expect(chunks[chunks.length - 1]).not.toBe("Short tail paragraph.");
  });

  it("loses no words from the source", () => {
    const source = [
      "The first paragraph makes a claim. It then supports that claim at length.",
      "The second paragraph is a single sentence that runs considerably longer than the budget allows, so it has to be broken somewhere inside itself.",
      "A third, shorter one.",
    ].join("\n\n");

    const rejoined = chunkText(source, 80).join(" ").split(/\s+/).join(" ");
    expect(rejoined).toBe(source.split(/\s+/).join(" "));
  });
});
