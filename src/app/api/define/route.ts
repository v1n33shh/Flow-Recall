export const maxDuration = 30;

import { generateText } from "ai";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { resolveEffectivePlan } from "@/lib/billing";
import { FREE_MODEL, groqProviderOptions, getFriendlyErrorMessage, getProviderModel, parseModelJson } from "@/lib/ai";
import { DefinitionResponseSchema } from "@/lib/definitionSchema";
import { FREE_LOOKUPS_PER_MONTH, countInCurrentMonth } from "@/lib/freeQuota";
import { claimLookupAllowance } from "@/lib/freeQuotaDb";

// The FREE allowance for this route lives in freeQuota.ts, shared with /api/ask
// and /api/concept-map because all three spend the one `definitionsUsed` counter.
// Formerly a local "20 for life" constant, matching /api/ingest's old lifetime cap
// pivot rather than a daily reset - simpler to reason about and simpler to
// enforce (no day-rollover logic needed, just a running counter).

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
  // gets FREE_LOOKUPS_PER_MONTH lookups a month; PRO is unlimited and never
  // hits this branch.
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      plan: true,
      currentPeriodEnd: true,
      definitionsUsed: true,
      lookupsResetAt: true,
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
  const now = new Date();
  // A count stamped in an earlier month is spent-and-expired. The lookup month is
  // UTC for all three routes that share this counter - see claimLookupAllowance.
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
      prompt: buildDefinePrompt(phrase, context),
      maxOutputTokens: 300,
      providerOptions: groqProviderOptions(),
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
    //
    // PRO has no cap, so its increment stays unconditional and exists only as a
    // usage metric. FREE goes through the atomic claim, which is what stops two
    // concurrent requests from both reading a pre-increment count and both passing
    // the check above.
    if (plan === "PRO") {
      await prisma.user.update({
        where: { id: session.user.id },
        data: { definitionsUsed: { increment: 1 }, lookupsResetAt: now },
      });
    } else if (!(await claimLookupAllowance(session.user.id, now))) {
      // Lost a race for the last free slot - the lookup already happened and cost
      // real money, but a FREE account must never end up over cap.
      return Response.json({ error: "LIMIT_REACHED" }, { status: 403 });
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
