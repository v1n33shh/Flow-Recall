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
  // than failing validation for the whole ingest batch.
  explanation: z
    .string()
    .describe(
      "A full, detailed paragraph (3-4 sentences) deeply explaining the concept, its mechanisms, and why it matters. Used for deep-dive reading.",
    )
    .optional(),
});

export const ConceptsResponseSchema = z.object({
  concepts: z.array(RawConceptSchema).min(1),
});

export type RawConcept = z.infer<typeof RawConceptSchema>;
