export const maxDuration = 60;

import { generateText } from "ai";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { resolveEffectivePlan } from "@/lib/billing";
import { groqModel, groqProviderOptions, getFriendlyErrorMessage, parseModelJson } from "@/lib/ai";
import { ConceptsResponseSchema } from "@/lib/conceptSchema";
import { applyQualityGate } from "@/lib/conceptQuality";
import { generationLimitForPlan } from "@/lib/freeQuota";
import { claimGenerationRequest } from "@/lib/freeQuotaDb";
import { parseTimezoneOffsetMinutes } from "@/lib/localDay";

// "Infinite Recall Mode": a PRO-only endpoint that generates brand-new,
// deep-dive flashcards from the concepts a user has already studied - so they
// master the underlying material instead of memorizing a fixed card set.
//
// NOTE ON PERSISTENCE: this app stores decks/concepts/source-text entirely in
// the browser's localStorage (see src/lib/storage.ts) - there is no Deck or
// Concept table in the database. So the "source material" is sent up from the
// client (which owns it) rather than pulled from a DB, and the generated cards
// are persisted client-side by the caller (addConceptsToDeck), not here. The
// [id] segment is the client-side deck id, used only to scope the request.

// How many fresh cards each shuffle produces.
const NEW_CARDS = 5;
// Cap how many existing concepts we feed the model, to keep the prompt within a
// sane size on very large decks. The newest/most-recent context is plenty for
// "generate new angles".
const MAX_SEED_CONCEPTS = 60;

// The client sends a distilled view of the concepts already in the deck: enough
// for the model to understand the material and to avoid repeating questions.
const seedConceptSchema = z.object({
  concept: z.string().min(1),
  question: z.string().min(1),
  answer: z.string().optional(),
  explanation: z.string().optional(),
});

const requestSchema = z.object({
  concepts: z.array(seedConceptSchema).min(1),
  // Which calendar month the generation allowance is counted in belongs to the
  // student, not to the server process (always UTC on Vercel). Same convention as
  // /api/ingest: the client sends getTimezoneOffset(). Optional, and a missing value
  // degrades to a UTC month rather than a crash - see parseTimezoneOffsetMinutes.
  timezoneOffsetMinutes: z.number().optional(),
});

type SeedConcept = z.infer<typeof seedConceptSchema>;

