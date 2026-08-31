import type { Concept } from "./types";

/** The blank marker the generator is told to put where the answer goes. Kept in
 * one place; ClozeChallenge and pathsFor both key on the same literal. */
const BLANK = "_____";

/** Any run of three or more underscores, which is what the model actually emits.
 * The prompt asks for exactly five and the pinned model regularly returns seven -
 * caught by probing it against real source text. Nothing validated the count, so a
 * seven-underscore cloze passed every check (`includes("_____")` is true, and
 * splitting on five yields two parts) and then rendered with the leftovers
 * visible: the challenge showed "__ at the onset of systole" beside the input, and
 * the revision sheet printed "...valves__ at the onset...". */
const BLANK_RUN = /_{3,}/g;

/** Canonicalises whatever the model emitted to exactly one BLANK per gap.
 *
 * Applied at ingest so the stored card is clean, and again at render time so the
 * decks a student already has - which carry the raw output - are readable too. */
export function normaliseBlank(cloze: string): string {
  return cloze.replace(BLANK_RUN, BLANK);
}

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
 * `"improved actin-myosin overlap"`. In both, the word sitting immediately before
 * the blank turns up again inside the answer, so the filled sentence repeats
 * itself at the seam.
 *
 * Only the ONE word before the blank is compared, against every word of the
 * answer. A wider window looked more thorough and was wrong: `"Stroke volume is
 * end-diastolic volume minus _____"` with the answer `"end-systolic volume"`
 * fills to a perfectly good sentence, and a two-word window rejects it because
 * "volume" appears on both sides. Precision matters more than reach here, because
 * the ingest gate acts on this verdict by clearing the cloze - so a false positive
 * destroys a working production format for that card, not just one line of prose.
 *
 * The ingest prompt already demands substitutability, with worked examples of both
 * failures, and the model still gets it wrong sometimes - which is why this exists
 * on both sides: the gate stops a bad cloze being graded against, and factSentence
 * stops one being printed. */
function substitutionStutters(before: string, after: string, answer: string): boolean {
  const answerStems = words(answer).map(stem);
  const leading = stem(words(before).at(-1) ?? "");
  const trailing = stem(words(after).at(0) ?? "");
  // Both seams, because the model breaks each of them. Leading: "improves _____"
  // with "improved actin-myosin overlap". Trailing: "closure of the _____ valves."
  // with "aortic and pulmonary valves", which fills to "valves valves" - a real
  // card, and one the leading check alone waves straight through.
  if (leading && answerStems.includes(leading)) return true;
  if (trailing && answerStems.includes(trailing)) return true;
  return false;
}


/** Whether this cloze can actually be filled with this answer.
 *
 * Exported because two very different places need the same rule and must not
 * disagree: the revision sheet, which would otherwise print a stuttering
 * sentence, and the ingest quality gate, which uses it to refuse a cloze the
 * student would be graded against. The second is the one that matters more. Given
 * `"...end-diastolic volume minus _____"` with the answer `"EDV minus ESV"`, a
 * student who types the genuinely correct "end-systolic volume" is marked wrong -
 * by the local match and then by the AI grader, since both compare against a
 * reference answer that restates the whole fact instead of naming the missing
 * phrase. A card like that does not just read badly, it grades wrongly. */
export function clozeSubstitutes(cloze: string, answer: string): boolean {
  const parts = normaliseBlank(cloze).split(BLANK);
  if (parts.length !== 2) return false;
  const trimmed = answer.trim();
  if (!trimmed) return false;
  return !substitutionStutters(parts[0], parts[1], trimmed);
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
  const parts = normaliseBlank(concept.cloze).split(BLANK);
  if (parts.length !== 2) return null;

  const answer = concept.answer.trim();
  if (!answer) return null;

  if (substitutionStutters(parts[0], parts[1], answer)) return null;

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
