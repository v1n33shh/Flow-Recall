import type { ConceptEdge } from "./types";
import { retrievabilityAt, type KnowledgeUnit, type MemoryRecord, type RetrievalPath } from "./recallModel";

// Decides what goes on a mock paper, and what each question is worth.
//
// Pure over records, like sessionBuilder - and deliberately NOT sessionBuilder,
// because a paper answers a different question. A session asks "what is the best
// use of twenty minutes tonight"; a paper asks "what would this student lose marks
// on if the exam were now". Three of the rules below are the opposite of the
// session's, and each inversion is the interesting part:
//
//  1. **A paper does not skip solid concepts.** buildSession's best feature is
//     telling a student what NOT to study; an exam has no such manners. A topic the
//     student knows still appears - as a 1-mark question, which is cheap coverage
//     that confirms retention without spending the paper's marks on what is already
//     safe.
//  2. **A never-studied concept ranks HIGHEST here.** buildSession gives `isFresh`
//     a value of 0.05, on the reasoning that losing something known is worse than
//     not yet knowing something. In an exam it is the reverse: material never
//     opened is the likeliest source of a zero.
//  3. **The budget is marks, not minutes.** Which is what lets weakness decide mark
//     allocation - the concepts most likely to cost marks carry the most marks, the
//     way a student revising properly would spend their own time.
//
// No AI call reaches this file. The model is given the concepts this picks and
// asked only to WRITE the questions, which halves what a paper costs and keeps the
// choice of what to examine testable rather than a matter of the model's mood.

/** How a question asks. Each maps to a `RetrievalPath` the engine already declares
 * (see PATH_BY_TYPE): the paper is the first producer of `mcq`, `reverse` and
 * `explain`, which have been in the type since the day it was written. */
export type PaperQuestionType = "recall" | "mcq" | "short" | "long" | "contrast" | "chain";

/** What each type is worth. Fixed here rather than left to the model, which given
 * the choice awards marks by how interesting it found the question.
 *
 * The spread is what makes the paper feel like a paper: 1-mark definitions through
 * a 10-mark essay, so a 50-mark paper is a dozen-odd questions rather than fifty
 * one-liners or five essays. */
export const MARKS: Record<PaperQuestionType, number> = {
  recall: 1,
  mcq: 1,
  short: 4,
  long: 10,
  contrast: 5,
  chain: 5,
};

/** Which retrieval path a marked answer is recorded against.
 *
 * `recall` is `reverse` (produce the answer from the question, no options shown),
 * `mcq` is itself, and everything longer is `explain` - the student is producing
 * prose, which is the one thing `explain` was ever going to mean. Declared here so
 * the write-back in Phase 4 and the question type can never drift apart. */
export const PATH_BY_TYPE: Record<PaperQuestionType, RetrievalPath> = {
  recall: "reverse",
  mcq: "mcq",
  short: "explain",
  long: "explain",
  contrast: "explain",
  chain: "explain",
};

/** One question's worth of instruction to the model: what to ask about, how, and
 * for how many marks. Ids rather than concepts, so the caller assembles the
 * material and this file stays pure over records. */
export type PaperSlot = {
  type: PaperQuestionType;
  marks: number;
  /** The concepts this question draws on - one, except `contrast` and `chain`,
   * which name exactly two in the order the relation runs. */
  unitIds: string[];
};

export type PaperPlan = {
  slots: PaperSlot[];
  totalMarks: number;
  /** Distinct concepts examined, against how many were available to examine. The
   * screen says this out loud: a paper covering 12 of 40 concepts is a spot check,
   * and a student should be told which one they are sitting. */
  covered: number;
  available: number;
};

/** How likely this concept is to be recalled, as one number per concept.
 *
 * The **mean** across the formats it has been asked in, and **0** for one never
 * asked at all - character for character the rule `projectedRecall` uses, and
 * reused rather than re-derived so the paper's weighting can never disagree with
 * the "you'll still recall N of M" figure on the home screen. Taking the best
 * format instead would assume the exam probes whichever one the student is
 * strongest at, which is not a thing exams do. */
export function recallProbability(
  unitId: string,
  memories: readonly MemoryRecord[],
  atMs: number,
): number {
  const rows = memories.filter((memory) => memory.unitId === unitId);
  if (rows.length === 0) return 0;
  return rows.reduce((total, row) => total + retrievabilityAt(row, atMs), 0) / rows.length;
}

/** Which question types this card's own fields can support.
 *
 * The same discipline `pathsFor` applies and for the same reason: a question the
 * material cannot answer is worse than one question fewer. `explanation` is
 * optional on Concept (decks predate it), so every prose type has to check for it
 * rather than assume it - a deck generated before that field existed would
 * otherwise produce a 10-mark essay question with nothing to mark it against. */
export function typesFor(unit: KnowledgeUnit): PaperQuestionType[] {
  const { question, answer, distractor, explanation } = unit.concept;
  const types: PaperQuestionType[] = [];
  if (question && answer) types.push("recall");
  if (answer && distractor) types.push("mcq");
  if (explanation && explanation.trim().length > 0) types.push("short", "long");
  return types;
}

/** The weakest supported type at or below a mark ceiling, or null.
 *
 * "Weakest" meaning the most demanding: a student who can write the 10-mark answer
 * can certainly pick the right option, so where a card supports both, the paper
 * asks for the harder one. */
