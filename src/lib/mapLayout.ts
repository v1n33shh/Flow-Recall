import type { ConceptEdge } from "./types";
import { learningPath } from "./conceptGraph";

// Where a deck's concepts sit when the graph is drawn.
//
// Pure arithmetic over ids and edges - no SVG, no DOM, no measurement - so the
// picture is a test rather than something only a screenshot can check. The same
// split conceptGraph.ts and sessionBuilder.ts already use.
//
// The whole layout is derived from `learningPath`, deliberately, rather than from a
// second traversal of its own. That function is already stable (same deck and edges
// give the same order every render) and already TOTAL (a model-asserted cycle does
// not lose concepts - it breaks deterministically and drains). Ranking in its order
// inherits both properties instead of re-solving them, and means the map and the
// revision sheet's numbered list can never disagree about the shape of a deck.

/** One concept's position, in the SVG's own units. */
export type MapNode = {
  id: string;
  /** Row. 0 is "nothing here has to be understood first". */
  rank: number;
  x: number;
  y: number;
};

export type MapLayout = {
  nodes: MapNode[];
  width: number;
  height: number;
  /** False when the deck has no `prerequisite` edges at all and this fell back to a
   * grid. The view reads it to change what it says about the deck, because a grid is
   * not a claim about order and must not be drawn as if it were. */
  layered: boolean;
};

/** Horizontal pitch between two nodes in a row, and vertical pitch between rows.
 * Sized for a label plate of ~110 units at the default zoom; the view scales the
 * whole thing, so these are ratios in disguise rather than pixels. */
const COLUMN = 150;
const ROW = 104;
/** Breathing room around the drawing, so a node at the edge is never flush against
 * the viewport when the map is fitted. */
const PAD = 72;

const EMPTY: MapLayout = { nodes: [], width: 0, height: 0, layered: false };

export function layoutMap(
  conceptIds: readonly string[],
  edges: readonly ConceptEdge[],
): MapLayout {
  const order = learningPath(conceptIds, edges);
  if (order.length === 0) return EMPTY;

  const present = new Set(order);
  const prerequisites = new Map<string, string[]>();
  let hasPrerequisite = false;
  for (const edge of edges) {
    if (edge.relation !== "prerequisite") continue;
    if (!present.has(edge.from) || !present.has(edge.to)) continue;
    hasPrerequisite = true;
    prerequisites.set(edge.to, [...(prerequisites.get(edge.to) ?? []), edge.from]);
  }

  // A deck whose ideas relate only by `explains` or `contrast` has no sequence to
  // draw. Every node would land in rank 0 and the map would be one row hundreds of
  // nodes wide - technically the truth, and useless. A square-ish grid in learning
  // order says the same thing honestly, and `layered: false` tells the view to stop
  // calling the rows layers.
  const rankOf = hasPrerequisite
    ? rankByDepth(order, prerequisites)
    : gridRanks(order);

  return position(order, rankOf, hasPrerequisite);
}

/** Longest path from a root, walked in `learningPath` order.
 *
 * Walking in that order is what makes one pass enough: by the time a concept is
 * reached, everything that has to come before it has been ranked already - except
 * inside a cycle, where `learningPath` has already chosen a deterministic place to
 * break, and an unranked prerequisite simply does not raise the rank. So this
 * terminates on any input and gives the same answer twice. */
function rankByDepth(
  order: readonly string[],
  prerequisites: ReadonlyMap<string, string[]>,
): Map<string, number> {
  const rank = new Map<string, number>();
  for (const id of order) {
    let depth = 0;
    for (const from of prerequisites.get(id) ?? []) {
      const above = rank.get(from);
      if (above !== undefined) depth = Math.max(depth, above + 1);
    }
    rank.set(id, depth);
  }
  return rank;
}

/** Square-ish, so a 40-concept deck is 7x6 rather than 40x1 or 1x40. */
function gridRanks(order: readonly string[]): Map<string, number> {
  const columns = Math.max(1, Math.ceil(Math.sqrt(order.length)));
  return new Map(order.map((id, index) => [id, Math.floor(index / columns)]));
}

/** Ranks to coordinates: each row centred on the same axis, so the drawing is
 * symmetrical about its middle rather than ragged down one side. */
function position(
  order: readonly string[],
  rankOf: ReadonlyMap<string, number>,
  layered: boolean,
): MapLayout {
  const rows = new Map<number, string[]>();
  for (const id of order) {
    const rank = rankOf.get(id) ?? 0;
    rows.set(rank, [...(rows.get(rank) ?? []), id]);
  }

  const widest = Math.max(...[...rows.values()].map((row) => row.length));
  const centre = ((widest - 1) * COLUMN) / 2;

  const nodes: MapNode[] = [];
  for (const [rank, row] of [...rows.entries()].sort((a, b) => a[0] - b[0])) {
    const offset = centre - ((row.length - 1) * COLUMN) / 2;
    row.forEach((id, index) => {
      nodes.push({ id, rank, x: PAD + offset + index * COLUMN, y: PAD + rank * ROW });
    });
  }

  return {
    // Back into learning order: the view paints in array order, and a student's eye
    // should follow the sequence the deck is meant to be learnt in.
    nodes: nodes.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id)),
    width: PAD * 2 + (widest - 1) * COLUMN,
    height: PAD * 2 + (rows.size - 1) * ROW,
    layered,
  };
}
