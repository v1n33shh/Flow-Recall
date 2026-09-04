import { describe, expect, it } from "vitest";
import { ConceptsResponseSchema, buildConceptsPrompt } from "./conceptSchema";

/** A card with every required field, so a test can be about the envelope rather than
 * about which fields RawConceptSchema demands. */
function card(concept = "mind mechanism") {
  return {
    concept,
    question: "What does the passage call the mind?",
    answer: "a mechanism",
    distractor: "a soul",
    cloze: "The mind is _____ .",
  };
}

describe("ConceptsResponseSchema", () => {
  it("accepts the wrapped shape the prompt asks for", () => {
    const parsed = ConceptsResponseSchema.safeParse({ concepts: [card()] });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.concepts).toHaveLength(1);
  });

  it("accepts a bare array, which is what the model sends one call in eight", () => {
    // Measured against openai/gpt-oss-120b on real chunks: 2 of 16 came back as a
    // top-level array, finish_reason "stop", valid JSON, correct cards. Rejecting
    // those charged the student for the request and reported it as garbled.
    const parsed = ConceptsResponseSchema.safeParse([card("a"), card("b")]);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.concepts.map((c) => c.concept)).toEqual(["a", "b"]);
  });

  it("still rejects an empty array in either shape", () => {
    expect(ConceptsResponseSchema.safeParse([]).success).toBe(false);
    expect(ConceptsResponseSchema.safeParse({ concepts: [] }).success).toBe(false);
  });

  it("still validates the cards themselves - only the wrapper is optional", () => {
    const missingAnswer = { ...card() } as Record<string, unknown>;
    delete missingAnswer.answer;
    expect(ConceptsResponseSchema.safeParse([missingAnswer]).success).toBe(false);
    expect(ConceptsResponseSchema.safeParse({ concepts: [missingAnswer] }).success).toBe(false);
  });

  it("rejects the shapes that are neither", () => {
    for (const bad of [null, "concepts", 7, { cards: [card()] }, [[card()]]]) {
      expect(ConceptsResponseSchema.safeParse(bad).success).toBe(false);
    }
  });

  it("still spells the wrapped shape out in the prompt", () => {
    // The tolerance above is a safety net, not permission to stop asking. A model
    // that follows the instruction costs one round trip; one that does not costs the
    // normalisation, and the instruction is what keeps the common case common.
    expect(buildConceptsPrompt("source")).toContain('{"concepts":[{');
  });
});
