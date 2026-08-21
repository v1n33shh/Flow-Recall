export const maxDuration = 30;

import { generateText } from "ai";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { resolveEffectivePlan } from "@/lib/billing";
import { FREE_MODEL, getFriendlyErrorMessage, getProviderModel, parseModelJson } from "@/lib/ai";
import { DefinitionResponseSchema } from "@/lib/definitionSchema";

// Lifetime cap for FREE plans, matching /api/ingest's "1 deck for life"
// pivot rather than a daily reset - simpler to reason about and simpler to
// enforce (no day-rollover logic needed, just a running counter).
const FREE_DEFINITION_LIMIT = 20;

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
  // Login-gated to block anonymous cost abuse, same as /api/ingest.
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

  // Read plan + usage fresh from the DB - never trust a client-supplied
  // count, same reasoning as /api/ingest's server-side quota check. FREE
  // gets a lifetime cap of FREE_DEFINITION_LIMIT lookups; PRO is unlimited
  // and never hits this branch.
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { plan: true, currentPeriodEnd: true, definitionsUsed: true },
  });
  const plan = await resolveEffectivePlan(
    user ? { id: session.user.id, plan: user.plan, currentPeriodEnd: user.currentPeriodEnd } : null,
  );
  const definitionsUsed = user?.definitionsUsed ?? 0;

  if (plan !== "PRO" && definitionsUsed >= FREE_DEFINITION_LIMIT) {
    return Response.json({ error: "LIMIT_REACHED" }, { status: 403 });
  }

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

    // Only a successful, validated lookup consumes a unit - a failed Groq
    // call or a malformed response above returns before this and costs the
    // user nothing. Incremented regardless of plan (see schema.prisma) so
    // it doubles as a usage metric once a user is Pro.
    await prisma.user.update({
      where: { id: session.user.id },
      data: { definitionsUsed: definitionsUsed + 1 },
    });

    return Response.json(validated.data);
  } catch (error) {
    console.error("Define failed", error);
    return Response.json(
      { error: getFriendlyErrorMessage(error, { provider: "Groq" }) },
      { status: 502 },
    );
  }
}
