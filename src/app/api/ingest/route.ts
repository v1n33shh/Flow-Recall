export const maxDuration = 60;

import { generateText } from "ai";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { resolveEffectivePlan } from "@/lib/billing";
import {
  acceptedModelIds,
  FREE_MODEL,
  groqProviderOptions,
  getFriendlyErrorMessage,
  getProviderModel,
  isProModel,
  providerLabel,
  parseModelJson,
  readRateLimit,
} from "@/lib/ai";
import { APICallError } from "ai";
import { ConceptsResponseSchema, buildConceptsPrompt } from "@/lib/conceptSchema";
import { applyQualityGate } from "@/lib/conceptQuality";
import { FREE_DECKS_PER_MONTH, countInCurrentMonth, generationLimitForPlan } from "@/lib/freeQuota";
import { claimDeckAllowance, claimGenerationRequest } from "@/lib/freeQuotaDb";
import { parseTimezoneOffsetMinutes } from "@/lib/localDay";

const requestSchema = z.object({
  text: z.string().min(1),
  // The model the client requested. FREE plans are pinned to Groq regardless,
  // so this only matters on a PRO plan. Defaults to the free model.
  //
  // The accepted set includes the free models this app has retired, because a
  // continuation replays the id its deck was generated with - see
  // RETIRED_FREE_MODELS for what listing only the current one cost.
  model: z.enum(acceptedModelIds()).default(FREE_MODEL),
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

  // The second ceiling, and the one that actually bounds spend: every chunk counts,
  // on either plan, claimed BEFORE the model call because that call is where the
  // money goes. The deck gate above cannot do this job - it is per deck, and a deck
  // is up to MAX_CHUNKS requests, while "Generate Next Section" sends four more per
  // tap under isFirstChunk: false and was never counted at all. See freeQuota.ts.
  //
  // No `retryable` on the answer, deliberately: runChunks retries a 429 and a
  // model-output 502 because those come good on a second attempt, and this one never
  // will. Retrying it three times would only delay the message by two minutes.
  const generationLimit = generationLimitForPlan(plan);
  if (!(await claimGenerationRequest(session.user.id, now, timezoneOffsetMinutes, generationLimit))) {
    return Response.json(
      {
        error:
          plan === "PRO"
            ? `You've generated ${generationLimit} sections this month, which is our fair-use ceiling. It resets at the start of next month - reply to your receipt if you need it raised.`
            : "You've used this month's generation budget. Your allowance resets at the start of next month, and everything you've already made stays free to study.",
        code: "GENERATION_BUDGET_REACHED",
      },
      { status: 403 },
    );
  }

  try {
    const model = getProviderModel(plan, requestedModel);
    // A truncated response is not a degraded card but a dead batch: parseModelJson's
    // balanced-brace fallback cannot repair an object that stops mid-string. 2400 is
    // sized for the 3 cards buildConceptsPrompt asks for, and MEASURED against the
    // pinned free model on a real 2706-character chunk off the user's phone: actual
    // output was 868-1000 tokens with finishReason "stop" at every cap from 900 to
    // 2400, i.e. the model self-limits and never comes near this number.
    //
    // Do not raise it hoping to dodge a rate limit. Groq's free tier rejects on
    // output tokens per MINUTE (OTPM), not on this cap: the same chunk succeeded
    // identically at max_tokens 900, 1200 and 2400, and failed only when a second
    // request landed inside the same minute. The lever for that is the client's
    // spacing (see RATE_LIMIT_BACKOFF_MS in src/lib/ingestChunks.ts), not this.
    const { text: rawText, usage } = await generateText({
      model,
      prompt: buildConceptsPrompt(text),
      maxOutputTokens: 2400,
      // The client is the retry layer now, deliberately - see runChunks. The SDK's
      // default (2 retries) is actively harmful here: it honours Groq's
      // `retry-after: 43`, so a rate-limited chunk sat inside ONE request for 27-58
      // seconds against this route's own `maxDuration = 60`. Measured on the user's
      // phone: round trips of 58527ms, 58606ms and 56102ms, i.e. within 1.5s of
      // Vercel killing the function and turning a 43-second wait into a 504.
      //
      // At 0 a rate limit comes back in ~200ms with its Retry-After intact, and the
      // waiting happens on the client - which is not on a serverless clock and can
      // tell the student what it is waiting for.
      maxRetries: 0,
      providerOptions: groqProviderOptions(),
    });

    // Nothing else in this app records what a generation cost. Logged rather than
    // stored because the question it answers is "what is the bill doing this week",
    // and the measured baseline to compare against is 1435 input / 886 output tokens
    // per request on the free model.
    console.log("Ingest usage", {
      plan,
      model: requestedModel,
      inputTokens: usage?.inputTokens ?? null,
      outputTokens: usage?.outputTokens ?? null,
      sourceChars: text.length,
    });

    let rawJson: unknown;
    try {
      rawJson = parseModelJson(rawText);
    } catch (parseError) {
      console.error("Ingest JSON parse failed", parseError, "raw text:", rawText);
      // `retryable`, here and in the two answers below, is what lets the client
      // send this same chunk again rather than abandoning the rest of the book on
      // one bad roll of the dice - see MAX_CHUNK_ATTEMPTS in the ingest page. All
      // three of these return before the allowance is claimed, so a retry can
      // never cost a FREE account a second deck.
      return Response.json(
        {
          error: "The model returned a response we couldn't understand. Please try again.",
          code: "MODEL_UNPARSEABLE",
          retryable: true,
        },
        { status: 502 },
      );
    }

    const validated = ConceptsResponseSchema.safeParse(rawJson);
    if (!validated.success) {
      console.error("Ingest schema validation failed", validated.error, "raw text:", rawText);
      return Response.json(
        {
          error: "The model's response didn't match the expected format. Please try again.",
          code: "MODEL_SCHEMA",
          retryable: true,
        },
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
        {
          error: "The model's cards didn't pass our quality checks. Please try again.",
          code: "QUALITY_GATE",
          retryable: true,
        },
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
    const message = getFriendlyErrorMessage(error, {
      provider: providerLabel(plan, requestedModel),
    });

    // A rate limit leaves as a 429 with the provider's own wait, not as a 502.
    // Flattening it into the generic failure is what turned "wait four seconds"
    // into "the rest of your book is gone": the client cannot back off against an
    // error it cannot recognise.
    const rateLimit = readRateLimit(error);
    if (rateLimit) {
      const { retryAfterSeconds } = rateLimit;
      return Response.json(
        { error: message, code: "RATE_LIMITED", retryable: true, retryAfterSeconds },
        {
          status: 429,
          headers: retryAfterSeconds ? { "Retry-After": String(retryAfterSeconds) } : undefined,
        },
      );
    }

    // The SDK already decides this for transport-level failures (timeouts, 5xx,
    // connection resets are retryable; a rejected key is not), so defer to it and
    // only assume retryable for errors it never saw.
    const retryable = APICallError.isInstance(error) ? error.isRetryable : true;
    return Response.json(
      { error: message, code: "PROVIDER_FAILED", retryable },
      { status: 502 },
    );
  }
}
