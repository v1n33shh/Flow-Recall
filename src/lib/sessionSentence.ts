import type { SessionPlan } from "@/lib/sessionBuilder";

/** What tonight is, as a sentence.
 *
 * The home screen led with a 72pt numeral for two rebuilds and read as a dashboard nobody
 * wanted to look at. This is the editorial alternative: the screen opens with a statement
 * about tonight, and the warmth comes from weight contrast between the two lines rather
 * than from decoration.
 *
 * THE CARD COUNT NEVER APPEARS. "Start 108 cards · ~20 min" was the single most
 * off-putting thing on the screen - 108 is a wall, twenty minutes is an evening. The
 * budget chips already say how long, so the statement says what and the button just says
 * Start.
 *
 * SMALL NUMBERS ARE WORDS. "Twenty minutes clears them" rather than "20 minutes". It is
 * the difference between a readout and a sentence, and this screen is now a sentence.
 * Counts stay numeric above nine, where spelling them out starts to read as twee.
 *
 * QUESTIONS, NOT CONCEPTS. `slipping`, `urgent`, `fresh` and `building` count selected
 * CARDS - sessionBuilder's own field comments say so - and one concept can contribute two,
 * one per format. Calling them concepts put a card count directly above the projection's
 * concept count and the screen contradicted itself: "Eleven concepts are nearly gone" over
 * "Of the 9 you have studied". `resting` is genuinely a concept count and keeps the word.
 *
 * Pure, so every branch can be tested without rendering anything, and so all the copy
 * sits in one reviewable place instead of scattered through JSX.
 */

export type SessionSentence = {
  /** The situation. Large, mid-weight - this is the thing being read. */
  lead: string;
  /** What to do about it. Lighter, and it may be absent when there is nothing to offer. */
  offer: string | null;
};

const WORDS = [
  "Zero",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten",
  "Eleven",
  "Twelve",
  "Thirteen",
  "Fourteen",
  "Fifteen",
  "Twenty",
] as const;

/** Spelled out to fifteen, then twenty for the round case; numeric above that.
 * Sentence-leading position, so capitalised. */
function spell(n: number): string {
  if (n >= 0 && n <= 15) return WORDS[n];
  if (n === 20) return "Twenty";
  return String(n);
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

/** The offer line: how long, in words, without ever naming the card count. */
function offerFor(plan: SessionPlan): string {
  const mins = Math.max(1, Math.round(plan.estimatedMinutes));
  const spoken = mins <= 15 || mins === 20 ? spell(mins).toLowerCase() : String(mins);
  return `${spoken === "one" ? "A minute" : `${spoken.charAt(0).toUpperCase()}${spoken.slice(1)} minutes`} clears them.`;
}

/** Rank matters: what is nearly gone outranks what is merely slipping, which outranks
 * what is new, which outranks what is merely still building. A student should be told the
 * most consequential true thing about tonight, not a list. */
export function sessionSentence(plan: SessionPlan): SessionSentence {
  // Nothing selected at all. Not a failure - usually the opposite.
  if (plan.items.length === 0) {
    if (plan.resting > 0) {
      return {
        lead: `Nothing needs you tonight.`,
        offer: `${spell(plan.resting)} ${plural(plan.resting, "concept is", "concepts are")} resting — you have ${plural(plan.resting, "it", "them")} solidly.`,
      };
    }
    return {
      lead: "Nothing is due tonight.",
      offer: "Add something new, or study a deck anyway.",
    };
  }

  if (plan.urgent > 0) {
    return {
      lead: `${spell(plan.urgent)} ${plural(plan.urgent, "question is", "questions are")} nearly gone.`,
      offer: offerFor(plan),
    };
  }

  if (plan.slipping > 0) {
    return {
      lead: `${spell(plan.slipping)} ${plural(plan.slipping, "question is", "questions are")} slipping.`,
      offer: offerFor(plan),
    };
  }

  if (plan.fresh > 0) {
    return {
      lead: `${spell(plan.fresh)} ${plural(plan.fresh, "question", "questions")} you have not met yet.`,
      offer: offerFor(plan).replace("clears them", "starts them"),
    };
  }

  // Answered before, holding, not yet proven a second way or after a gap. The state the
  // screen is in right after a session, and it had nothing to say about it for a while.
  return {
    lead: `${spell(plan.building)} ${plural(plan.building, "question is", "questions are")} still building.`,
    offer: offerFor(plan).replace("clears them", "moves them on"),
  };
}
