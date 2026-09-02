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
import { FREE_DECKS_PER_MONTH, countInCurrentMonth } from "@/lib/freeQuota";
import { claimDeckAllowance } from "@/lib/freeQuotaDb";
import { parseTimezoneOffsetMinutes } from "@/lib/localDay";

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
  // Which calendar month the FREE allowance is counted in belongs to the student,
  // not to the server process (always UTC on Vercel). Same convention as
  // /api/cloze-grade and /api/streak: the client sends getTimezoneOffset().
  timezoneOffsetMinutes: z.number().optional(),
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
  const timezoneOffsetMinutes = parseTimezoneOffsetMinutes(parsed.data.timezoneOffsetMinutes);
  const now = new Date();

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

  // FREE_DECKS_PER_MONTH per calendar month, rolled over in application code -
  // the columns stay named `decksGeneratedToday`/`lastDeckGeneratedDate` (a stale
  // per-day name kept through two pivots now) so this needs no Supabase migration.
  // See freeQuota.ts for why the allowance is monthly rather than the one-deck
  // lifetime cap this used to be.
  const generatedThisMonth = countInCurrentMonth(
    user?.decksGeneratedToday ?? 0,
    user?.lastDeckGeneratedDate ?? null,
    now,
    timezoneOffsetMinutes,
  );

  // Refuse before spending anything. Only the first chunk of a stream is counted,
  // so a multi-chunk deck costs one allowance however many requests it takes.
  if (plan !== "PRO" && isFirstChunk && generatedThisMonth >= FREE_DECKS_PER_MONTH) {
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

    // Record this deck against the monthly allowance - only on the first chunk.
    // PRO has no cap, so its increment stays unconditional and exists only as a
    // usage metric; FREE goes through the atomic claim, which is what stops two
    // concurrent requests from both reading a pre-increment count and both passing
    // the check above.
    if (isFirstChunk) {
      if (plan === "PRO") {
        await prisma.user.update({
          where: { id: session.user.id },
          data: { decksGeneratedToday: { increment: 1 }, lastDeckGeneratedDate: now },
        });
      } else if (!(await claimDeckAllowance(session.user.id, now, timezoneOffsetMinutes))) {
        // Lost a race for the last free slot. Generation already happened and cost
        // real money, but a FREE account must never exceed its allowance.
        return Response.json({ error: "FREE_LIMIT_REACHED" }, { status: 403 });
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
