export const maxDuration = 60;

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
import {
  ConceptMapResponseSchema,
  buildConceptMapPrompt,
  conceptMapRequestSchema,
} from "@/lib/conceptGraphSchema";

/** How a deck's ideas relate, in one pass over the finished deck.
 *
 * Deliberately not part of ingest. Ingest is handed 1500 characters at a time and
 * emits at most 3 cards per call, so it never has two chunks in front of it and
 * structurally cannot see that a concept from chunk 1 explains one from chunk 7.
 * It would also leave every deck the student already owns unmapped forever. One
 * pass over a deck that already exists fixes both.
 *
 * Structurally a copy of /api/ask - same auth gate, same fresh-from-the-DB plan
 * read, same atomic conditional increment - because that route is the proven shape
 * for "one Groq call against the student's own material" and a second shape here
 * would be a second thing to get wrong. */

// The whole mapping costs one lookup, not one per pass. A 120-concept deck takes
// four batches, and charging four would punish the student for owning a big deck.
// Same reasoning /api/ingest applies per deck rather than per chunk - and the same
// tradeoff: a client that always sent `first: false` would map for free. Worth it
// for a route that cannot create a deck, only annotate one the account already has.
const FREE_MAP_LIMIT = 20;

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "You must be signed in to map a deck." }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = conceptMapRequestSchema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => issue.message).join("; ");
    return Response.json({ error: message || "Invalid request." }, { status: 400 });
  }

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
  const charge = parsed.data.first;
  const used = user.definitionsUsed ?? 0;

  if (charge && plan !== "PRO" && used >= FREE_MAP_LIMIT) {
    return Response.json({ error: "LIMIT_REACHED" }, { status: 403 });
  }

  try {
    const model = getProviderModel("FREE", FREE_MODEL);
    const { text: rawText } = await generateText({
      model,
      prompt: buildConceptMapPrompt(parsed.data),
      // Room for a batch's worth of edges plus the JSON envelope. The pinned model
      // is a reasoning model, so GROQ_PROVIDER_OPTIONS is not optional - without it
      // the whole budget goes to a hidden think block and never reaches output.
      maxOutputTokens: 2000,
      providerOptions: GROQ_PROVIDER_OPTIONS,
    });

    let rawJson: unknown;
    try {
      rawJson = parseModelJson(rawText);
    } catch (parseError) {
      console.error("Concept map JSON parse failed", parseError, "raw text:", rawText);
      return Response.json(
        { error: "The model returned a response we couldn't understand. Please try again." },
        { status: 502 },
      );
    }

    const validated = ConceptMapResponseSchema.safeParse(rawJson);
    if (!validated.success) {
      console.error("Concept map schema validation failed", validated.error, "raw text:", rawText);
      return Response.json(
        { error: "The model's response didn't match the expected format. Please try again." },
        { status: 502 },
      );
    }

    // Only a successful, validated pass costs a unit - a failed call or a malformed
    // response returns above and costs the student nothing. Atomic and conditional
    // for FREE so two concurrent maps cannot both pass the check above on the same
    // stale count and push the account over its cap.
    if (charge) {
      if (plan === "PRO") {
        await prisma.user.update({
          where: { id: session.user.id },
          data: { definitionsUsed: { increment: 1 } },
        });
      } else {
        const result = await prisma.user.updateMany({
          where: { id: session.user.id, definitionsUsed: { lt: FREE_MAP_LIMIT } },
          data: { definitionsUsed: { increment: 1 } },
        });
        if (result.count === 0) {
          return Response.json({ error: "LIMIT_REACHED" }, { status: 403 });
        }
      }
    }

    return Response.json(validated.data);
  } catch (error) {
    console.error("Concept map failed", error);
    return Response.json({ error: getFriendlyErrorMessage(error, { provider: "Groq" }) }, { status: 502 });
  }
}
