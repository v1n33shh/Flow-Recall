import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

vi.mock("@/lib/haptics", () => ({ vibrateTap: () => {} }));

const { default: DeckUndoBar, UNDO_WINDOW_MS } = await import("@/components/DeckUndoBar");

const pending = { id: "deck-1", title: "Krebs Cycle — Lecture 4" };

describe("DeckUndoBar", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("renders nothing when there is nothing to undo", () => {
    render(<DeckUndoBar pending={null} onUndo={() => {}} onExpire={() => {}} />);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("names the deck it is offering to bring back", () => {
    render(<DeckUndoBar pending={pending} onUndo={() => {}} onExpire={() => {}} />);
    expect(screen.getByRole("status").textContent).toContain("Krebs Cycle — Lecture 4");
    expect(screen.getByRole("status").textContent).toContain("Deck deleted");
  });

  it("undoes on tap", () => {
    const onUndo = vi.fn();
    render(<DeckUndoBar pending={pending} onUndo={onUndo} onExpire={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(onUndo).toHaveBeenCalledTimes(1);
  });

  it("closes the window once, after exactly the offered time", () => {
    const onExpire = vi.fn();
    render(<DeckUndoBar pending={pending} onUndo={() => {}} onExpire={onExpire} />);

    act(() => void vi.advanceTimersByTime(UNDO_WINDOW_MS - 1));
    expect(onExpire).not.toHaveBeenCalled();

    act(() => void vi.advanceTimersByTime(1));
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  // A re-render for any other reason - a sync landing, a search keystroke - must not
  // hand the student a fresh six seconds they did not earn.
  it("does not restart the countdown when the same deletion re-renders", () => {
    const onExpire = vi.fn();
    const { rerender } = render(
      <DeckUndoBar pending={pending} onUndo={() => {}} onExpire={onExpire} />,
    );

    act(() => void vi.advanceTimersByTime(UNDO_WINDOW_MS - 500));
    rerender(<DeckUndoBar pending={{ ...pending }} onUndo={() => {}} onExpire={onExpire} />);
    act(() => void vi.advanceTimersByTime(500));

    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it("gives a second deletion its own full window", () => {
    const onExpire = vi.fn();
    const { rerender } = render(
      <DeckUndoBar pending={pending} onUndo={() => {}} onExpire={onExpire} />,
    );

    act(() => void vi.advanceTimersByTime(UNDO_WINDOW_MS - 500));
    rerender(
      <DeckUndoBar
        pending={{ id: "deck-2", title: "Cardiac Cycle" }}
        onUndo={() => {}}
        onExpire={onExpire}
      />,
    );
    act(() => void vi.advanceTimersByTime(500));
    expect(onExpire).not.toHaveBeenCalled();

    act(() => void vi.advanceTimersByTime(UNDO_WINDOW_MS));
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it("stops counting when the offer is withdrawn", () => {
    const onExpire = vi.fn();
    const { rerender } = render(
      <DeckUndoBar pending={pending} onUndo={() => {}} onExpire={onExpire} />,
    );
    rerender(<DeckUndoBar pending={null} onUndo={() => {}} onExpire={onExpire} />);

    act(() => void vi.advanceTimersByTime(UNDO_WINDOW_MS * 2));
    expect(onExpire).not.toHaveBeenCalled();
  });
});
