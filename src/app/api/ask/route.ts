export const maxDuration = 30;

import { generateText } from "ai";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { resolveEffectivePlan } from "@/lib/billing";
import {
  FREE_MODEL,
  GROQ_PROVIDER_OPTIONS,
  getFriendlyErrorMessage,
  getProviderModel,
  parseModelJson,
} from "@/lib/ai";
import { AskResponseSchema, askRequestSchema, buildAskPrompt } from "@/lib/askSchema";

// FREE draws from the same lifetime bucket as reader definitions rather than a
// counter of its own, purely to avoid a schema migration against production for
// a first cut. The semantics are close enough to be honest - both are "AI lookups
// you have spent" - but they do compete: a free student who spent all 20 looking
// up words in the reader has none left for questions here. Splitting them is one
// nullable column with a default and the same atomic-increment logic below.
const FREE_ASK_LIMIT = 20;

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
    select: { plan: true, currentPeriodEnd: true, definitionsUsed: true },
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
  const used = user.definitionsUsed ?? 0;

  if (plan !== "PRO" && used >= FREE_ASK_LIMIT) {
    return Response.json({ error: "LIMIT_REACHED" }, { status: 403 });
  }

  try {
    const model = getProviderModel("FREE", FREE_MODEL);
    const { text: rawText } = await generateText({
      model,
      prompt: buildAskPrompt(parsed.data),
      // Room for four real sentences plus the JSON envelope. The pinned model is
      // a reasoning model, so GROQ_PROVIDER_OPTIONS is not optional - without it
      // the whole budget goes to a hidden think block and never reaches output.
      maxOutputTokens: 400,
      providerOptions: GROQ_PROVIDER_OPTIONS,
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
        data: { definitionsUsed: { increment: 1 } },
      });
    } else {
      const result = await prisma.user.updateMany({
        where: { id: session.user.id, definitionsUsed: { lt: FREE_ASK_LIMIT } },
        data: { definitionsUsed: { increment: 1 } },
      });
      if (result.count === 0) {
        return Response.json({ error: "LIMIT_REACHED" }, { status: 403 });
      }
    }

    return Response.json(validated.data);
  } catch (error) {
    console.error("Ask failed", error);
    return Response.json({ error: getFriendlyErrorMessage(error, { provider: "Groq" }) }, { status: 502 });
  }
}
