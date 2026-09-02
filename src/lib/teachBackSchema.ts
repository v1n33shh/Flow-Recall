import { z } from "zod";

/** What the model returns when a student explains a concept back in their own words.
 *
 * Three lists and no score, and the absence of the score is the design. Every other
 * surface in this app already tells a student whether they were right - the swipe,
 * the cloze, the mastery bar. None of them can tell them WHICH PART of their own
 * understanding was the broken one, and that is the only thing worth asking a model
 * here. A number on the end would also quietly become the thing students optimise,
 * and "explain it until the number goes up" is not the exercise.
 *
 * Every list defaults to empty rather than being required, for the same reason
 * `relation` is a loose string in conceptGraphSchema: there is no `generateObject`
 * on the pinned Groq model (see lib/ai.ts), so a hand-parsed response missing one
 * key should cost that key and not the whole debrief. The route checks that at
 * least ONE list came back with something, because all three empty is not a verdict
 * - it is a model that did not answer, and the student must not be charged for it. */
export const TeachBackResponseSchema = z.object({
  /** What they actually got right, said back in terms of what THEY wrote. */
  correct: z.array(z.string().trim().min(1).max(300)).max(6).default([]),
  /** What the material covers and they left out. */
  missing: z.array(z.string().trim().min(1).max(300)).max(6).default([]),
  /** Where what they said conflicts with the material - not merely absent from it. */
  wrong: z.array(z.string().trim().min(1).max(300)).max(6).default([]),
});

export type TeachBackResponse = z.infer<typeof TeachBackResponseSchema>;

/** How much a student may write. Six times `/api/cloze-grade`'s 200, because that
 * route grades a filled-in blank and this one is handed a paragraph - the whole
 * exercise is producing more than a phrase. Still bounded: past this it stops being
 * an explanation of one concept. */
export const MAX_ATTEMPT_LENGTH = 1200;

export const teachBackRequestSchema = z.object({
  label: z.string().trim().min(1).max(200),
  question: z.string().trim().min(1).max(500),
  answer: z.string().trim().min(1).max(300),
  /** The generated deep-dive paragraph. Optional - decks predate the field. */
  explanation: z.string().trim().max(2000).default(""),
  /** The student's own explanation, in their own words. */
  attempt: z.string().trim().min(1).max(MAX_ATTEMPT_LENGTH),
  /** Lets the server compute "today" in the student's own timezone for the daily
   * cap, exactly as /api/cloze-grade does. Optional - falls back to UTC. */
  timezoneOffsetMinutes: z.number().optional(),
});

export type TeachBackRequest = z.infer<typeof teachBackRequestSchema>;

/** Lives beside the schema rather than in the route so it can be exercised against
 * the real model without dragging next-auth and a session cookie in - whether the
 * pinned Groq model splits an attempt into these three lists correctly, in a shape
 * parseModelJson accepts, is the one thing typechecking cannot tell you.
 *
 * Most of the length is spent on the two ways this feature fails in a way a student
 * would be right to resent: marking them WRONG for a fact their card never mentioned,
 * and calling something MISSING that the material never contained. Both turn a
 * study tool into one that moves the goalposts, and a student cannot argue with it. */
export function buildTeachBackPrompt(input: TeachBackRequest): string {
  return [
    "A student is studying one concept from their own uploaded material and has just",
    "explained it back to you in their own words. You have the card's material in",
    "front of you. They are writing from memory.",
    "",
    "Your entire answer is three lists. No score, no grade, no praise, no summary -",
    "the lists ARE the feedback, and a number on the end would just become the thing",
    "they optimise instead of the understanding.",
    "",
    "THE CONCEPT THEY ARE EXPLAINING",
    `Label: ${input.label}`,
    `Question on the card: ${input.question}`,
    `Correct answer: ${input.answer}`,
    input.explanation ? `Explanation on the card: ${input.explanation}` : "",
    "",
    "WHAT THE STUDENT WROTE:",
    '"""',
    input.attempt,
    '"""',
    "",
    "THE THREE LISTS:",
    "",
    '1. "correct" — what they actually got right. Point at THEIR words, not the',
    "   material's, so they can tell which part of what they wrote you mean. Start",
    '   each entry with "You". If they got nothing right, leave it empty rather than',
    "   inventing credit - false credit is the one thing here that actively harms them.",
    "",
    '2. "missing" — what the material says and they left out. HARD RULE: every entry',
    "   must be something stated in the material above. If the material does not say",
    "   it, it is NOT missing - it is outside what they were asked to explain, and",
    "   listing it makes the app look like it is moving the goalposts on them.",
    "",
    '3. "wrong" — where what they said CONTRADICTS the material. A genuine conflict of',
    "   fact or mechanism, and nothing else:",
    "   - Different wording for the same fact is NOT wrong.",
    '   - Vaguer or less complete than the material is NOT wrong - that is "missing".',
    "   - A claim the material simply does not mention is NOT wrong. You cannot mark a",
    "     student wrong for knowing something their own card did not happen to cover.",
    "",
    "RULES:",
    "- One short sentence per entry. Six entries maximum per list, and fewer is better.",
    "- Never put the same point in two lists.",
    '- Address them as "you". No preamble, no encouragement, no sign-off.',
    "- If their attempt is off-topic, empty of content or gibberish: empty \"correct\",",
    '  the material\'s key points in "missing", and empty "wrong". Do not scold.',
    "",
    "Respond with ONLY raw JSON - no markdown, no code blocks:",
    '{"correct":["You correctly said ..."],"missing":["The material also says ..."],"wrong":[]}',
  ]
    .filter(Boolean)
    .join("\n");
}
