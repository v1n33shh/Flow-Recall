import { describe, expect, it } from "vitest";
import { applyQualityGate } from "./conceptQuality";
import type { RawConcept } from "./conceptSchema";

function raw(overrides: Partial<RawConcept> = {}): RawConcept {
  return {
    concept: "Stroke Volume",
    question: "How is stroke volume derived from ventricular volumes?",
    answer: "end-systolic volume",
    distractor: "end-diastolic volume",
    cloze: "Stroke volume is end-diastolic volume minus _____.",
    explanation: "A full paragraph.",
    ...overrides,
  };
}

describe("applyQualityGate", () => {
  it("passes a clean card through untouched", () => {
    const input = raw();
    const { concepts, report } = applyQualityGate([input]);
    expect(concepts).toEqual([input]);
    expect(report).toEqual({ total: 1, clozeCleared: 0, dropped: 0 });
  });

  // The real card from the device. The answer restates the whole fact, so the
  // student who types the genuinely correct "end-systolic volume" is graded
  // against "EDV minus ESV" and marked wrong.
  it("clears a cloze the answer cannot fill", () => {
    const { concepts, report } = applyQualityGate([
      raw({ answer: "EDV minus ESV", cloze: "Stroke volume is end-diastolic volume minus _____." }),
    ]);
    expect(concepts).toHaveLength(1);
    expect(concepts[0].cloze).toBe("");
    expect(report.clozeCleared).toBe(1);
    expect(report.dropped).toBe(0);
  });

  it("clears a cloze whose answer repeats the stem before the blank", () => {
    const { concepts } = applyQualityGate([
      raw({ answer: "improved actin-myosin overlap", cloze: "Stretching sarcomeres improves _____." }),
    ]);
    expect(concepts[0].cloze).toBe("");
  });

  it("clears a cloze with no blank at all", () => {
    const { concepts, report } = applyQualityGate([raw({ cloze: "No blank in this sentence." })]);
    expect(concepts[0].cloze).toBe("");
    expect(report.clozeCleared).toBe(1);
  });

  it("keeps every other field when it clears a cloze", () => {
    // The reason this repairs rather than rejects: a FREE user gets one deck for
    // life, and the question, answer, distractor and explanation are all fine.
    const input = raw({ answer: "EDV minus ESV", misconception: "They conflate the two volumes." });
    const { concepts } = applyQualityGate([input]);
    expect(concepts[0]).toEqual({ ...input, cloze: "" });
  });

  it("drops a card whose distractor is the answer", () => {
    // Unrepairable: the swipe would assert a true claim and mark it false half
    // the time, so the card is unanswerable rather than merely degraded.
    const { concepts, report } = applyQualityGate([
      raw({ answer: "end-systolic volume", distractor: "end-systolic volume" }),
    ]);
    expect(concepts).toHaveLength(0);
    expect(report).toEqual({ total: 1, clozeCleared: 0, dropped: 1 });
  });

  it("sees through case, padding and trailing punctuation on that comparison", () => {
    const { report } = applyQualityGate([
      raw({ answer: "End-Systolic Volume", distractor: "  end-systolic volume.  " }),
    ]);
    expect(report.dropped).toBe(1);
  });

  it("keeps a card whose distractor is genuinely different", () => {
    const { report } = applyQualityGate([
      raw({ answer: "end-systolic volume", distractor: "end-diastolic volume" }),
    ]);
    expect(report.dropped).toBe(0);
  });

  it("reports across a mixed batch and preserves order", () => {
    const good = raw({ concept: "A" });
    const badCloze = raw({ concept: "B", answer: "EDV minus ESV" });
    const badDistractor = raw({ concept: "C", distractor: "end-systolic volume" });
    const { concepts, report } = applyQualityGate([good, badCloze, badDistractor, raw({ concept: "D" })]);
    expect(concepts.map((c) => c.concept)).toEqual(["A", "B", "D"]);
    expect(report).toEqual({ total: 4, clozeCleared: 1, dropped: 1 });
  });

  it("canonicalises the seven underscores the model emits", () => {
    const { concepts, report } = applyQualityGate([
      raw({ cloze: "Stroke volume is end-diastolic volume minus _______." }),
    ]);
    expect(concepts[0].cloze).toBe("Stroke volume is end-diastolic volume minus _____.");
    expect(report.clozeCleared).toBe(0);
  });

  it("clears a card whose answer repeats the word after the blank", () => {
    // "S2 follows closure of the _____ valves." + "aortic and pulmonary valves"
    // fills to "valves valves." - a real card from the model.
    const { concepts, report } = applyQualityGate([
      raw({ cloze: "S2 follows closure of the _______ valves.", answer: "aortic and pulmonary valves" }),
    ]);
    expect(concepts[0].cloze).toBe("");
    expect(report.clozeCleared).toBe(1);
  });

  it("handles an empty batch", () => {
    expect(applyQualityGate([])).toEqual({
      concepts: [],
      report: { total: 0, clozeCleared: 0, dropped: 0 },
    });
  });
});
