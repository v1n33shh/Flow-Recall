import { z } from "zod";
import type { PaperQuestionType } from "./paperPlan";

/** What the model returns when asked to set a paper from concepts already chosen.
 *
 * The model writes the questions and nothing else. It does not choose what is
 * examined (paperPlan.ts does that, on the device, for free), it does not allocate
 * marks (MARKS does), and **it never supplies a correct answer** - the card already
 * has one, and a model-invented answer would be marked against the student later.
 *
 * `questions` defaults to empty rather than being required, the same posture
 * teachBackSchema and conceptGraphSchema take: there is no `generateObject` on the
 * pinned Groq model, so a hand-parsed response missing a key should cost that key
 * and not the paper. The route rejects an empty list, because a paper with no
 * questions is a model that did not answer and must not be charged for. */
export const PaperQuestionSchema = z.object({
  /** Which slot this answers, echoed back.
   *
   * Not "the questions in order", and the difference is not stylistic. A model that
   * silently skips one question shifts every question after it onto the wrong
   * concept - and because a marked answer is written into the review log against
   * that concept, an off-by-one here would corrupt the one asset in this app that
   * cannot be rebuilt. Pairing by an explicit index makes a skipped question cost
   * that question. */
  slot: z.number().int().min(0).max(63),
  /** The question as it would appear on a paper. */
  prompt: z.string().trim().min(1).max(700),
  /** MCQ only: additional WRONG options.
   *
   * The real answer and the card's own `distractor` are supplied by the client from
   * the card, so what is missing is plausible wrong company. Asking the model for
   * the answer as well would put a generated string into the marking key. */
  extraOptions: z.array(z.string().trim().min(1).max(200)).max(3).default([]),
});

export const PaperResponseSchema = z.object({
  questions: z.array(PaperQuestionSchema).max(40).default([]),
});

export type PaperQuestionResponse = z.infer<typeof PaperQuestionSchema>;
export type PaperResponse = z.infer<typeof PaperResponseSchema>;

/** The material for one slot, as the request carries it.
 *
 * One concept for most types; exactly two, in the order the relation runs, for
 * `contrast` and `chain`. Every optional Concept field arrives as a string with an
 * empty default - decks predate `explanation`, `whyItMatters` and `sourceQuote`, and
 * a prompt that interpolates `undefined` into itself reads as a bug to the model. */
export const slotMaterialSchema = z.object({
  slot: z.number().int().min(0).max(63),
  type: z.enum(["recall", "mcq", "short", "long", "contrast", "chain"]),
  marks: z.number().int().min(1).max(20),
  relation: z.enum(["contrast", "prerequisite", "explains"]).optional(),
  concepts: z
    .array(
      z.object({
        label: z.string().trim().min(1).max(200),
        question: z.string().trim().max(500).default(""),
        answer: z.string().trim().max(300).default(""),
        distractor: z.string().trim().max(300).default(""),
        explanation: z.string().trim().max(2000).default(""),
        whyItMatters: z.string().trim().max(500).default(""),
        sourceQuote: z.string().trim().max(600).default(""),
      }),
    )
    .min(1)
    .max(2),
});

export const paperRequestSchema = z.object({
  /** What the paper is on, for the paper's own heading. */
  subject: z.string().trim().min(1).max(200),
  slots: z.array(slotMaterialSchema).min(1).max(40),
  /** Lets the server count the day against the student's own calendar, as
   * /api/cloze-grade and /api/teach-back both do. Optional, falls back to UTC. */
  timezoneOffsetMinutes: z.number().optional(),
});

export type SlotMaterial = z.infer<typeof slotMaterialSchema>;
export type PaperRequest = z.infer<typeof paperRequestSchema>;

const TYPE_INSTRUCTION: Record<PaperQuestionType, string> = {
  recall: "State it in a phrase. One fact, no explanation asked for.",
  mcq: "One factual question with a single right answer.",
  short: "Ask for the mechanism or the reasoning in two or three sentences.",
  long:
    "Ask for the full mechanism AND why it matters - the kind of question a student" +
    " answers in a paragraph or two and can lose marks on for being incomplete.",
  contrast:
    "Compare and contrast the two, naming the axis they differ on. Not two questions" +
    " joined by 'and' - one question that cannot be answered without both.",
  chain:
    "Ask how the first leads to, causes or accounts for the second. The answer is the" +
    " path between them, not a definition of either.",
};

