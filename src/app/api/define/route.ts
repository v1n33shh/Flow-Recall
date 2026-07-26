export const maxDuration = 30;

import { generateText } from "ai";
import { z } from "zod";
import { auth } from "@/auth";
import { FREE_MODEL, getFriendlyErrorMessage, getProviderModel, parseModelJson } from "@/lib/ai";
import { DefinitionResponseSchema } from "@/lib/definitionSchema";

const requestSchema = z.object({
  phrase: z.string().trim().min(1).max(200),
  // The sentence/paragraph the phrase was highlighted from - lets the model
  // disambiguate ("discharge" in cardiology vs. contract law) instead of
  // guessing from the phrase alone. Optional since a selection can in theory
  // be the entire visible text of its containing block.
  context: z.string().trim().max(2000).default(""),
});

function buildDefinePrompt(phrase: string, context: string): string {
  return [
    "You are a world-class lexicographer helping a medical/law student who just",
    "highlighted a word or phrase while reading a dense textbook and does not",
    "want to break focus to look it up elsewhere.",
    "",
    `Phrase to define: "${phrase}"`,
    context ? `Surrounding context it was highlighted from: "${context}"` : "",
    "",
    "Use the context to pick the correct sense of the phrase if it has more than",
    "one meaning across fields. Write ONE-TO-TWO sentences, razor-sharp and",
    "precise - no filler, no restating the question, no \"this term refers to\".",
    "Then give exactly two short example sentences that use the phrase the same",
    "way the context does, concrete enough to cement understanding on first read.",
    "",
    "Respond with ONLY raw JSON - no markdown, no code blocks:",
    '{"definition":"1-2 sentence definition","examples":["example sentence one","example sentence two"]}',
  ]
    .filter(Boolean)
    .join("\n");
}

export async function POST(request: Request) {
  // Login-gated to block anonymous cost abuse, same as /api/ingest - but
  // deliberately NOT plan- or quota-gated. This is the reader's core flow-
  // state feature, not the monetized deck-generation primitive, so every
  // signed-in user always gets it on the fast, free Groq lane.
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json(
      { error: "You must be signed in to use AI definitions." },
      { status: 401 },
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => issue.message).join("; ");
    return Response.json({ error: message || "Invalid request." }, { status: 400 });
  }

  const { phrase, context } = parsed.data;

  try {
    const model = getProviderModel("FREE", FREE_MODEL);
    const { text: rawText } = await generateText({
      model,
      prompt: buildDefinePrompt(phrase, context),
      maxOutputTokens: 300,
    });

    let rawJson: unknown;
    try {
      rawJson = parseModelJson(rawText);
    } catch (parseError) {
      console.error("Define JSON parse failed", parseError, "raw text:", rawText);
      return Response.json(
        { error: "The model returned a response we couldn't understand. Please try again." },
        { status: 502 },
      );
    }

    const validated = DefinitionResponseSchema.safeParse(rawJson);
    if (!validated.success) {
      console.error("Define schema validation failed", validated.error, "raw text:", rawText);
      return Response.json(
        { error: "The model's response didn't match the expected format. Please try again." },
        { status: 502 },
      );
    }

    return Response.json(validated.data);
  } catch (error) {
    console.error("Define failed", error);
    return Response.json(
      { error: getFriendlyErrorMessage(error, { provider: "Groq" }) },
      { status: 502 },
    );
  }
}
