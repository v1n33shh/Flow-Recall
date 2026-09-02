import { describe, expect, it } from "vitest";
import {
  MAX_ATTEMPT_LENGTH,
  TeachBackResponseSchema,
  buildTeachBackPrompt,
  teachBackRequestSchema,
} from "./teachBackSchema";

const request = {
  label: "Frank-Starling Mechanism",
  question: "What does increased preload do to stroke volume?",
  answer: "raises it, via improved actin-myosin overlap",
  explanation: "Stretching the ventricle improves filament overlap, so each beat ejects more.",
  attempt: "When the heart fills more, the muscle stretches and squeezes harder.",
};

describe("TeachBackResponseSchema", () => {
  it("keeps all three lists", () => {
    const parsed = TeachBackResponseSchema.parse({
      correct: ["You got the stretch."],
      missing: ["The material also names the filament overlap."],
      wrong: ["You said the heart rate rises; the material does not."],
    });
    expect(parsed.correct).toHaveLength(1);
    expect(parsed.missing).toHaveLength(1);
    expect(parsed.wrong).toHaveLength(1);
  });

  // A missing key should cost that key, not the whole debrief - there is no
  // generateObject on the pinned model, so the response is hand-parsed and a
  // perfect attempt legitimately has nothing in two of the three lists.
  it("defaults an omitted list to empty rather than failing the response", () => {
    expect(TeachBackResponseSchema.parse({ correct: ["You got it."] })).toEqual({
      correct: ["You got it."],
      missing: [],
      wrong: [],
    });
  });

  it("parses an empty object, which is why the route checks for three empty lists", () => {
    const parsed = TeachBackResponseSchema.parse({});
    expect(parsed.correct.length + parsed.missing.length + parsed.wrong.length).toBe(0);
  });

  it("drops nothing silently: too many entries fails rather than truncating", () => {
    const seven = Array.from({ length: 7 }, (_, i) => `point ${i}`);
    expect(TeachBackResponseSchema.safeParse({ correct: seven }).success).toBe(false);
  });
});

describe("teachBackRequestSchema", () => {
  it("accepts an attempt at the cap and rejects one past it", () => {
    expect(
      teachBackRequestSchema.safeParse({ ...request, attempt: "x".repeat(MAX_ATTEMPT_LENGTH) })
        .success,
    ).toBe(true);
    expect(
      teachBackRequestSchema.safeParse({ ...request, attempt: "x".repeat(MAX_ATTEMPT_LENGTH + 1) })
        .success,
    ).toBe(false);
  });

  it("rejects an empty attempt, so a blank box never costs a call", () => {
    expect(teachBackRequestSchema.safeParse({ ...request, attempt: "   " }).success).toBe(false);
  });

  it("treats the explanation as optional, because decks predate the field", () => {
    const { explanation, ...withoutExplanation } = request;
    expect(explanation).toBeTypeOf("string");
    const parsed = teachBackRequestSchema.parse(withoutExplanation);
    expect(parsed.explanation).toBe("");
  });
});

describe("buildTeachBackPrompt", () => {
  it("carries the student's own words and the card's material", () => {
    const prompt = buildTeachBackPrompt(teachBackRequestSchema.parse(request));
    expect(prompt).toContain(request.attempt);
    expect(prompt).toContain(request.label);
    expect(prompt).toContain(request.answer);
    expect(prompt).toContain(request.explanation);
  });

  it("omits the explanation line entirely when there is none", () => {
    const prompt = buildTeachBackPrompt(
      teachBackRequestSchema.parse({ ...request, explanation: "" }),
    );
    expect(prompt).not.toContain("Explanation on the card:");
  });

  // The two failures a student would be right to resent, both spelled out in the
  // prompt because the model reaches for them on its own.
  it("forbids marking a student wrong for going beyond their own card", () => {
    const prompt = buildTeachBackPrompt(teachBackRequestSchema.parse(request));
    expect(prompt).toContain("does not mention is NOT wrong");
    expect(prompt).toContain("it is NOT missing");
  });

  it("asks for no score, since the lists are the feedback", () => {
    expect(buildTeachBackPrompt(teachBackRequestSchema.parse(request))).toContain(
      "No score, no grade",
    );
  });
});