/** Lives beside the schema rather than in the route, for the reason
 * buildTeachBackPrompt does: whether the pinned Groq model sets a paper that reads
 * like a paper, in a shape parseModelJson accepts, is the one thing typechecking
 * cannot tell you - and exercising it should not require a session cookie.
 *
 * Most of the length goes on the three ways a generated paper stops being one a
 * student can sit. It asks about material the deck does not contain, so no honest
 * answer exists. It asks for a figure, which this pipeline discarded at ingest. Or
 * it gives away the answer inside the question, which every model does when it has
 * the answer in front of it and has not been told not to. */
export function buildPaperPrompt(input: PaperRequest): string {
  const slots = input.slots.map((slot) => {
    const material = slot.concepts
      .map((concept, index) => {
        const position =
          slot.concepts.length === 1 ? "CONCEPT" : index === 0 ? "FIRST CONCEPT" : "SECOND CONCEPT";
        return [
          `  ${position}: ${concept.label}`,
          concept.question ? `    Card question: ${concept.question}` : "",
          concept.answer ? `    Card answer: ${concept.answer}` : "",
          slot.type === "mcq" && concept.distractor
            ? `    Known wrong answer already on the card: ${concept.distractor}`
            : "",
          concept.explanation ? `    Material: ${concept.explanation}` : "",
          concept.whyItMatters ? `    Why it matters: ${concept.whyItMatters}` : "",
          concept.sourceQuote ? `    Quoted from their notes: "${concept.sourceQuote}"` : "",
        ]
          .filter(Boolean)
          .join("\n");
      })
      .join("\n");

    return [
      `SLOT ${slot.slot} — ${slot.type}, ${slot.marks} mark${slot.marks === 1 ? "" : "s"}`,
      slot.relation ? `  Relationship: ${slot.relation}` : "",
      material,
      `  How to ask it: ${TYPE_INSTRUCTION[slot.type]}`,
    ]
      .filter(Boolean)
      .join("\n");
  });

  return [
    `You are setting a written exam paper on "${input.subject}" from a student's own`,
    "uploaded course material. The concepts to examine and the marks for each have",
    "already been chosen - your job is only to write the questions.",
    "",
    "HARD RULES:",
    "",
    "1. Every question must be fully answerable FROM THE MATERIAL GIVEN IN ITS SLOT",
    "   and from nothing else. You are not testing general knowledge of the subject;",
    "   you are testing what this student's notes actually contain. If a slot's",
    "   material is thin, ask a smaller question - never reach outside it.",
    "",
    "2. NEVER ask for a diagram, figure, graph, table or labelled drawing, and never",
    "   refer to 'the figure' or 'the diagram above'. The student is typing prose into",
    "   a phone and the material you were given is text only.",
    "",
    "3. DO NOT GIVE THE ANSWER AWAY. You can see the card's answer; the student cannot.",
    "   A question that contains its own answer is worth no marks to anyone. Do not",
    "   restate the answer, do not hint at it, and do not name the mechanism you are",
    "   asking them to name.",
    "",
    "4. Write the question so it is WORTH ITS MARKS. A 1-mark question asks for one",
    "   fact. A 10-mark question asks for a mechanism and its consequence, and should",
    "   have several distinct things a marker could award marks for.",
    "",
    "5. Phrase it as an examiner would - 'State', 'Explain', 'Compare and contrast',",
    "   'Account for', 'Describe how'. Not as a flashcard, and not as a quiz question",
    "   with a chatty preamble.",
    "",
    '6. Echo each slot\'s number in "slot". Answer every slot exactly once. If you',
    "   genuinely cannot set a question for one, omit it rather than inventing one.",
    "",
    '7. "extraOptions" is ONLY for mcq slots: two plausible but WRONG options, the same',
    "   length and style as the card's answer, and different from the wrong answer",
    "   already on the card. Never put the correct answer in extraOptions. Leave it",
    "   empty for every other slot type.",
    "",
    "THE SLOTS:",
    "",
    slots.join("\n\n"),
    "",
    "Respond with ONLY raw JSON - no markdown, no code blocks, no commentary:",
    '{"questions":[{"slot":0,"prompt":"Explain how ...","extraOptions":[]}]}',
  ].join("\n");
}
