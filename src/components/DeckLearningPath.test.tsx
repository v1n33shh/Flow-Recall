import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { Concept, ConceptEdge } from "@/lib/types";
import type { MasteryLevel } from "@/lib/recallModel";

// useConceptMap reaches for localStorage and /api/concept-map; the component under test
// here takes the map as a prop, so only the module's other imports need standing in.
vi.mock("@/lib/storage", () => ({
  saveConceptMap: vi.fn(),
  useSavedDecks: () => [],
}));
vi.mock("@/lib/haptics", () => ({ vibrateTap: () => {} }));

const { default: DeckLearningPath } = await import("@/components/DeckLearningPath");

function concept(id: string, label: string): Concept {
  return {
    id,
    concept: label,
    question: `What about ${label}?`,
    answer: `Answer ${id}`,
    distractor: `Not ${id}`,
    cloze: `The answer is _____ for ${label}.`,
  };
}

const DECK = [
  concept("p", "Preload"),
  concept("s", "Frank-Starling Mechanism"),
  concept("v", "Stroke Volume"),
];

const LEVELS: Record<string, MasteryLevel> = { p: "solid", v: "fading" };

function renderPath(edges: readonly ConceptEdge[] | null) {
  const onJump = vi.fn();
  render(
    <DeckLearningPath
      concepts={DECK}
      map={{ edges, busy: false, error: null, limitReached: false, run: async () => {} }}
      labelOf={(id) => DECK.find((c) => c.id === id)?.concept ?? null}
      levelOf={(id) => LEVELS[id] ?? null}
      onJump={onJump}
    />,
  );
  return onJump;
}

const edge = (from: string, to: string, relation: ConceptEdge["relation"]): ConceptEdge => ({
  from,
  to,
  relation,
});

describe("the confusable pairs, which had nowhere to be shown before", () => {
  it("names both ends of every pair, at the deck level", () => {
    // The point of the section: these were only ever visible inside one concept's own
    // card, so a student could find a pair only by having already opened one of it.
    renderPath([edge("p", "v", "contrast"), edge("s", "v", "contrast")]);
    expect(screen.getByText(/Don't confuse/)).toBeTruthy();
    expect(screen.getByText(/2 pairs in this deck get mixed up/)).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /Stroke Volume/ })).toHaveLength(2);
    expect(screen.getByRole("button", { name: /Preload/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Frank-Starling/ })).toBeTruthy();
  });

  it("counts one pair as a pair", () => {
    renderPath([edge("p", "v", "contrast")]);
    expect(screen.getByText(/One pair in this deck gets mixed up/)).toBeTruthy();
    expect(screen.queryByText(/pairs in this deck/)).toBeNull();
  });

  it("jumps to the end that was tapped, not the pair", () => {
    const onJump = renderPath([edge("p", "v", "contrast")]);
    fireEvent.click(screen.getByRole("button", { name: /Preload/ }));
    expect(onJump).toHaveBeenCalledExactlyOnceWith("p");
  });

  it("says nothing when the deck has no confusable pairs", () => {
    renderPath([edge("p", "s", "prerequisite")]);
    expect(screen.queryByText(/Don't confuse/)).toBeNull();
  });

  it("says nothing for a deck that was never mapped", () => {
    renderPath(null);
    expect(screen.queryByText(/Don't confuse/)).toBeNull();
    expect(screen.getByRole("button", { name: /Map this deck/ })).toBeTruthy();
  });
});

describe("what the section says when there is no order to give", () => {
  it("stops sending the student off to hunt through the cards", () => {
    // The old copy read "...or get confused with others - see the cards below", which
    // was the app admitting it held the answer and would not show it.
    renderPath([edge("p", "v", "contrast")]);
    expect(screen.getByText(/some of these do get mixed up with each other/)).toBeTruthy();
    expect(screen.queryByText(/see the cards below/)).toBeNull();
  });

  it("still points at the cards for an explains-only deck, where it is the only answer", () => {
    renderPath([edge("p", "v", "explains")]);
    expect(screen.getByText(/see the cards below/)).toBeTruthy();
    expect(screen.queryByText(/Don't confuse/)).toBeNull();
  });

  it("distinguishes a deck whose ideas genuinely do not relate from one never asked about", () => {
    renderPath([]);
    expect(screen.getByText(/do not lean on each other in a way worth drawing/)).toBeTruthy();
  });
});

describe("the learning path itself, still", () => {
  it("orders prerequisites before what they unlock, and shows both sections together", () => {
    renderPath([edge("p", "s", "prerequisite"), edge("s", "v", "contrast")]);
    expect(screen.getByText("Learning path")).toBeTruthy();
    expect(screen.getByText(/Prerequisites first, then what they unlock/)).toBeTruthy();
    expect(screen.getByText("01")).toBeTruthy();
    // Both halves of the map render at once: order from prerequisites, pairs from
    // contrasts. Before this they could not coexist - only one of them was rendered.
    expect(screen.getByText(/Don't confuse/)).toBeTruthy();
  });
});
