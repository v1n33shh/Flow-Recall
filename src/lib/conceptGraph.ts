import { normalizeForCompare } from "./clozeMatch";
import type { Concept, ConceptEdge, ConceptRelation } from "./types";

// Turning a deck into a subject.
//
// A deck is a flat pile of isolated facts, and answering all of them still leaves
// a student unable to say how any two connect. These are the pure functions over
// the edges that fix that: no fetch, no IndexedDB, no window - so every rule below
// is a test rather than an argument, the same split sessionBuilder.ts and
// recallSync.ts already use. The IO is /api/concept-map and RevisionSheet.
//
// The model emits LABELS, because labels are all it is shown. Everything stored
// and rendered downstream is by concept ID. validateEdges is the one place that
// crossing happens, and it is deliberately strict: a relationship pointing at a
// concept that is not in the deck is worse than no relationship at all, because a
// student cannot tell an invented link from a real one.

const RELATIONS: readonly ConceptRelation[] = ["prerequisite", "explains", "contrast"];

/** How many entries one relation row shows for one concept.
 *
 * Not a storage limit - everything the model got right is kept, and a later graph
 * view will want all of it. This is a reading limit: past four chips the row wraps
 * to a third line on a 360dp screen and the concept's own text stops being the
 * thing the eye lands on. */
export const MAX_PER_ROW = 4;

/** A label as the model actually types it back, not as the deck stores it.
 *
 * `normalizeForCompare` splits on whitespace, so it only strips a plural "s" from
 * the end of a whitespace-delimited word - and the device pass caught the model
 * answering "Franks-Starling Mechanism" for this deck's "Frank-Starling
 * Mechanism", where the stray "s" sits inside a hyphenated word. A hyphen, dash or
 * slash IS a word boundary in a concept label, so treating it as one makes those
 * the same label. Deliberately not fixed inside `normalizeForCompare`: cloze
 * grading compares a student's typed answer with that function, and loosening it
 * there would change what counts as correct recall. */
function normalizeLabel(value: string): string {
  return normalizeForCompare(value.replace(/[-–—/]+/g, " "));
}

/* No fuzzy fallback here, and that is a decision rather than an omission.
 *
 * The obvious next step after the misspelling above is a bounded edit distance, so
 * any near-miss resolves. It was written, and it was cut: no string metric can tell
 * "the model misspelt a label it was shown" from "the model named a neighbouring
 * concept this deck does not contain", and the second is the failure this whole
 * file exists to prevent. The cut is not theoretical - at two edits, "ADP Yield"
 * resolves to "ATP Yield", and "Type I Error" to "Type II Error", each asserting a
 * relationship between two concepts a student would be right to trust and wrong to.
 * A missing edge costs a student one connection they can still see for themselves;
 * an invented one teaches them something false, and they cannot tell which is which.
 * Widen `normalizeLabel` when a real pass proves a class of miss - do not guess. */

/** Resolves the model's label pairs into edges by concept id, dropping everything
 * it cannot vouch for.
 *
 * Five ways an edge dies, all of them silent by design - a mapping pass that
 * refuses to save because the model named one concept badly would leave the
 * student with nothing:
 *
 * 1. **Either end is not in this deck.** The most common failure: asked how a
 *    deck's ideas relate, a model will happily reach for a neighbouring idea the
 *    deck never covered. Matched through `normalizeLabel`, so casing, a leading
 *    article, a hyphen and a plural "s" are not a different concept - but nothing
 *    looser than that, for the reason given above it.
 * 2. **The label is ambiguous.** Two cards in one deck can carry the same label;
 *    an edge naming it would point at both, so it points at neither.
 * 3. **It is a self-edge.** Harmless to store and meaningless to show.
 * 4. **The relation is not one of the three.** Models invent `related_to`.
 * 5. **It duplicates an edge already kept.** `contrast` is symmetric, so A-B and
 *    B-A are the same edge and collapse to one; direction is preserved for the
 *    other two, where reversing it changes the claim. */
