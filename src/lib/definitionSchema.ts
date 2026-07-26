import { z } from "zod";

export const DefinitionResponseSchema = z.object({
  definition: z
    .string()
    .min(1)
    .describe("A razor-sharp 1-2 sentence definition of the phrase, using the surrounding context to pick the right sense of the word."),
  examples: z
    .array(z.string().min(1))
    .length(2)
    .describe("Two short, concrete example sentences that use the phrase the same way the source context does."),
});

export type DefinitionResponse = z.infer<typeof DefinitionResponseSchema>;
