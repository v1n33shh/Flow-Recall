import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { Concept } from "@/lib/types";

// Both of the debrief's composed features are whole features of their own - a textarea
// and a fetch, an IndexedDB read and a scheduler write - and both reach for a session.
// Stubbed so this file tests the debrief's asymmetry and nothing else; each has its own
// file beside it.
vi.mock("@/components/ConceptAsk", () => ({ default: () => null }));
vi.mock("@/components/ConceptStar", () => ({ default: () => null }));

const { default: ConceptDebrief } = await import("@/components/ConceptDebrief");

const EXPLANATION =
  "Stretching the sarcomeres improves actin-myosin overlap, so the same calcium " +
  "signal produces more force.";
const MISCONCEPTION =
  "Students confuse stroke volume with cardiac output because both are per-beat " +
  "quantities.";

function concept(overrides: Partial<Concept> = {}): Concept {
  return {
    id: "c1",
    concept: "Frank-Starling Mechanism",
    question: "What raises stroke volume as venous return rises?",
    answer: "Increased sarcomere stretch",
    distractor: "Increased heart rate",
    cloze: "Stroke volume rises because of increased _____.",
    explanation: EXPLANATION,
    misconception: MISCONCEPTION,
    ...overrides,
  };
}

describe("ConceptDebrief", () => {
  it("opens the explanation with no tap when the student got it wrong", () => {
    // The reason this component exists: the moment of maximum readiness to learn
    // was previously treated exactly like the moment of minimum need.
    render(<ConceptDebrief concept={concept()} unitId="d::c1" correct={false} />);
    expect(screen.getByText(EXPLANATION)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Read the deep dive/ })).toBeNull();
    expect(screen.getByText("Not quite")).toBeTruthy();
  });

  it("keeps the explanation opt-in when the student got it right", () => {
    // Nobody wants a lecture after a success - but the way in is a real bordered
    // control, not a hover-underlined text link that does not exist on a phone.
    render(<ConceptDebrief concept={concept()} unitId="d::c1" correct />);
    expect(screen.queryByText(EXPLANATION)).toBeNull();
    const open = screen.getByRole("button", { name: /Read the deep dive/ });
    fireEvent.click(open);
    expect(screen.getByText(EXPLANATION)).toBeTruthy();
  });

  it("names why the wrong answer looked right, and only on a failure", () => {
    render(<ConceptDebrief concept={concept()} unitId="d::c1" correct={false} />);
    expect(screen.getByText("Why that looked right")).toBeTruthy();
    expect(screen.getByText(MISCONCEPTION)).toBeTruthy();
  });

  it("does not raise a misconception at a student who was right", () => {
    render(<ConceptDebrief concept={concept()} unitId="d::c1" correct />);
    expect(screen.queryByText("Why that looked right")).toBeNull();
  });

  it("asks about confidence only when the caller offers the question", () => {
    const onConfidence = vi.fn();
    render(
      <ConceptDebrief
        concept={concept()}
        unitId="d::c1"
        correct={false}
        onConfidence={onConfidence}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "I thought I knew it" }));
    expect(onConfidence).toHaveBeenCalledWith("knew-it");
    // A thought-I-knew-it failure is the strongest evidence of a real
    // misconception, so the student is told it was recorded rather than left
    // wondering whether the tap did anything.
    expect(screen.getByText(/won't count as solid/)).toBeTruthy();
  });

  it("takes one confidence answer, not several", () => {
    const onConfidence = vi.fn();
    render(
      <ConceptDebrief
        concept={concept()}
        unitId="d::c1"
        correct={false}
        onConfidence={onConfidence}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "I guessed" }));
    expect(screen.queryByRole("button", { name: "I thought I knew it" })).toBeNull();
    expect(onConfidence).toHaveBeenCalledTimes(1);
  });

  it("omits the confidence question entirely when it is not offered", () => {
    render(<ConceptDebrief concept={concept()} unitId="d::c1" correct={false} />);
    expect(screen.queryByRole("button", { name: "I guessed" })).toBeNull();
  });

  it("suppresses the answer when the format already shows it", () => {
    // The swipe states the answer under its own ANSWER label directly above this;
    // repeating it 100px lower reads as a stutter.
    render(
      <ConceptDebrief concept={concept()} unitId="d::c1" correct={false} showAnswer={false} />,
    );
    expect(screen.queryByText("Increased sarcomere stretch")).toBeNull();
    expect(screen.getByText("Not quite")).toBeTruthy();
  });

  it("degrades to the verdict alone for a deck generated before these fields", () => {
    render(
      <ConceptDebrief
        concept={concept({ explanation: undefined, misconception: undefined })}
        unitId="d::c1"
        correct={false}
      />,
    );
    expect(screen.getByText("Not quite")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Read the deep dive/ })).toBeNull();
    expect(screen.queryByText("Why that looked right")).toBeNull();
  });
});
