import { z } from "zod";

export const RawConceptSchema = z.object({
  concept: z.string().describe("A short 2-6 word label for the idea"),
  question: z.string().describe("A focused recall question about the concept"),
  answer: z.string().describe("The concise correct answer, ideally under 6 words"),
  distractor: z
    .string()
    .describe(
      "A short, plausible but INCORRECT answer to the same question, similar length and style to the real answer - used as the false option in a true/false quiz",
    ),
  cloze: z
    .string()
    .describe(
      "A single declarative sentence stating the fact, with the answer phrase replaced by exactly '_____'. The blank must be fillable with the answer field verbatim.",
    ),
  // Optional so a model omission degrades one card to its short answer rather
  // than failing validation for the whole ingest batch. The three fields below
  // follow the same rule for the same reason - and because every deck already
  // saved predates them, so nothing may require them.
  explanation: z
    .string()
    .describe(
      "A full, detailed paragraph (3-4 sentences) deeply explaining the concept, its mechanisms, and why it matters. Used for deep-dive reading.",
    )
    .optional(),
  misconception: z
    .string()
    .describe(
      "One sentence naming the wrong belief the distractor encodes, and why a real student would hold it - e.g. 'students confuse stroke volume with cardiac output because both are per-beat quantities'. Shown when the card is answered wrong.",
    )
    .optional(),
  whyItMatters: z
    .string()
    .describe(
      "One short sentence on what knowing this lets you do, predict or avoid. Not a restatement of the fact.",
    )
    .optional(),
  sourceQuote: z
    .string()
    .describe(
      "The single sentence from the source material this card was generated from, quoted verbatim. Omit rather than paraphrase.",
    )
    .optional(),
});

export const ConceptsResponseSchema = z.object({
  concepts: z.array(RawConceptSchema).min(1),
});

export type RawConcept = z.infer<typeof RawConceptSchema>;

/** The ingest prompt, kept beside the schema it has to satisfy and exported so it
 * can be run against the real model without dragging auth, Prisma and a quota row
 * in. Whether the pinned model actually emits these fields, in a shape
 * parseModelJson accepts, inside the token budget, is the one thing typechecking
 * cannot answer - and it has been wrong before. */
export function buildConceptsPrompt(text: string): string {
  return [
    "You are a demanding professor creating challenging active-recall flashcards.",
    "STRICT LIMIT: Generate a MAXIMUM of 3 flashcards from the source material below.",
    "Do NOT generate more than 3. Quality over quantity.",
    "",
    "Each flashcard must be genuinely hard - test deep understanding not surface recall.",
    "Distractors must be dangerously plausible — a subtle near-miss that targets a real misconception.",
    "Each flashcard must test a DIFFERENT fact or mechanism from the source material.",
    "Never generate two flashcards that test the same underlying fact from a slightly",
    "different angle - if the material only supports one genuinely distinct hard",
    "question, return just that one card rather than padding with a near-duplicate.",
    "'answer' must be a concise phrase under 6 words.",
    "'cloze' must contain exactly '_____' where the answer goes.",
    "CRITICAL: 'answer' must be the EXACT words that fill that blank - if you",
    "substitute 'answer' into the _____ in 'cloze', the sentence must read as a",
    "single grammatically correct sentence. Never make 'answer' a restatement or",
    "summary of the whole fact (e.g. a mini-sentence like 'X drives Y') - it must",
    "be only the specific term or phrase actually missing, nothing more.",
    "",
    // Abstract instruction was not enough: real output produced both of these.
    // Naming the exact failure with a corrected version beside it is the only
    // thing that has moved this model on this rule.
    "WORKED EXAMPLES OF THE MISTAKE YOU MUST NOT MAKE:",
    "  WRONG  cloze: 'Stroke volume is end-diastolic volume minus _____'",
    "         answer: 'EDV minus ESV'",
    "         (substituting gives 'volume minus EDV minus ESV' - the answer",
    "          repeated words already in the sentence)",
    "  RIGHT  cloze: 'Stroke volume is end-diastolic volume minus _____'",
    "         answer: 'end-systolic volume'",
    "  WRONG  cloze: 'Stretching sarcomeres improves _____'",
    "         answer: 'improved actin-myosin overlap'",
    "         (substituting gives 'improves improved actin-myosin overlap')",
    "  RIGHT  cloze: 'Stretching sarcomeres improves _____'",
    "         answer: 'actin-myosin overlap'",
    "Before you emit each card, actually perform the substitution in your head and",
    "reject any card where the result repeats itself or reads ungrammatically.",
    "",
    "DEEP-DIVE EXPLANATION - this is the most important field:",
    "- 'explanation' must be a rich 3-4 sentence paragraph that deeply explains the concept,",
    "  its mechanisms, and why it matters. This is what the student reads after answering.",
    "- Never write a short phrase for explanation. Always write a full paragraph.",
    "",
    "THREE MORE FIELDS, each ONE sentence:",
    "- 'misconception': name the wrong belief your 'distractor' encodes and why a real",
    "  student would hold it. This is shown to a student who got the card wrong, so it",
    "  must explain the error, not restate the right answer.",
    "- 'whyItMatters': what knowing this lets someone do, predict or avoid. Never a",
    "  restatement of the fact itself.",
    "- 'sourceQuote': the one sentence from the source material below that this card",
    "  came from, quoted VERBATIM. If no single sentence carries it, omit the field",
    "  entirely rather than paraphrasing - a misattributed quote is worse than none.",
    "",
    "Respond with ONLY raw JSON - no markdown, no code blocks:",
    '{"concepts":[{"concept":"short label","question":"hard recall question","answer":"concise answer under 6 words","distractor":"plausible wrong answer","cloze":"sentence with _____ blank","explanation":"a rich 3-4 sentence paragraph explaining the concept deeply","misconception":"one sentence naming the wrong belief the distractor encodes","whyItMatters":"one sentence on what this lets you do or predict","sourceQuote":"the verbatim source sentence this came from"}]}',
    "",
    "Source material:",
    text,
  ].join("\n");
}
