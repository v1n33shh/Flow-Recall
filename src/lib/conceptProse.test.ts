import { describe, expect, it } from "vitest";
import { factSentence, readableBody } from "./conceptProse";
import type { Concept } from "./types";

function concept(overrides: Partial<Concept> = {}): Concept {
  return {
    id: "c1",
    concept: "Stroke Volume",
    question: "How is stroke volume derived from ventricular volumes?",
    answer: "EDV minus ESV",
    distractor: "EDV plus ESV",
    cloze: "Stroke volume is calculated as _____.",
    explanation: "A full paragraph explaining the mechanism.",
    ...overrides,
  };
}

describe("factSentence", () => {
  it("fills the blank with the answer, so the fact reads as a statement", () => {
    expect(factSentence(concept())).toBe("Stroke volume is calculated as EDV minus ESV.");
  });

  it("adds terminal punctuation when the generator left it off", () => {
    expect(factSentence(concept({ cloze: "Stroke volume is _____" }))).toBe(
      "Stroke volume is EDV minus ESV.",
    );
  });

  it("keeps punctuation the generator already supplied", () => {
    expect(factSentence(concept({ cloze: "Is it _____?" }))).toBe("Is it EDV minus ESV?");
  });

  it("collapses the whitespace a substitution can leave behind", () => {
    expect(factSentence(concept({ cloze: "Stroke  volume is _____ ." }))).toBe(
      "Stroke volume is EDV minus ESV .",
    );
  });

  it("refuses a cloze with no blank rather than printing a sentence with a hole", () => {
    expect(factSentence(concept({ cloze: "Stroke volume has no blank at all." }))).toBeNull();
  });

  it("refuses a cloze with more than one blank", () => {
    // Two blanks cannot be filled from a single `answer` without guessing which
    // one it belongs to. Same guard ClozeChallenge applies before rendering.
    expect(factSentence(concept({ cloze: "_____ minus _____ gives it." }))).toBeNull();
  });

  it("refuses an empty answer", () => {
    expect(factSentence(concept({ answer: "   " }))).toBeNull();
  });

  it("works on a cloze whose blank is at the start", () => {
    expect(factSentence(concept({ cloze: "_____ is what gives stroke volume." }))).toBe(
      "EDV minus ESV is what gives stroke volume.",
    );
  });
});

describe("factSentence: substitutions that would stutter", () => {
  // Both of these are real cards from a real generated deck, caught on the device
  // when the revision sheet printed them. The prompt asks for substitutability in
  // prose and the model does not always comply.
  it("declines when the answer repeats a word already before the blank", () => {
    expect(
      factSentence(
        concept({
          cloze: "Stroke volume is calculated as end-diastolic volume minus _____.",
          answer: "EDV minus ESV",
        }),
      ),
    ).toBeNull();
  });

  it("declines when the answer repeats the stem of the word before the blank", () => {
    expect(
      factSentence(
        concept({
          cloze:
            "The Frank-Starling relationship states that greater preload strengthens contraction because stretching sarcomeres improves _____.",
          answer: "improved actin-myosin overlap",
        }),
      ),
    ).toBeNull();
  });

  it("declines an article stutter", () => {
    expect(
      factSentence(concept({ cloze: "It is known as the _____.", answer: "the aorta" })),
    ).toBeNull();
  });

  it("still allows a clean substitution that happens to share a distant word", () => {
    // "volume" appears in both, but far enough from the seam that the filled
    // sentence reads correctly - suppressing this would cost a good sentence.
    expect(
      factSentence(
        concept({
          cloze: "Stroke volume is the difference between the two ventricular _____.",
          answer: "volumes",
        }),
      ),
    ).toBe("Stroke volume is the difference between the two ventricular volumes.");
  });

  it("allows the ordinary case where nothing is repeated", () => {
    expect(
      factSentence(concept({ cloze: "Renin is released in response to _____.", answer: "reduced renal perfusion" })),
    ).toBe("Renin is released in response to reduced renal perfusion.");
  });

  it("does not trip on a short function word that is not repeated", () => {
    expect(
      factSentence(concept({ cloze: "The role of the aorta is to _____.", answer: "carry oxygenated blood" })),
    ).toBe("The role of the aorta is to carry oxygenated blood.");
  });
});

describe("readableBody", () => {
  it("prefers the explanation", () => {
    expect(readableBody(concept())).toBe("A full paragraph explaining the mechanism.");
  });

  it("falls back to the fact sentence for a deck generated before explanations existed", () => {
    expect(readableBody(concept({ explanation: undefined }))).toBe(
      "Stroke volume is calculated as EDV minus ESV.",
    );
  });

  it("treats a whitespace-only explanation as absent", () => {
    expect(readableBody(concept({ explanation: "   " }))).toBe(
      "Stroke volume is calculated as EDV minus ESV.",
    );
  });

  it("falls back to the question when the cloze is unusable too", () => {
    expect(
      readableBody(concept({ explanation: undefined, cloze: "no blank here" })),
    ).toBe("How is stroke volume derived from ventricular volumes?");
  });
});
