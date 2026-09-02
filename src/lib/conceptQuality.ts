import { clozeSubstitutes, normaliseBlank } from "./conceptProse";
import type { RawConcept } from "./conceptSchema";

/** What the gate did, so the rate is measurable rather than anecdotal. Logged by
 * the routes; the point is to know whether a prompt change actually moved it. */
export type QualityReport = {
  total: number;
  /** Cards whose cloze was cleared because the answer could not fill its blank. */
  clozeCleared: number;
  /** Cards dropped because `distractor` was not distinguishable from `answer`. */
  dropped: number;
};

/** Everything the schema cannot express, applied after validation and before a
 * card is ever persisted.
 *
 * The schema can say a field is a string. It cannot say that substituting
 * `answer` into `cloze` yields a sentence, or that `distractor` is actually a
 * different claim from `answer` - and both have come back wrong from a real model
 * on real material. The ingest prompt asks for both in prose, and asking is not
 * enough, so this is the mechanical version of the same demand.
 *
 * Deliberately repairs rather than rejects wherever it can. A hard reject would
 * throw away a card whose question, answer, distractor and explanation are all
 * perfectly good because one derived field came back malformed, and a FREE user has
 * only a few decks a month to spend. A cleared cloze is also no longer permanent:
 * ConceptEditor lets a student repair the blank, which brings a card the engine was
 * never able to ask back into the schedule. */
export function applyQualityGate(concepts: RawConcept[]): {
  concepts: RawConcept[];
  report: QualityReport;
} {
  const report: QualityReport = { total: concepts.length, clozeCleared: 0, dropped: 0 };
  const kept: RawConcept[] = [];

  for (const concept of concepts) {
    // A distractor that says the same thing as the answer makes the swipe
    // unanswerable: the card asserts a true claim and marks it false half the
    // time. Nothing downstream can repair that, so the card goes.
    if (normalise(concept.distractor) === normalise(concept.answer)) {
      report.dropped += 1;
      continue;
    }

    // Canonicalised before anything else looks at it: the model emits runs of
    // three to seven underscores and every consumer keys on exactly five, so an
    // un-normalised card renders its leftovers as visible text.
    const cloze = normaliseBlank(concept.cloze);
    if (clozeSubstitutes(cloze, concept.answer)) {
      kept.push(cloze === concept.cloze ? concept : { ...concept, cloze });
      continue;
    }

    // Cleared, not repaired: there is no way to know which words of a restating
    // answer were the missing ones. An empty cloze makes pathsFor drop the
    // production format for this card (it requires the blank), so the engine never
    // schedules a cloze the student would then be graded against with the wrong
    // reference answer - which is how "end-diastolic volume minus _____" with the
    // answer "EDV minus ESV" marks a correct "end-systolic volume" wrong.
    report.clozeCleared += 1;
    kept.push({ ...concept, cloze: "" });
  }

  return { concepts: kept, report };
}

function normalise(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ").replace(/[.,!?;:'"]+$/, "");
}
