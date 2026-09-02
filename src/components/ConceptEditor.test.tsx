import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { Concept } from "@/lib/types";

const updateConcept = vi.fn();
const deleteConcept = vi.fn();
const getSavedDecks = vi.fn(() => [{ id: "deck-1", concepts: [] }]);
const importDeck = vi.fn().mockResolvedValue([]);
const forgetUnit = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/storage", () => ({
  updateConcept: (...a: unknown[]) => updateConcept(...a),
  deleteConcept: (...a: unknown[]) => deleteConcept(...a),
  getSavedDecks: () => getSavedDecks(),
}));
vi.mock("@/lib/recallStorage", () => ({
  importDeck: (...a: unknown[]) => importDeck(...a),
  forgetUnit: (...a: unknown[]) => forgetUnit(...a),
}));

const { default: ConceptEditor } = await import("@/components/ConceptEditor");

function concept(overrides: Partial<Concept> = {}): Concept {
  return {
    id: "c1",
    concept: "Frank-Starling Mechanism",
    question: "What raises stroke volume as venous return rises?",
    answer: "Increased sarcomere stretch",
    distractor: "Increased heart rate",
    cloze: "Stroke volume rises because of increased _____.",
    ...overrides,
  };
}

function setup(c: Concept = concept(), userId: string | undefined = "student-1") {
  const onDone = vi.fn();
  render(<ConceptEditor deckId="deck-1" concept={c} userId={userId} onDone={onDone} />);
  return { onDone };
}

// Passing `undefined` into setup would hit the default parameter and quietly run
// the signed-IN path, so the signed-out case renders directly.
function setupSignedOut(c: Concept = concept()) {
  const onDone = vi.fn();
  render(<ConceptEditor deckId="deck-1" concept={c} userId={undefined} onDone={onDone} />);
  return { onDone };
}

function field(label: string): HTMLTextAreaElement {
  const found = screen
    .getAllByRole("textbox")
    .find((el) => el.closest("label")?.textContent?.startsWith(label));
  if (!found) throw new Error(`no field labelled ${label}`);
  return found as HTMLTextAreaElement;
}

function type(label: string, value: string) {
  fireEvent.change(field(label), { target: { value } });
}

describe("ConceptEditor", () => {
  beforeEach(() => {
    updateConcept.mockClear();
    deleteConcept.mockClear();
    importDeck.mockClear();
    forgetUnit.mockClear();
  });

  it("saves the correction against the same card id", async () => {
    // The id is the history. A "fix" that minted a new one would silently discard
    // every review the student has earned on this concept.
    const { onDone } = setup();
    type("Answer", "Sarcomere stretch");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await vi.waitFor(() => expect(onDone).toHaveBeenCalled());

    expect(updateConcept).toHaveBeenCalledTimes(1);
    const [deckId, saved] = updateConcept.mock.calls[0] as [string, Concept];
    expect(deckId).toBe("deck-1");
    expect(saved.id).toBe("c1");
    expect(saved.answer).toBe("Sarcomere stretch");
  });

  it("canonicalises the blank on the way in", async () => {
    // Every consumer keys on exactly five underscores; a hand-typed run of three
    // would otherwise render as visible text.
    const { onDone } = setup();
    type("Fill the blank", "Stroke volume rises because of increased ___.");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await vi.waitFor(() => expect(onDone).toHaveBeenCalled());
    const [, saved] = updateConcept.mock.calls[0] as [string, Concept];
    expect(saved.cloze).toContain("_____");
  });

  it("re-imports the deck so the engine stops asking the old text", async () => {
    const { onDone } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await vi.waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(importDeck).toHaveBeenCalledTimes(1);
    expect(forgetUnit).not.toHaveBeenCalled();
  });

  it("drops the unit when an edit leaves nothing to ask", async () => {
    // importDeck uses put(), which overwrites but never deletes - so a card edited
    // past every retrieval path would keep its pre-edit unit and be asked forever.
    const { onDone } = setup();
    type("Answer", "");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await vi.waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(forgetUnit).toHaveBeenCalledWith("student-1", "deck-1::c1");
    expect(importDeck).not.toHaveBeenCalled();
  });

  it("says so when a card that was never asked becomes askable", () => {
    // The rescue case: applyQualityGate clears a cloze it cannot trust, and a card
    // with no path was silently never scheduled at all. Repairing the blank is what
    // brings it back, so the message has to appear on the repaired draft.
    setup(concept({ cloze: "", distractor: "" }));
    expect(screen.getByText(/Nothing to ask yet/)).toBeTruthy();
    type("Fill the blank", "Stroke volume rises because of increased _____.");
    expect(screen.getByText(/wasn't being asked before/)).toBeTruthy();
  });

  it("warns when a card has nothing the engine can ask", () => {
    setup(concept({ answer: "", cloze: "", distractor: "" }));
    expect(screen.getByText(/Nothing to ask yet/)).toBeTruthy();
  });

  it("warns when the wrong answer restates the answer", () => {
    // The card would then assert a true claim and mark it false half the time.
    setup(concept({ distractor: "increased sarcomere stretch" }));
    expect(screen.getByText(/says the same thing as the answer/)).toBeTruthy();
  });

  it("takes two taps to delete, and never deletes on the first", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(deleteConcept).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Delete for good?" })).toBeTruthy();
  });

  it("removes the card and its schedule on the second tap", async () => {
    const { onDone } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete for good?" }));
    await vi.waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(deleteConcept).toHaveBeenCalledWith("deck-1", "c1");
    expect(forgetUnit).toHaveBeenCalledWith("student-1", "deck-1::c1");
  });

  it("touches no engine state when signed out", async () => {
    const { onDone } = setupSignedOut();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await vi.waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(updateConcept).toHaveBeenCalledTimes(1);
    expect(importDeck).not.toHaveBeenCalled();
    expect(forgetUnit).not.toHaveBeenCalled();
  });

  it("closes without writing anything when cancelled", () => {
    const { onDone } = setup();
    type("Answer", "something else");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onDone).toHaveBeenCalled();
    expect(updateConcept).not.toHaveBeenCalled();
  });
});