export function validateEdges(
  raw: readonly { from: string; to: string; relation: string }[],
  concepts: readonly Concept[],
): ConceptEdge[] {
  const byLabel = new Map<string, string | null>();
  for (const concept of concepts) {
    const key = normalizeLabel(concept.concept);
    if (!key) continue;
    // Second sighting poisons the entry rather than overwriting it: null means
    // "this label names more than one card", which is not resolvable.
    byLabel.set(key, byLabel.has(key) ? null : concept.id);
  }

  const kept: ConceptEdge[] = [];
  const seen = new Set<string>();

  for (const edge of raw) {
    const relation = RELATIONS.find((r) => r === edge.relation);
    if (!relation) continue;

    const from = byLabel.get(normalizeLabel(edge.from ?? ""));
    const to = byLabel.get(normalizeLabel(edge.to ?? ""));
    if (!from || !to || from === to) continue;

    const key =
      relation === "contrast"
        ? `contrast:${[from, to].sort().join("|")}`
        : `${relation}:${from}|${to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push({ from, to, relation });
  }

  return kept;
}

/** The three rows one concept shows, in the direction a student reads them.
 *
 * `prerequisites` are the edges pointing AT this concept - the things to build on
 * first - while `explains` are the ones pointing away from it. That asymmetry is
 * the whole value of storing a direction: the same edge reads as "build on first"
 * from one end and "this explains" from the other, and getting it backwards would
 * teach the deck in reverse. `contrasts` is symmetric and takes either end. */
export function groupForConcept(
  conceptId: string,
  edges: readonly ConceptEdge[],
): { prerequisites: string[]; explains: string[]; contrasts: string[] } {
  const row = (ids: string[]) => [...new Set(ids)].slice(0, MAX_PER_ROW);

  return {
    prerequisites: row(
      edges.filter((e) => e.relation === "prerequisite" && e.to === conceptId).map((e) => e.from),
    ),
    explains: row(
      edges.filter((e) => e.relation === "explains" && e.from === conceptId).map((e) => e.to),
    ),
    contrasts: row(
      edges
        .filter((e) => e.relation === "contrast" && (e.from === conceptId || e.to === conceptId))
        .map((e) => (e.from === conceptId ? e.to : e.from)),
    ),
  };
}

/** Every pair of concepts in this deck that get mixed up with each other.
 *
 * The deck-level counterpart to `groupForConcept`'s `contrasts` row, and it exists
 * because that row is the only place these have ever been visible - one concept at a
 * time, which means a student can only find a confusable pair by already having opened
 * one of the two cards in it. `learningPath` cannot carry them: it is prerequisites
 * only, deliberately, and it says so. So of the three relations the model produces, the
 * deck view rendered exactly one, and its own fallback copy told the student to go and
 * "see the cards below".
 *
 * Pairs rather than a graph on purpose. `contrast` is the one symmetric relation - it
 * has no direction to draw and no order to walk - so the honest rendering is a list of
 * two-ended pairs, which also happens to be the thing that loses marks in an exam.
 *
 * Ordered by deck position, and each pair with its earlier concept first, so the same
 * deck and edges produce the same list on every render - the same stability
 * `learningPath` holds and for the same reason: a list that reshuffles between visits
 * is not a list. Deduplicated on the unordered pair, so an edge asserted in both
 * directions appears once. */
export function contrastPairs(
  conceptIds: readonly string[],
  edges: readonly ConceptEdge[],
): [string, string][] {
  const position = new Map(conceptIds.map((id, index) => [id, index]));
  const seen = new Set<string>();
  const pairs: [string, string][] = [];

  for (const edge of edges) {
    if (edge.relation !== "contrast") continue;
    const a = position.get(edge.from);
    const b = position.get(edge.to);
    // A concept the deck no longer holds - an edge mapped before a card was deleted.
    // validateEdges cannot catch this one, because it ran when the card still existed.
    if (a === undefined || b === undefined || a === b) continue;

    const [first, second] = a < b ? [edge.from, edge.to] : [edge.to, edge.from];
    const key = `${first}|${second}`;
    if (seen.has(key)) continue;
    seen.add(key);
    pairs.push([first, second]);
  }

  return pairs.sort(
    (x, y) => (position.get(x[0]) ?? 0) - (position.get(y[0]) ?? 0) ||
              (position.get(x[1]) ?? 0) - (position.get(y[1]) ?? 0),
  );
}

/** The order to learn a deck in: every concept, with prerequisites before the
 * things that need them.
 *
 * Kahn's algorithm over `prerequisite` edges only - `explains` and `contrast` say
 * nothing about sequence, and treating them as order would put a consequence
 * before its mechanism half the time.
 *
 * Two properties matter more than the algorithm:
 *
 * - **Stable.** Among everything currently unblocked it always takes the earliest
 *   in deck order, so the same deck and edges produce the same path on every
 *   render. A path that reshuffles between visits is not a path.
 * - **Total.** A model can assert a cycle (A before B, B before A), and a
 *   student must not lose concepts to it. When every remaining concept is
 *   blocked, the earliest remaining one in deck order is emitted anyway, which
 *   breaks the cycle deterministically and lets the rest drain. Every concept
 *   comes out exactly once, cycles or not. */
export function learningPath(
  conceptIds: readonly string[],
  edges: readonly ConceptEdge[],
): string[] {
  const order = [...new Set(conceptIds)];
  const present = new Set(order);

  const indegree = new Map(order.map((id) => [id, 0]));
  const downstream = new Map<string, string[]>();
  for (const edge of edges) {
    if (edge.relation !== "prerequisite") continue;
    if (!present.has(edge.from) || !present.has(edge.to)) continue;
    indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
    downstream.set(edge.from, [...(downstream.get(edge.from) ?? []), edge.to]);
  }

  const path: string[] = [];
  const done = new Set<string>();
  while (path.length < order.length) {
    const next =
      order.find((id) => !done.has(id) && (indegree.get(id) ?? 0) === 0) ??
      order.find((id) => !done.has(id));
    if (next === undefined) break;

    path.push(next);
    done.add(next);
    for (const to of downstream.get(next) ?? []) {
      indegree.set(to, Math.max(0, (indegree.get(to) ?? 0) - 1));
    }
  }

  return path;
}
