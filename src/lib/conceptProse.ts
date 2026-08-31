import type { Concept } from "./types";

/** The blank marker the generator is told to put where the answer goes. Kept in
 * one place; ClozeChallenge and pathsFor both key on the same literal. */
const BLANK = "_____";

/** How many words either side of the seam to compare. Three is enough to catch
 * the observed failures without reaching so far back that an ordinary repeated
 * word trips it. */
const SEAM_WORDS = 3;

/** A crude stem, only ever compared against another crude stem. It has to
 * collapse `improves` and `improved` onto one thing, which is the exact shape of
 * the commonest duplication, and it must not mangle short function words - `is`
 * and `as` have to survive intact so that a genuine `the`/`the` stutter is still
 * caught. */
function stem(word: string): string {
  const bare = word.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (bare.length < 4) return bare;
  for (const suffix of ["ing", "ed", "es", "s", "d"]) {
    if (bare.length - suffix.length >= 3 && bare.endsWith(suffix)) {
      return bare.slice(0, -suffix.length);
    }
  }
  return bare;
}

function words(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}

/** Would substituting the answer into the blank stutter?
 *
 * Measured on the device against a real generated deck, where two of three cards
 * produced nonsense: `"...end-diastolic volume minus _____"` with the answer
 * `"EDV minus ESV"`, and `"...sarcomeres improves _____"` with the answer
 * `"improved actin-myosin overlap"`. Both restate words that are already sitting
 * immediately before the blank, so the filled sentence repeats itself.
 *
 * The ingest prompt already demands in prose that the substitution read as one
 * grammatical sentence, and the model ignores it often enough that it cannot be
 * trusted. Making that a mechanical assertion in the ingest quality gate is the
 * real fix and only helps decks generated after it lands; this is what keeps the
 * decks a student already has from printing broken prose in the meantime.
 *
 * A heuristic, and deliberately biased toward declining: a suppressed sentence
 * costs one line of a revision sheet that still has the full explanation under
 * it, while a printed stutter is the app looking broken. */
function substitutionStutters(before: string, answer: string): boolean {
  const tail = words(before).slice(-SEAM_WORDS).map(stem).filter(Boolean);
  const head = words(answer).slice(0, SEAM_WORDS).map(stem).filter(Boolean);
  if (tail.length === 0 || head.length === 0) return false;
  const headSet = new Set(head);
  return tail.some((w) => headSet.has(w));
}


/** A concept's fact as a plain declarative sentence, for reading rather than
 * answering.
 *
 * This is the whole trick behind the revision sheet costing no new generation.
 * `cloze` is already a complete statement of the fact with the answer punched
 * out, and `answer` is exactly the phrase that fills it - the ingest prompt
 * demands that substituting one into the other reads as a single grammatical
 * sentence. So the material a student can READ is already being generated for
 * them; it has only ever been rendered with a hole in it.
 *
 * Returns null when the cloze cannot be trusted to substitute. Malformed cloze
 * output is common enough that the schema alone cannot be relied on - the same
 * judgement pathsFor and ClozeChallenge already make - and a sentence with a
 * visible `_____` in the middle of a revision sheet is worse than no sentence,
 * because the caller has `question` and `answer` to fall back on. */
export function factSentence(concept: Concept): string | null {
  const parts = concept.cloze.split(BLANK);
  if (parts.length !== 2) return null;

  const answer = concept.answer.trim();
  if (!answer) return null;

  if (substitutionStutters(parts[0], answer)) return null;

  const filled = `${parts[0]}${answer}${parts[1]}`.replace(/\s+/g, " ").trim();
  if (!filled) return null;

  // The generator usually terminates the sentence, but not always, and a wall of
  // paragraphs where some end in a full stop and some do not reads as broken
  // rather than as varied.
  return /[.!?]$/.test(filled) ? filled : `${filled}.`;
}

/** What to show as a concept's body when there is no usable explanation.
 *
 * `explanation` is optional on Concept - decks generated before the field
 * existed have none, and the schema lets a model omission degrade one card
 * rather than fail a whole batch. Those decks still deserve a readable sheet, so
 * the fact sentence stands in, and the question does when even that is
 * unavailable. */
export function readableBody(concept: Concept): string {
  const explanation = concept.explanation?.trim();
  if (explanation) return explanation;
  return factSentence(concept) ?? concept.question.trim();
}
