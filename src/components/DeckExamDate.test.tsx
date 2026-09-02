import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { Deck } from "@/lib/types";

// The three things this component reaches out to. Mocked at the module boundary so
// the test asserts what the control *does* - the shape of the value it commits -
// without a session, IndexedDB or localStorage.
const setDeckExamDate = vi.fn();
const applyExamDateToMemory = vi.fn().mockResolvedValue(undefined);

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { id: "student-1" } } }),
}));
vi.mock("@/lib/storage", () => ({
  setDeckExamDate: (...args: unknown[]) => setDeckExamDate(...args),
}));
vi.mock("@/lib/recallStorage", () => ({
  applyExamDateToMemory: (...args: unknown[]) => applyExamDateToMemory(...args),
}));

const { default: DeckExamDate } = await import("@/components/DeckExamDate");

function deck(examDate?: number): Deck {
  return {
    id: "deck-1",
    title: "Cardiac cycle - lecture 4",
    createdAt: 1_788_087_594_699,
    concepts: [],
    examDate,
  };
}

function dateInput(): HTMLInputElement {
  const input = document.querySelector('input[type="date"]');
  if (!input) throw new Error("no date input rendered");
  return input as HTMLInputElement;
}

describe("DeckExamDate", () => {
  beforeEach(() => {
    setDeckExamDate.mockClear();
    applyExamDateToMemory.mockClear();
  });

  it("offers no Clear until a date is set", () => {
    // Clear is the only way back out, so it must appear exactly when there is
    // something to clear - and never as a hover-only control, which is why it is
    // queried as a real button here.
    render(<DeckExamDate deck={deck()} />);
    expect(screen.queryByRole("button", { name: "Clear" })).toBeNull();
    expect(dateInput().value).toBe("");
  });

  it("shows the date, the countdown and Clear once one is set", () => {
    const tenDaysOut = new Date();
    tenDaysOut.setHours(0, 0, 0, 0);
    tenDaysOut.setDate(tenDaysOut.getDate() + 10);
    render(<DeckExamDate deck={deck(tenDaysOut.getTime())} />);
    expect(screen.getByRole("button", { name: "Clear" })).toBeTruthy();
    expect(screen.getByText("in 10 days")).toBeTruthy();
  });

  it("renders the stored date in local terms, not UTC's", () => {
    // toISOString() would print the previous day for anyone east of UTC after
    // their afternoon - the bug this component's toInputValue exists to avoid.
    const localMidnight = new Date(2026, 8, 12).getTime(); // 12 Sep 2026, local
    render(<DeckExamDate deck={deck(localMidnight)} />);
    expect(dateInput().value).toBe("2026-09-12");
  });

  it("commits local midnight for the day the student picked", () => {
    render(<DeckExamDate deck={deck()} />);
    const input = dateInput();
    // React tracks the value it set, so a plain assignment is deduped as "no
    // change" - the same trap that makes CDP writes to this input a no-op.
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(input, "2026-09-12");
    input.dispatchEvent(new Event("input", { bubbles: true }));

    expect(setDeckExamDate).toHaveBeenCalledTimes(1);
    const [deckId, committed] = setDeckExamDate.mock.calls[0] as [string, number];
    expect(deckId).toBe("deck-1");
    // Parsed from the parts: local midnight on the 12th, never `new Date(string)`,
    // which reads a bare YYYY-MM-DD as UTC midnight.
    expect(committed).toBe(new Date(2026, 8, 12).getTime());
    const asLocal = new Date(committed);
    expect(asLocal.getDate()).toBe(12);
    expect(asLocal.getHours()).toBe(0);
  });

  it("sweeps existing memory rows, not just the deck row", () => {
    // The deck row alone would leave everything already studied on the old
    // retention target: a student who set a date and studied would be drilled, and
    // one who set it and looked at the screen would see nothing happen.
    render(<DeckExamDate deck={deck()} />);
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(dateInput(), "2026-09-12");
    dateInput().dispatchEvent(new Event("input", { bubbles: true }));
    expect(applyExamDateToMemory).toHaveBeenCalledWith("student-1", "deck-1");
  });

  it("commits null when the student clears the field", () => {
    render(<DeckExamDate deck={deck(new Date(2026, 8, 12).getTime())} />);
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(setDeckExamDate).toHaveBeenCalledWith("deck-1", null);
  });
});
