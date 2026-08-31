export const maxDuration = 60;

import { generateText } from "ai";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { resolveEffectivePlan } from "@/lib/billing";
import {
  FREE_MODEL,
  GROQ_PROVIDER_OPTIONS,
  getFriendlyErrorMessage,
  getProviderModel,
  isProModel,
  providerLabel,
  parseModelJson,
} from "@/lib/ai";
import { ConceptsResponseSchema, buildConceptsPrompt } from "@/lib/conceptSchema";
import { applyQualityGate } from "@/lib/conceptQuality";

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

  // A JWT outlives the row it names: sessions are stateless (src/auth.ts sets
  // strategy "jwt" and keeps a token valid when the lookup finds nothing), so a
  // token held across account deletion would otherwise read as a brand-new FREE
  // user with zero usage and sail through the quota gate below. Same guard
  // /api/study/track already applies.
  if (!user) {
    return Response.json({ error: "You must be signed in." }, { status: 401 });
  }
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
    // Raised from 1500 when misconception/whyItMatters/sourceQuote were added -
    // roughly 80 more tokens per card, and a truncated response is not a degraded
    // card but a dead batch, since parseModelJson's balanced-brace fallback cannot
    // repair an object that stops mid-string. Still sized for 3 cards; if the 60s
    // limit ever starts biting, the lever is the client's 1500-char chunk size
    // (see MAX_CHUNKS in src/app/ingest/page.tsx), not this.
    const { text: rawText } = await generateText({
      model,
      prompt: buildConceptsPrompt(text),
      maxOutputTokens: 2400,
      providerOptions: GROQ_PROVIDER_OPTIONS,
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

    // Everything the schema cannot assert - see applyQualityGate. Logged so the
    // rate is visible: if a prompt change is supposed to fix substitutability,
    // this is the number that has to move.
    const gated = applyQualityGate(validated.data.concepts);
    if (gated.report.clozeCleared > 0 || gated.report.dropped > 0) {
      console.warn("Ingest quality gate", gated.report);
    }
    if (gated.concepts.length === 0) {
      return Response.json(
        { error: "The model's cards didn't pass our quality checks. Please try again." },
        { status: 502 },
      );
    }

    const concepts = gated.concepts.map((concept) => ({
      id: crypto.randomUUID(),
      ...concept,
    }));

    // Record this deck against the lifetime quota - only on the first chunk.
    // Atomic + conditional for FREE (not the plain read-then-write this used
    // to be) - two concurrent requests reading the same stale `generatedTotal`
    // before either write lands could otherwise both pass the earlier check
    // and both increment, letting a FREE account get more than its one
    // lifetime deck. PRO has no cap, so its increment stays unconditional.
    if (isFirstChunk) {
      if (plan === "PRO") {
        await prisma.user.update({
          where: { id: session.user.id },
          data: { decksGeneratedToday: { increment: 1 }, lastDeckGeneratedDate: new Date() },
        });
      } else {
        const result = await prisma.user.updateMany({
          where: { id: session.user.id, decksGeneratedToday: { lt: 1 } },
          data: { decksGeneratedToday: { increment: 1 }, lastDeckGeneratedDate: new Date() },
        });
        if (result.count === 0) {
          // Lost a race for the one free slot - generation already happened
          // and cost real money, but a FREE account must never end up with
          // more than its one lifetime deck.
          return Response.json({ error: "FREE_LIMIT_REACHED" }, { status: 403 });
        }
      }
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
