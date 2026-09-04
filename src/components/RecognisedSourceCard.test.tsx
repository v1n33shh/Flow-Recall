import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { Deck } from "@/lib/types";
import RecognisedSourceCard from "@/components/RecognisedSourceCard";

// The card is what a student meets when they re-upload a book, and most of its states
// have never been seen by anyone: the device this app is developed on holds a PRO
// account, so every "you have run out" branch below existed only on paper. They are the
// states that decide whether a student thinks the app is broken or budgeted.

function deck(partial: Partial<Deck> = {}): Deck {
  return {
    id: "deck-1",
    title: "The Book of Wisdom",
    createdAt: Date.now() - 86_400_000,
    updatedAt: Date.now(),
    concepts: Array.from({ length: 60 }, (_, i) => ({
      id: `c${i}`,
      concept: `concept ${i}`,
      question: "q",
      answer: "a",
    })),
    pendingChunks: Array.from({ length: 12 }, (_, i) => `chunk ${i}`),
    ...partial,
  } as Deck;
}

function renderCard(props: Partial<React.ComponentProps<typeof RecognisedSourceCard>> = {}) {
  const handlers = {
    onContinue: vi.fn(),
    onStop: vi.fn(),
    onStartSeparate: vi.fn(),
    onStudy: vi.fn(),
  };
  render(
    <RecognisedSourceCard
      deck={deck()}
      allowance={null}
      continuing={false}
      progress={null}
      {...handlers}
      {...props}
    />,
  );
  return handlers;
}

describe("what the card says about the deck", () => {
  it("names the deck and counts both what is done and what is left", () => {
    renderCard();
    expect(screen.getByText("The Book of Wisdom")).toBeTruthy();
    expect(screen.getByText(/60 cards · 12 sections left/)).toBeTruthy();
  });

  it("counts one remaining section as a section", () => {
    renderCard({ deck: deck({ pendingChunks: ["only one"] }) });
    expect(screen.getByText(/1 section left/)).toBeTruthy();
    expect(screen.queryByText(/1 sections left/)).toBeNull();
  });

  it("offers study rather than generation once nothing is left", () => {
    // Never reached on the device - no deck there has ever hit zero pending. Offering
    // "Continue this deck" here would be a button that generates nothing.
    const handlers = renderCard({ deck: deck({ pendingChunks: [] }) });
    expect(screen.getByText(/Fully generated · 60 cards/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Continue this deck/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Study this deck/ }));
    expect(handlers.onStudy).toHaveBeenCalledOnce();
    expect(handlers.onContinue).not.toHaveBeenCalled();
  });
});

describe("what the card says about the allowance", () => {
  it("says the run will finish when the allowance covers it", () => {
    renderCard({ allowance: { remaining: 1946, limit: 2000 } });
    expect(screen.getByText(/1946 more sections this month - enough to finish this/)).toBeTruthy();
  });

  it("warns when the allowance will not cover the book", () => {
    // The whole point of showing a number here: being stopped 8 sections into a
    // twenty-minute run is a worse way to learn this than being told first.
    renderCard({ allowance: { remaining: 8, limit: 100 } });
    expect(screen.getByText(/allows 8 more sections this month, so this won't finish the book in one go/)).toBeTruthy();
  });

  it("says the allowance is spent, and when it comes back", () => {
    renderCard({ allowance: { remaining: 0, limit: 100 } });
    expect(screen.getByText(/used this month's generation allowance - it resets at the start of next month/)).toBeTruthy();
    expect(screen.queryByText(/enough to finish/)).toBeNull();
  });

  it("says nothing at all rather than guessing", () => {
    // A wrong number here is worse than no number, and the usage fetch can fail or
    // simply not have landed yet.
    renderCard({ allowance: null });
    expect(screen.queryByText(/more sections this month/)).toBeNull();
    expect(screen.queryByText(/allowance/)).toBeNull();
  });

  it("keeps quiet about the allowance on a deck with nothing left to generate", () => {
    renderCard({ deck: deck({ pendingChunks: [] }), allowance: { remaining: 0, limit: 100 } });
    expect(screen.queryByText(/generation allowance/)).toBeNull();
  });
});

describe("while a run is going", () => {
  const progress = {
    currentSection: 5,
    totalSections: 12,
    cardsSoFar: 12,
    waitingReason: null as string | null,
    stopping: false,
  };

  it("shows the live section and the cards actually saved, and hides the stale summary", () => {
    // The summary line is a snapshot taken when the card appeared; the deck is
    // rewritten every batch. Leaving it up is how it came to read "33 cards" with 57
    // in the deck.
    renderCard({ continuing: true, progress });
    expect(screen.getByText(/Generating section 5 of 12/)).toBeTruthy();
    expect(screen.getByText(/12 cards so far/)).toBeTruthy();
    expect(screen.queryByText(/60 cards · 12 sections left/)).toBeNull();
    expect(screen.queryByText(/more sections this month/)).toBeNull();
  });

  it("surfaces a rate-limit wait, because silence reads as a hang", () => {
    renderCard({ continuing: true, progress: { ...progress, waitingReason: "Rate limit - waiting 43s." } });
    expect(screen.getByText("Rate limit - waiting 43s.")).toBeTruthy();
  });

  it("says it is stopping, and refuses a second Stop", () => {
    const handlers = renderCard({ continuing: true, progress: { ...progress, stopping: true } });
    const stop = screen.getByRole("button", { name: /Finishing this section/ });
    expect((stop as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(stop);
    expect(handlers.onStop).not.toHaveBeenCalled();
  });

  it("stops when asked", () => {
    const handlers = renderCard({ continuing: true, progress });
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(handlers.onStop).toHaveBeenCalledOnce();
  });

  it("counts a single card as a card", () => {
    renderCard({ continuing: true, progress: { ...progress, cardsSoFar: 1 } });
    expect(screen.getByText(/1 card so far/)).toBeTruthy();
  });
});

describe("the two ways out", () => {
  it("continues the deck it found", () => {
    const handlers = renderCard();
    fireEvent.click(screen.getByRole("button", { name: /Continue this deck/ }));
    expect(handlers.onContinue).toHaveBeenCalledOnce();
    expect(handlers.onStartSeparate).not.toHaveBeenCalled();
  });

  it("still lets the student start a separate deck, which is what this screen used to do by itself", () => {
    const handlers = renderCard();
    fireEvent.click(screen.getByRole("button", { name: /Start a separate deck/ }));
    expect(handlers.onStartSeparate).toHaveBeenCalledOnce();
    expect(handlers.onContinue).not.toHaveBeenCalled();
  });
});
