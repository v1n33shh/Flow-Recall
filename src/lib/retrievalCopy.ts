import type { RetrievalPath } from "@/lib/recallModel";

/** What kind of memory work each card format is, named on the card.
 *
 * WHY. The memory science in this app lived almost entirely on screens a student sees
 * once a session - the home page's brain fact, its forgetting-curve chart, its "every
 * screen is one finding about memory" headline - plus the library header and the ingest
 * wait. The study loop, which is the product's highest-traffic surface by a wide margin,
 * carried none of it: ConceptDebrief, SwipeChallenge and ClozeChallenge together contain
 * no mention of memory, recall or spacing anywhere. The theme stopped at the door of the
 * thing it was a theme for.
 *
 * WHY A LABEL AND NOT A SENTENCE. This shows after every single answer - a hundred times
 * in a long session - so anything longer than two words becomes the wall of copy this app
 * has already been cut twice to remove. It borrows the home page's `Effect` eyebrow
 * exactly: 10px, mono, uppercase, muted, reading as a citation rather than a second
 * headline. Geist Mono was loaded app-wide and used in precisely one place before this.
 *
 * WHY IT IS TRUE. `swipe` is a two-option recognition judgement; `cloze` makes the student
 * produce the answer with nothing on screen to recognise. Those are genuinely different
 * memory operations, and which one a concept has passed is what `masteryFor` in
 * recallModel.ts actually gates "solid" on - so this label names the same distinction the
 * engine is already scoring.
 */
export const RETRIEVAL_LABEL: Record<RetrievalPath, string> = {
  swipe: "Recognition",
  cloze: "Free recall",
  // Declared in RetrievalPath but not yet built into a card format. Named here anyway so
  // adding one cannot ship a blank eyebrow.
  mcq: "Recognition",
  reverse: "Free recall",
  explain: "Production",
};
