import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { Deck } from "@/lib/types";

// Mocked at the module boundary, like DeckExamDate's test next door: what matters
// here is the shape of the write this control commits, not localStorage.
const renameDeck = vi.fn();

vi.mock("@/lib/storage", () => ({
  renameDeck: (...args: unknown[]) => renameDeck(...args),
}));
vi.mock("@/lib/haptics", () => ({ vibrateTap: () => {} }));

const { default: DeckTitle } = await import("@/components/DeckTitle");

function deck(title = "Microsoft Word - lecture4_final(2)"): Deck {
  return { id: "deck-1", title, createdAt: 1_788_087_594_699, concepts: [] };
}

function openEditor(): HTMLInputElement {
  fireEvent.click(screen.getByRole("button", { name: /rename deck/i }));
  return screen.getByLabelText("Deck title") as HTMLInputElement;
}

/** What the browser does when Enter or Escape leaves the field: the key handler runs
 * and calls blur(), then the blur event fires. Spelled out because the commit path
 * depends on the ORDER of those two. */
function press(input: HTMLInputElement, key: string) {
  fireEvent.keyDown(input, { key });
  fireEvent.blur(input);
}

describe("DeckTitle", () => {
  beforeEach(() => renameDeck.mockClear());

  it("shows the deck's title as a heading until asked to edit", () => {
    render(<DeckTitle deck={deck()} />);
    expect(screen.getByRole("heading").textContent).toContain("lecture4_final(2)");
    expect(screen.queryByLabelText("Deck title")).toBeNull();
  });

  it("renames the deck against its own id, keeping every other field alone", () => {
    render(<DeckTitle deck={deck()} />);
    const input = openEditor();
    fireEvent.change(input, { target: { value: "Krebs Cycle — Lecture 4" } });
    press(input, "Enter");

    expect(renameDeck).toHaveBeenCalledWith("deck-1", "Krebs Cycle — Lecture 4");
  });

  it("commits on blur too - tapping elsewhere is how a phone leaves a field", () => {
    render(<DeckTitle deck={deck()} />);
    const input = openEditor();
    fireEvent.change(input, { target: { value: "Renamed by tapping away" } });
    fireEvent.blur(input);

    expect(renameDeck).toHaveBeenCalledWith("deck-1", "Renamed by tapping away");
  });

  it("normalises what a phone keyboard adds before storing it", () => {
    render(<DeckTitle deck={deck()} />);
    const input = openEditor();
    fireEvent.change(input, { target: { value: "  Krebs   Cycle  " } });
    press(input, "Enter");

    expect(renameDeck).toHaveBeenCalledWith("deck-1", "Krebs Cycle");
  });

  // A blank title is a row no screen in this app can render usefully, so an empty
  // edit has to mean "keep what was there" rather than "clear it".
  it("refuses to blank a title, and leaves the old one in place", () => {
    render(<DeckTitle deck={deck("Cardiac cycle")} />);
    const input = openEditor();
    fireEvent.change(input, { target: { value: "   " } });
    press(input, "Enter");

    expect(renameDeck).not.toHaveBeenCalled();
    expect(screen.getByRole("heading").textContent).toContain("Cardiac cycle");
  });

  it("discards the edit on Escape, even though blur follows it", () => {
    render(<DeckTitle deck={deck("Cardiac cycle")} />);
    const input = openEditor();
    fireEvent.change(input, { target: { value: "Typed then abandoned" } });
    press(input, "Escape");

    expect(renameDeck).not.toHaveBeenCalled();
    expect(screen.getByRole("heading").textContent).toContain("Cardiac cycle");
  });

  // An unchanged title still stamps updatedAt, which would send a no-op deck up on
  // the next sync - for a deck that can be megabytes.
  it("writes nothing when the title comes back unchanged", () => {
    render(<DeckTitle deck={deck("Cardiac cycle")} />);
    const input = openEditor();
    press(input, "Enter");

    expect(renameDeck).not.toHaveBeenCalled();
  });

  it("reopens on the CURRENT title after an abandoned edit", () => {
    render(<DeckTitle deck={deck("Cardiac cycle")} />);
    let input = openEditor();
    fireEvent.change(input, { target: { value: "Abandoned" } });
    press(input, "Escape");

    input = openEditor();
    expect(input.value).toBe("Cardiac cycle");
  });

  it("caps what can be typed at the stored maximum", () => {
    render(<DeckTitle deck={deck()} />);
    expect(openEditor().maxLength).toBe(120);
  });
});
