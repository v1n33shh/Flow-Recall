import { z } from "zod";

/** What the model returns when a student asks a question about one concept.
 *
 * Deliberately one field. The temptation is to ask for a structured answer -
 * summary, detail, caveats - but every extra field is another thing the lenient
 * hand-parser has to survive (there is no `generateObject` on the pinned Groq
 * model, see lib/ai.ts), and a student who asked a question wants the answer, not
 * a form. */
export const AskResponseSchema = z.object({
  answer: z
    .string()
    .trim()
    .min(1)
    .describe(
      "A direct answer to the student's question about this concept, 2-4 sentences, " +
        "grounded in the concept's own material.",
    ),
  /** True when the concept's material does not actually contain the answer.
   *
   * The one field worth the parse risk. Without it the model quietly invents
   * plausible neighbouring facts when asked something the card does not cover,
   * and a confident fabrication inside a study tool is worse than "the material
   * doesn't say" - the student has no way to tell the two apart, and this is the
   * app they are trusting to be right. Optional so an omission degrades to
   * "assume it was covered" rather than failing the whole response. */
  beyondMaterial: z.boolean().optional(),
});

export type AskResponse = z.infer<typeof AskResponseSchema>;

export const askRequestSchema = z.object({
  /** The concept's short label, e.g. "Frank-Starling Mechanism". */
  label: z.string().trim().min(1).max(200),
  /** The card's own question, so the model knows what was being asked. */
  question: z.string().trim().min(1).max(500),
  answer: z.string().trim().min(1).max(300),
  /** The generated deep-dive paragraph. Optional - decks predate the field. */
  explanation: z.string().trim().max(2000).default(""),
  /** What the student actually wants to know. */
  ask: z.string().trim().min(1).max(300),
});

/** Lives beside the schema rather than in the route so it can be exercised
 * against the real model without dragging next-auth and a session cookie in -
 * whether the pinned Groq model answers THIS prompt in a shape parseModelJson and
 * the schema both accept is the one thing typechecking cannot tell you. */
export function buildAskPrompt(input: z.infer<typeof askRequestSchema>): string {
  return [
    "You are a patient, precise tutor. A student is studying one specific concept",
    "from their own uploaded material and has asked you a question about it. They",
    "have already seen the answer and the explanation below - so do NOT restate",
    "them. Answer the question they actually asked.",
    "",
    "THE CONCEPT THEY ARE STUDYING",
    `Label: ${input.label}`,
    `Question on the card: ${input.question}`,
    `Correct answer: ${input.answer}`,
    input.explanation ? `Explanation they have already read: ${input.explanation}` : "",
    "",
    `THE STUDENT'S QUESTION: ${input.ask}`,
    "",
    "HOW TO ANSWER:",
    "- 2-4 sentences. Direct. No preamble, no 'great question', no restating their question.",
    "- Explain the mechanism or the reasoning, not just the fact. They asked because",
    "  the explanation above did not land, so find a different angle rather than",
    "  rephrasing it: an analogy, a cause-and-effect chain, or a contrast with the",
    "  thing they are probably confusing it with.",
    "- Stay on THIS concept. Do not drift into adjacent material they did not ask about.",
    "",
    "WHEN THE QUESTION GOES BEYOND THE MATERIAL:",
    "- Answer it anyway if it is well-established, textbook-standard knowledge for this",
    "  topic. Do NOT refuse a basic question just because their card did not happen to",
    "  mention it; they asked because they want to understand the concept, not to be told",
    "  the boundaries of their own upload.",
    "- Only decline when you genuinely cannot state the answer with confidence. Then say",
    "  so in one sentence and give the closest thing the material DOES support.",
    "- Never invent a specific number, dose, name or mechanism to fill a gap. A confident",
    "  wrong answer is far worse here than an admission, because the student is trusting",
    "  this to be right and has no way to check it.",
    "",
    "THE beyondMaterial FLAG - one test only, and it is about the FACT you assert, not",
    "about how you phrase it or how sure you feel:",
    "- The fact you state IS supported by the concept material above -> false. Using an",
    "  analogy or your own wording does not make it true; explaining something that is",
    "  already there is still internal.",
    "- The fact you state relies on knowledge that is NOT in the material above -> true.",
    "- Not a confidence score and not a quality score. A perfect answer drawn from outside",
    "  the material is still true; a tentative answer drawn from the material is still false.",
    "- Asked WHY something the material already states, and you explained that same fact",
    "  more clearly or with an analogy: FALSE. You added clarity, not new facts.",
    "- Asked about something the material never mentions at all - a different measurement,",
    "  a clinical or practical setting, a neighbouring structure - and you answered from",
    "  standard knowledge of the field: TRUE.",
    "",
    "Respond with ONLY raw JSON - no markdown, no code blocks:",
    '{"answer":"2-4 sentence answer","beyondMaterial":false}',
  ]
    .filter(Boolean)
    .join("\n");
}
