import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import ConceptRelations from "@/components/ConceptRelations";
import type { ConceptEdge } from "@/lib/types";
import type { MasteryLevel } from "@/lib/recallModel";

// The deck the device found the normalisation bug on, reduced to what matters.
const FRANK = "frank";
const STROKE = "stroke";

const LABELS: Record<string, string> = {
  [FRANK]: "Frank-Starling Mechanism",
  [STROKE]: "Stroke Volume Calculation",
};

function setup(
  edges: ConceptEdge[],
  overrides: {
    conceptId?: string;
    labelOf?: (id: string) => string | null;
    levelOf?: (id: string) => MasteryLevel | null;
    onJump?: (id: string) => void;
  } = {},
) {
  const onJump = overrides.onJump ?? vi.fn();
  render(
    <ConceptRelations
      conceptId={overrides.conceptId ?? STROKE}
      edges={edges}
      labelOf={overrides.labelOf ?? ((id) => LABELS[id] ?? null)}
      levelOf={overrides.levelOf ?? (() => null)}
      onJump={onJump}
    />,
  );
  return { onJump };
}

describe("ConceptRelations", () => {
  it("renders nothing when a concept has no relationships", () => {
    // The defect this guards: a concept that genuinely stands alone must not carry
    // three empty rows, and an empty edge list must not imply the deck was mapped
    // and found wanting.
    setup([]);
    expect(screen.queryByText("Build on first")).toBeNull();
    expect(screen.queryByText("This explains")).toBeNull();
    expect(screen.queryByText("Don't confuse")).toBeNull();
  });

  it("puts a prerequisite under 'Build on first' and names it", () => {
    setup([{ from: FRANK, to: STROKE, relation: "prerequisite" }]);
    expect(screen.getByText("Build on first")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Frank-Starling Mechanism/ })).toBeTruthy();
  });

  it("reads an `explains` edge from the mechanism's side, not the consequence's", () => {
    // Direction is the whole content of the row: Frank-Starling explains stroke
    // volume, never the reverse. Rendering it on the wrong card would teach the
    // student a mechanism backwards.
    const edges: ConceptEdge[] = [{ from: FRANK, to: STROKE, relation: "explains" }];
    setup(edges, { conceptId: FRANK });
    expect(screen.getByText("This explains")).toBeTruthy();
    expect(screen.queryByText("Build on first")).toBeNull();
  });

  it("drops a chip whose concept has been deleted from the deck", () => {
    // A stored map outlives the concepts it names. A blank chip is worse than a
    // missing one.
    setup([{ from: "gone", to: STROKE, relation: "prerequisite" }], {
      labelOf: (id) => (id === "gone" ? null : (LABELS[id] ?? null)),
    });
    expect(screen.queryByText("Build on first")).toBeNull();
  });

  it("calls onJump with the concept the student tapped", () => {
    const { onJump } = setup([{ from: FRANK, to: STROKE, relation: "prerequisite" }]);
    fireEvent.click(screen.getByRole("button", { name: /Frank-Starling Mechanism/ }));
    expect(onJump).toHaveBeenCalledWith(FRANK);
  });

  it("marks a fading prerequisite with a dot", () => {
    // A dot on every chip says nothing; "the thing this depends on is fading" is
    // worth the ink. Asserted through the rendered tree rather than the DOT map, so
    // the mapping and the render cannot drift.
    const { container } = renderWithLevel("fading");
    expect(container.querySelectorAll("span.bg-pending").length).toBe(1);
  });

  it("leaves a middling level unmarked", () => {
    const { container } = renderWithLevel("holding");
    expect(container.querySelectorAll("span.bg-pending").length).toBe(0);
    expect(container.querySelectorAll("span.bg-accent").length).toBe(0);
  });
});

function renderWithLevel(level: MasteryLevel) {
  return render(
    <ConceptRelations
      conceptId={STROKE}
      edges={[{ from: FRANK, to: STROKE, relation: "prerequisite" }]}
      labelOf={(id) => LABELS[id] ?? null}
      levelOf={() => level}
      onJump={() => {}}
    />,
  );
}
