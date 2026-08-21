export const maxDuration = 60;

import { generateText } from "ai";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { resolveEffectivePlan } from "@/lib/billing";
import {
  FREE_MODEL,
  getFriendlyErrorMessage,
  getProviderModel,
  isProModel,
  providerLabel,
  parseModelJson,
} from "@/lib/ai";
import { ConceptsResponseSchema } from "@/lib/conceptSchema";

const requestSchema = z.object({
  text: z.string().min(1),
  // The model the client requested. FREE plans are pinned to Groq regardless,
  // so this only matters on a PRO plan. Defaults to the free model.
  model: z
    .enum([FREE_MODEL, "gpt-4o", "claude-haiku-latest"])
    .default(FREE_MODEL),
  // A single deck generation is sent as up to MAX_CHUNKS sequential requests.
  // The daily FREE quota is per *deck*, so only the first chunk of a deck
  // enforces and increments the limit; continuation chunks (false) pass
  // through. Defaults true so a plain single-chunk request always counts.
  isFirstChunk: z.boolean().default(true),
});

function buildConceptsPrompt(text: string): string {
  return [
    "You are a demanding professor creating challenging active-recall flashcards.",
    "STRICT LIMIT: Generate a MAXIMUM of 3 flashcards from the source material below.",
    "Do NOT generate more than 3. Quality over quantity.",
    "",
    "Each flashcard must be genuinely hard - test deep understanding not surface recall.",
    "Distractors must be dangerously plausible — a subtle near-miss that targets a real misconception.",
    "'answer' must be a concise phrase under 6 words.",
    "'cloze' must contain exactly '_____' where the answer goes.",
    "",
    "DEEP-DIVE EXPLANATION - this is the most important field:",
    "- 'explanation' must be a rich 3-4 sentence paragraph that deeply explains the concept,",
    "  its mechanisms, and why it matters. This is what the student reads after answering.",
    "- Never write a short phrase for explanation. Always write a full paragraph.",
    "",
    "Respond with ONLY raw JSON - no markdown, no code blocks:",
    '{"concepts":[{"concept":"short label","question":"hard recall question","answer":"concise answer under 6 words","distractor":"plausible wrong answer","cloze":"sentence with _____ blank","explanation":"a rich 3-4 sentence paragraph explaining the concept deeply"}]}',
    "",
    "Source material:",
    text,
  ].join("\n");
}

export async function POST(request: Request) {
  // Generation is gated behind login - no anonymous access to the AI engine.
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json(
      { error: "You must be signed in to generate concepts." },
      { status: 401 },
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = requestSchema.safeParse(body);

  if (!parsed.success) {
    // Surface the actual validation failure (e.g. an invalid model enum value)
    // instead of masking every schema error as a missing-text message.
    const message = parsed.error.issues.map((issue) => issue.message).join("; ");
    return Response.json(
      { error: message || "Invalid request." },
      { status: 400 },
    );
  }

  const { text, model: requestedModel, isFirstChunk } = parsed.data;

  // Read the plan fresh from the DB - never trust a plan claim from the client,
  // and don't rely on the (possibly stale) JWT, so an upgrade takes effect on
  // the next request and a tampered payload can't unlock the Pro models.
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      plan: true,
      currentPeriodEnd: true,
      decksGeneratedToday: true,
      lastDeckGeneratedDate: true,
    },
  });
  const plan = await resolveEffectivePlan(
    user ? { id: session.user.id, plan: user.plan, currentPeriodEnd: user.currentPeriodEnd } : null,
  );

  // Server-side mirror of the UI's Pro gate. The UI disables the button, but
  // that's cosmetic - this is the check that actually enforces it.
  if (plan !== "PRO" && isProModel(requestedModel)) {
    return Response.json(
      { error: "You need a Pro subscription to use this model." },
      { status: 403 },
    );
  }

  // We are pivoting to a LIFETIME free limit (1 deck forever) rather than daily.
  // We just read the raw counter and never roll it over. We leave the DB column
  // named `decksGeneratedToday` for now to avoid a Supabase DB migration.
  const generatedTotal = user?.decksGeneratedToday ?? 0;

  // Paywall: FREE plans get exactly 1 deck for life. Only the first chunk of
  // a stream increments the limit (checked by `generatedTotal >= 1`).
  if (plan !== "PRO" && isFirstChunk && generatedTotal >= 1) {
    return Response.json({ error: "FREE_LIMIT_REACHED" }, { status: 403 });
  }

  try {
    const model = getProviderModel(plan, requestedModel);
    // maxOutputTokens at 1500 — enough for 3 concepts with full rich
    // 3-4 sentence explanations while staying well under Vercel's 60s limit.
    const { text: rawText } = await generateText({
      model,
      prompt: buildConceptsPrompt(text),
      maxOutputTokens: 1500,
    });

    let rawJson: unknown;
    try {
      rawJson = parseModelJson(rawText);
    } catch (parseError) {
      console.error("Ingest JSON parse failed", parseError, "raw text:", rawText);
      return Response.json(
        { error: "The model returned a response we couldn't understand. Please try again." },
        { status: 502 },
      );
    }

    const validated = ConceptsResponseSchema.safeParse(rawJson);
    if (!validated.success) {
      console.error("Ingest schema validation failed", validated.error, "raw text:", rawText);
      return Response.json(
        { error: "The model's response didn't match the expected format. Please try again." },
        { status: 502 },
      );
    }

    const concepts = validated.data.concepts.map((concept) => ({
      id: crypto.randomUUID(),
      ...concept,
    }));

    // Record this deck against the lifetime quota - only on the first chunk.
    if (isFirstChunk) {
      await prisma.user.update({
        where: { id: session.user.id },
        data: {
          decksGeneratedToday: generatedTotal + 1,
          lastDeckGeneratedDate: new Date(),
        },
      });
    }

    return Response.json({ concepts });
  } catch (error) {
    console.error("Ingest failed", error);
    return Response.json(
      {
        error: getFriendlyErrorMessage(error, {
          provider: providerLabel(plan, requestedModel),
        }),
      },
      { status: 502 },
    );
  }
}