function heaviestType(
  available: readonly PaperQuestionType[],
  ceiling: number,
): PaperQuestionType | null {
  const affordable = available.filter((type) => MARKS[type] <= ceiling);
  if (affordable.length === 0) return null;
  return affordable.reduce((best, type) => (MARKS[type] > MARKS[best] ? type : best));
}

/** Marks a concept is worth examining for, from how likely it is to be lost.
 *
 * Bands rather than a continuous function, because the output is a mark value from
 * a fixed table and interpolating between 4 and 10 produces neither. The
 * boundaries are the ones the rest of the engine already uses: 0.9 is FSRS's
 * default target, and 0.7 is far enough below it that the concept is genuinely at
 * risk rather than merely due. */
function ceilingFor(probability: number): number {
  if (probability < 0.7) return MARKS.long;
  if (probability < 0.9) return MARKS.short;
  return MARKS.recall;
}

/** A concept-map edge with both ends resolved to **unit ids**.
 *
 * `ConceptEdge` stores concept ids, which are unique only within their own deck; a
 * paper may draw on several decks, so the ends have to be resolved before they get
 * here. `resolveEdges` does it with the same `unitIdFor` every other caller uses. */
export type PaperEdge = { from: string; to: string; relation: ConceptEdge["relation"] };

/** How many relation questions a paper may carry, at most.
 *
 * Two, and they are claimed BEFORE the single-concept questions rather than with
 * whatever marks are left over. They are the paper's signature - the questions that
 * read as though somebody who understood the syllabus set it - and a budget filled
 * worst-first would always spend itself before reaching them. Two also keeps a
 * 50-mark paper from becoming an essay collection. */
const RELATION_SLOTS = 2;

/** Turns a deck's stored concept-map edges into paper edges. */
export function resolveEdges(deckId: string, edges: readonly ConceptEdge[]): PaperEdge[] {
  return edges.map((edge) => ({
    from: `${deckId}::${edge.from}`,
    to: `${deckId}::${edge.to}`,
    relation: edge.relation,
  }));
}

/** Sets the paper.
 *
 * Deterministic: the same units, memories and edges produce the same paper, which
 * is what makes it testable and what stops a student regenerating until they get an
 * easy one. It still moves on its own between sittings, because marking writes
 * reviews and the next paper reads the state those reviews produced. */
export function buildPaper(input: {
  units: readonly KnowledgeUnit[];
  memories: readonly MemoryRecord[];
  edges?: readonly PaperEdge[];
  totalMarks: number;
  now?: number;
}): PaperPlan {
  const now = input.now ?? Date.now();
  const budget = Math.max(0, input.totalMarks);

  const scored = input.units
    .map((unit) => {
      const probability = recallProbability(unit.id, input.memories, now);
      return { unit, probability, types: typesFor(unit) };
    })
    .filter((row) => row.types.length > 0)
    // Weakest first, then by id so the ordering is total rather than
    // implementation-defined - two concepts at exactly 0 are otherwise ordered by
    // whatever sort happens to do, and the paper stops being reproducible.
    .sort((a, b) => a.probability - b.probability || a.unit.id.localeCompare(b.unit.id));

  const byId = new Map(scored.map((row) => [row.unit.id, row]));
  const slots: PaperSlot[] = [];
  const used = new Set<string>();
  let spent = 0;

  const fits = (marks: number) => spent + marks <= budget || slots.length === 0;
  const take = (slot: PaperSlot) => {
    slots.push(slot);
    spent += slot.marks;
    for (const id of slot.unitIds) used.add(id);
  };

  // Relation questions first - see RELATION_SLOTS. Both ends must be present and
  // both must carry an explanation: a compare-and-contrast question needs material
  // on both sides to be markable, and half of one is worse than neither.
  const relationCandidates = (input.edges ?? [])
    .map((edge) => ({ edge, from: byId.get(edge.from), to: byId.get(edge.to) }))
    .filter(
      (row) =>
        row.from !== undefined &&
        row.to !== undefined &&
        row.from.types.includes("long") &&
        row.to.types.includes("long"),
    )
    .map((row) => ({
      edge: row.edge,
      // The pair most at risk, by the weaker of the two ends - a relation is only
      // as safe as the concept the student knows least well.
      risk: 1 - Math.min(row.from!.probability, row.to!.probability),
    }))
    .sort(
      (a, b) =>
        b.risk - a.risk || `${a.edge.from}${a.edge.to}`.localeCompare(`${b.edge.from}${b.edge.to}`),
    );

  for (const candidate of relationCandidates) {
    if (slots.length >= RELATION_SLOTS) break;
    const { from, to, relation } = candidate.edge;
    if (used.has(from) || used.has(to)) continue;
    const type: PaperQuestionType = relation === "contrast" ? "contrast" : "chain";
    if (!fits(MARKS[type])) continue;
    take({ type, marks: MARKS[type], unitIds: [from, to] });
  }

  // Then the rest of the paper, worst first, one question per concept - asking the
  // same idea twice is a badly set paper, not thorough coverage.
  for (const row of scored) {
    if (used.has(row.unit.id)) continue;
    const type = heaviestType(row.types, ceilingFor(row.probability));
    if (type === null) continue;
    if (!fits(MARKS[type])) continue;
    take({ type, marks: MARKS[type], unitIds: [row.unit.id] });
    if (spent >= budget) break;
  }

  return {
    slots,
    totalMarks: spent,
    covered: used.size,
    available: input.units.length,
  };
}
