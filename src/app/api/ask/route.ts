export const maxDuration = 30;

import { generateText } from "ai";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { resolveEffectivePlan } from "@/lib/billing";
import {
  FREE_MODEL,
  groqProviderOptions,
  getFriendlyErrorMessage,
  getProviderModel,
  parseModelJson,
} from "@/lib/ai";
import { AskResponseSchema, askRequestSchema, buildAskPrompt } from "@/lib/askSchema";
import { FREE_LOOKUPS_PER_MONTH, countInCurrentMonth } from "@/lib/freeQuota";
import { claimLookupAllowance } from "@/lib/freeQuotaDb";

// FREE draws from the same monthly bucket as reader definitions and concept maps
// rather than a counter of its own. The semantics are honest - all three are "AI
// lookups you have spent" - but they do compete: a student who spends the month's
// allowance looking up words in the reader has none left for questions here. That
// competition is why the allowance is monthly and 60 rather than 20 for life.

export async function POST(request: Request) {
  // Login-gated to block anonymous cost abuse, same as /api/define and /api/ingest.
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "You must be signed in to ask about a concept." }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = askRequestSchema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => issue.message).join("; ");
    return Response.json({ error: message || "Invalid request." }, { status: 400 });
  }

  // Plan and usage read fresh from the DB, never from the JWT or the client.
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      plan: true,
      currentPeriodEnd: true,
      definitionsUsed: true,
      lookupsResetAt: true,
    },
  });

  // A JWT outlives the row it names (src/auth.ts keeps a token valid when the
  // lookup finds nothing), so a token held across account deletion would read as
  // a brand-new FREE user with zero usage and clear the gate below.
  if (!user) {
    return Response.json({ error: "You must be signed in." }, { status: 401 });
  }

  const plan = await resolveEffectivePlan({
    id: session.user.id,
    plan: user.plan,
    currentPeriodEnd: user.currentPeriodEnd,
  });
  const now = new Date();
  const lookupsThisMonth = countInCurrentMonth(
    user.definitionsUsed ?? 0,
    user.lookupsResetAt ?? null,
    now,
    0,
  );

  if (plan !== "PRO" && lookupsThisMonth >= FREE_LOOKUPS_PER_MONTH) {
    return Response.json({ error: "LIMIT_REACHED" }, { status: 403 });
  }

  try {
    const model = getProviderModel("FREE", FREE_MODEL);
    const { text: rawText } = await generateText({
      model,
      prompt: buildAskPrompt(parsed.data),
      // Room for four real sentences plus the JSON envelope. The pinned model is
      // a reasoning model, so groqProviderOptions() is not optional - without it
      // the whole budget goes to a hidden think block and never reaches output.
      maxOutputTokens: 400,
      providerOptions: groqProviderOptions(),
    });

    let rawJson: unknown;
    try {
      rawJson = parseModelJson(rawText);
    } catch (parseError) {
      console.error("Ask JSON parse failed", parseError, "raw text:", rawText);
      return Response.json(
        { error: "The model returned a response we couldn't understand. Please try again." },
        { status: 502 },
      );
    }

    const validated = AskResponseSchema.safeParse(rawJson);
    if (!validated.success) {
      console.error("Ask schema validation failed", validated.error, "raw text:", rawText);
      return Response.json(
        { error: "The model's response didn't match the expected format. Please try again." },
        { status: 502 },
      );
    }

    // Only a successful, validated answer costs a unit - a failed call or a
    // malformed response returns above and costs the student nothing. Atomic and
    // conditional for FREE so two concurrent asks cannot both pass the check
    // above on the same stale count and push the account over its cap.
    if (plan === "PRO") {
      await prisma.user.update({
        where: { id: session.user.id },
        data: { definitionsUsed: { increment: 1 }, lookupsResetAt: now },
      });
    } else if (!(await claimLookupAllowance(session.user.id, now))) {
      return Response.json({ error: "LIMIT_REACHED" }, { status: 403 });
    }

    return Response.json(validated.data);
  } catch (error) {
    console.error("Ask failed", error);
    return Response.json({ error: getFriendlyErrorMessage(error, { provider: "Groq" }) }, { status: 502 });
  }
}