export function buildShufflePrompt(seed: SeedConcept[], count: number): string {
  const material = seed
    .map((c, i) => {
      const answer = c.answer ? ` (answer: ${c.answer})` : "";
      const explanation = c.explanation ? ` — ${c.explanation}` : "";
      return `${i + 1}. ${c.concept}${answer}${explanation}`;
    })
    .join("\n");

  const existingQuestions = seed.map((c) => `- ${c.question}`).join("\n");

  return [
    "You are a strict, demanding college professor writing an exam meant to",
    "separate students who have TRULY mastered the material from those who merely",
    `memorized the flashcards. Generate exactly ${count} BRAND-NEW active-recall`,
    "flashcards that probe the SAME underlying material from fresh angles.",
    "",
    "CORE GOAL - new angles, not new facts:",
    "- Do NOT repeat, lightly reword, or trivially invert any existing question.",
    "- Attack the same concepts from a different direction: applying them to a new",
    "  scenario, connecting two concepts, probing a consequence or edge case, or",
    "  contrasting a concept with a common misconception.",
    "- Every question must test deep 'why'/'how' reasoning, never a 'what' lookup.",
    "",
    "DISTRACTORS - the wrong answer must be dangerously convincing:",
    "- Each distractor must target a COMMON MISCONCEPTION a real student would hold,",
    "  matching the real answer in length, tone, and specificity.",
    "",
    "DEEP-DIVE EXPLANATION - generate this for EVERY card:",
    "- 'explanation' must be a rich 3-4 sentence paragraph that deeply explains the",
    "  concept, its mechanisms, and why it matters (NOT a short phrase).",
    "",
    "THREE MORE FIELDS, each ONE sentence:",
    "- 'misconception': name the wrong belief your 'distractor' encodes and why a real",
    "  student would hold it. Shown to a student who got the card wrong, so it must",
    "  explain the error rather than restate the right answer.",
    "- 'whyItMatters': what knowing this lets someone do, predict or avoid.",
    "- 'sourceQuote': omit this field entirely. These cards are generated from concepts,",
    "  not from source text, so there is no sentence you could quote without inventing one.",
    "",
    "HARD CONSTRAINTS (do NOT break these - they keep the cards usable and parseable):",
    "- 'answer' must be a concise phrase (ideally under 6 words) that fills the cloze",
    "  blank verbatim and can be graded objectively.",
    "- 'cloze' must be a single declarative sentence containing exactly '_____' where",
    "  the answer phrase goes; the blank must be fillable with 'answer' verbatim.",
    "  Perform the substitution in your head before emitting the card and reject it if",
    "  the result repeats itself - e.g. cloze 'Stretching sarcomeres improves _____'",
    "  with answer 'improved actin-myosin overlap' gives 'improves improved actin-myosin",
    "  overlap'. The answer is only the missing phrase, never a restatement of the fact.",
    "- 'distractor' must be short and the same style/length as 'answer'.",
    "",
    "Respond with ONLY raw JSON matching exactly this shape - no markdown, no code blocks, no commentary:",
    '{"concepts":[{"concept":"short 2-6 word label","question":"a focused recall question","answer":"the concise correct answer, ideally under 6 words","distractor":"a plausible but INCORRECT answer, similar length and style to the real answer","cloze":"a declarative sentence stating the fact, with the answer phrase replaced by exactly \'_____\'","explanation":"a rich 3-4 sentence paragraph deeply explaining the concept, its mechanisms, and why it matters","misconception":"one sentence naming the wrong belief the distractor encodes","whyItMatters":"one sentence on what this lets you do or predict"}]}',
    "",
    "MATERIAL ALREADY COVERED (generate new angles on these concepts):",
    material,
    "",
    "EXISTING QUESTIONS you must NOT repeat or lightly reword:",
    existingQuestions,
  ].join("\n");
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  // Next 16: dynamic route params are async and must be awaited. Kept for
  // request scoping/logging - there is no DB deck row to look up (see note above).
  const { id: deckId } = await params;

  // Gated behind login - no anonymous access to the AI engine.
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json(
      { error: "You must be signed in to use Infinite Recall." },
      { status: 401 },
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => issue.message).join("; ");
    return Response.json({ error: message || "Invalid request." }, { status: 400 });
  }

  // Read the plan fresh from the DB - never trust a plan claim from the client,
  // and don't rely on the (possibly stale) JWT. This is the authoritative Pro
  // gate; the UI's disabled/upsell state is merely cosmetic.
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { plan: true, currentPeriodEnd: true },
  });
  const plan = await resolveEffectivePlan(
    user ? { id: session.user.id, plan: user.plan, currentPeriodEnd: user.currentPeriodEnd } : null,
  );
  if (plan !== "PRO") {
    return Response.json(
      { error: "Infinite Recall Mode is a Pro feature." },
      { status: 403 },
    );
  }

  // Fair-use ceiling, claimed before the model call. This route was metered by
  // nothing at all, and at maxOutputTokens 5200 it is the largest single response the
  // app asks for - so an unlimited tap was the most expensive uncapped path in the
  // product. PRO-gated is not the same as bounded. See freeQuota.ts.
  const now = new Date();
  const timezoneOffsetMinutes = parseTimezoneOffsetMinutes(parsed.data.timezoneOffsetMinutes);
  const generationLimit = generationLimitForPlan(plan);
  if (!(await claimGenerationRequest(session.user.id, now, timezoneOffsetMinutes, generationLimit))) {
    return Response.json(
      {
        error: `You've generated ${generationLimit} sections this month, which is our fair-use ceiling. It resets at the start of next month - reply to your receipt if you need it raised.`,
        code: "GENERATION_BUDGET_REACHED",
      },
      { status: 403 },
    );
  }

  // Trim to the most recent concepts so a huge deck can't blow the prompt budget.
  const seed = parsed.data.concepts.slice(-MAX_SEED_CONCEPTS);

  try {
    // groqModel() rather than a local client, so this route cannot drift from the
    // other three Groq call sites. It resolves to FREE_MODEL, which is the free model
    // the spec pins Infinite Recall to.
    const model = groqModel();
    const { text: rawText, usage } = await generateText({
      model,
      prompt: buildShufflePrompt(seed, NEW_CARDS),
      // Raised with the two new one-sentence fields. Five cards each carrying a
      // full explanation was already the largest response any route asks for, and
      // a truncation here is a dead batch rather than a degraded card.
      maxOutputTokens: 5200,
      providerOptions: groqProviderOptions(),
    });

    // The most expensive single call in the app - see maxOutputTokens above. Logged
    // for the same reason /api/ingest logs its usage: so the bill is visible weekly
    // rather than monthly.
    console.log("Shuffle usage", {
      deckId,
      seedConcepts: seed.length,
      inputTokens: usage?.inputTokens ?? null,
      outputTokens: usage?.outputTokens ?? null,
    });

    let rawJson: unknown;
    try {
      rawJson = parseModelJson(rawText);
    } catch (parseError) {
      console.error("Shuffle JSON parse failed", parseError, "raw text:", rawText);
      return Response.json(
        { error: "The model returned a response we couldn't understand. Please try again." },
        { status: 502 },
      );
    }

    const validated = ConceptsResponseSchema.safeParse(rawJson);
    if (!validated.success) {
      console.error("Shuffle schema validation failed", validated.error, "raw text:", rawText);
      return Response.json(
        { error: "The model's response didn't match the expected format. Please try again." },
        { status: 502 },
      );
    }

    // Deck id is intentionally not persisted server-side (no deck table); the
    // client appends these to its localStorage deck via addConceptsToDeck.
    void deckId;

    // Same gate ingest applies - a shuffled card is graded exactly like a
    // generated one, so a cloze the answer cannot fill is just as wrong here.
    const gated = applyQualityGate(validated.data.concepts);
    if (gated.report.clozeCleared > 0 || gated.report.dropped > 0) {
      console.warn("Shuffle quality gate", gated.report);
    }
    if (gated.concepts.length === 0) {
      return Response.json(
        { error: "The new cards didn't pass our quality checks. Please try again." },
        { status: 502 },
      );
    }

    const concepts = gated.concepts.map((concept) => ({
      id: crypto.randomUUID(),
      ...concept,
    }));

    return Response.json({ concepts });
  } catch (error) {
    console.error("Shuffle failed", error);
    return Response.json(
      { error: getFriendlyErrorMessage(error, { provider: "Groq" }) },
      { status: 502 },
    );
  }
}
