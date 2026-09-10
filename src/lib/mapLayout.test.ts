import { describe, expect, it } from "vitest";
import { layoutMap } from "./mapLayout";
import type { ConceptEdge } from "./types";

const prereq = (from: string, to: string): ConceptEdge => ({ from, to, relation: "prerequisite" });
const explains = (from: string, to: string): ConceptEdge => ({ from, to, relation: "explains" });
const contrast = (from: string, to: string): ConceptEdge => ({ from, to, relation: "contrast" });

const rankOf = (layout: ReturnType<typeof layoutMap>, id: string) =>
  layout.nodes.find((n) => n.id === id)?.rank;

describe("layoutMap", () => {
  it("puts a prerequisite above the thing that needs it", () => {
    const layout = layoutMap(["a", "b"], [prereq("a", "b")]);
    expect(rankOf(layout, "a")).toBe(0);
    expect(rankOf(layout, "b")).toBe(1);
    expect(layout.layered).toBe(true);
  });

  it("ranks by the LONGEST path, so nothing is drawn above its own prerequisite", () => {
    // a → b → c, and also a → c. The short edge must not pull c up beside b.
    const layout = layoutMap(["a", "b", "c"], [prereq("a", "b"), prereq("b", "c"), prereq("a", "c")]);
    expect(rankOf(layout, "a")).toBe(0);
    expect(rankOf(layout, "b")).toBe(1);
    expect(rankOf(layout, "c")).toBe(2);
  });

  it("keeps independent concepts side by side on the top row", () => {
    const layout = layoutMap(["a", "b", "c"], [prereq("a", "c")]);
    expect(rankOf(layout, "a")).toBe(0);
    expect(rankOf(layout, "b")).toBe(0);
    expect(rankOf(layout, "c")).toBe(1);
  });

  it("draws the same picture twice - a map that reshuffles between visits is not a map", () => {
    const ids = ["a", "b", "c", "d"];
    const edges = [prereq("a", "b"), prereq("b", "c"), contrast("a", "d")];
    expect(layoutMap(ids, edges)).toEqual(layoutMap(ids, edges));
  });

  // A model can assert "a before b, b before a". learningPath is total for exactly
  // this reason, and the layout inherits it rather than solving it again.
  it("survives a cycle without losing a concept or hanging", () => {
    const layout = layoutMap(["a", "b", "c"], [prereq("a", "b"), prereq("b", "a"), prereq("b", "c")]);
    expect(layout.nodes).toHaveLength(3);
    expect(new Set(layout.nodes.map((n) => n.id))).toEqual(new Set(["a", "b", "c"]));
  });

  it("falls back to a grid when nothing has to be learnt first", () => {
    const ids = ["a", "b", "c", "d", "e"];
    const layout = layoutMap(ids, [explains("a", "b"), contrast("c", "d")]);
    expect(layout.layered).toBe(false);
    expect(layout.nodes).toHaveLength(5);
    // Square-ish rather than one row of five or five rows of one.
    const ranks = new Set(layout.nodes.map((n) => n.rank));
    expect(ranks.size).toBeGreaterThan(1);
    expect(ranks.size).toBeLessThan(ids.length);
  });

  it("ignores edges naming a concept the deck no longer holds", () => {
    const layout = layoutMap(["a", "b"], [prereq("a", "b"), prereq("ghost", "b")]);
    expect(layout.nodes).toHaveLength(2);
    expect(rankOf(layout, "b")).toBe(1);
  });

  it("centres every row on the same axis", () => {
    // Two on top, one below: the single node should sit between the two above it.
    const layout = layoutMap(["a", "b", "c"], [prereq("a", "c"), prereq("b", "c")]);
    const [a, b, c] = ["a", "b", "c"].map((id) => layout.nodes.find((n) => n.id === id)!);
    expect(c.x).toBeCloseTo((a.x + b.x) / 2);
  });

  it("reports a box big enough to hold every node", () => {
    const layout = layoutMap(["a", "b", "c", "d"], [prereq("a", "b"), prereq("a", "c"), prereq("b", "d")]);
    for (const node of layout.nodes) {
      expect(node.x).toBeGreaterThanOrEqual(0);
      expect(node.x).toBeLessThanOrEqual(layout.width);
      expect(node.y).toBeGreaterThanOrEqual(0);
      expect(node.y).toBeLessThanOrEqual(layout.height);
    }
  });

  it("hands back nodes in learning order, so the eye follows the sequence", () => {
    const layout = layoutMap(["c", "b", "a"], [prereq("a", "b"), prereq("b", "c")]);
    expect(layout.nodes.map((n) => n.id)).toEqual(["a", "b", "c"]);
  });

  it("handles an empty deck", () => {
    expect(layoutMap([], [])).toEqual({ nodes: [], width: 0, height: 0, layered: false });
  });

  it("handles a deck of one", () => {
    const layout = layoutMap(["a"], []);
    expect(layout.nodes).toHaveLength(1);
    expect(layout.width).toBeGreaterThan(0);
  });

  it("stays fast on a deck at the mapping ceiling", () => {
    const ids = Array.from({ length: 400 }, (_, i) => `c${i}`);
    const edges = ids.slice(1).map((id, i) => prereq(ids[i], id)); // one 400-deep chain
    const started = Date.now();
    const layout = layoutMap(ids, edges);
    expect(layout.nodes).toHaveLength(400);
    expect(rankOf(layout, "c399")).toBe(399);
    expect(Date.now() - started).toBeLessThan(1000);
  });
});
