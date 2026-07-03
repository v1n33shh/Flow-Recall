import { generateText } from "ai";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
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
    .enum([FREE_MODEL, "gpt-4o", "claude-3-5-sonnet-20240620"])
    .default(FREE_MODEL),
  // A single deck generation is sent as up to MAX_CHUNKS sequential requests.
  // The daily FREE quota is per *deck*, so only the first chunk of a deck
  // enforces and increments the limit; continuation chunks (false) pass
  // through. Defaults true so a plain single-chunk request always counts.
  isFirstChunk: z.boolean().default(true),
});

function buildConceptsPrompt(text: string): string {
  return [
    "You are a strict, demanding college professor writing an exam meant to",
    "separate students who have truly mastered the material from those who merely",
    "memorized it. Turn the following study material into challenging",
    "active-recall flashcards.",
    "",
    "DIFFICULTY - every question must be genuinely hard:",
    "- Write thought-provoking questions that test deep understanding, not recall.",
    "- Avoid basic 'what'/'who'/'when' fact lookups. Favor 'why' and 'how':",
    "  reasoning, cause and effect, implications, and applying a concept to a new",
    "  situation.",
    "- Probe nuanced distinctions between closely related ideas, edge cases, and",
    "  consequences - the things students most often get wrong.",
    "",
    "DISTRACTORS - the wrong answer must be dangerously convincing:",
    "- Each distractor must be extremely plausible and target a COMMON MISCONCEPTION",
    "  a real student would hold - a subtle near-miss, never something obviously wrong.",
    "- It must match the real answer in length, tone, and specificity so it cannot",
    "  be eliminated by style alone.",
    "",
    "SYNTHESIS - test themes, not trivia:",
    "- Synthesize and connect information ACROSS multiple sentences to test the core",
    "  themes, relationships, and arguments in the material.",
    "- Do not just extract an isolated fact from a single sentence.",
    "",
    "DEEP-DIVE EXPLANATION - generate this for EVERY concept:",
    "- 'explanation' must be a rich, full paragraph (3-4 sentences) that deeply",
    "  explains the concept, the mechanisms behind it, and why it matters. This is",
    "  the deep-dive reading a student studies after answering - NOT a short phrase.",
    "- 'answer' and 'explanation' are different by design: 'answer' stays a 2-6 word",
    "  phrase for the Swipe card, while 'explanation' is the full-paragraph summary.",
    "",
    "HARD CONSTRAINTS (do NOT break these - they keep the cards usable and parseable):",
    "- However hard the question, 'answer' must stay a concise phrase (ideally under",
    "  6 words) that fills the cloze blank verbatim and can be graded objectively.",
    "- 'cloze' must be a single declarative sentence containing exactly '_____' where",
    "  the answer phrase goes; the blank must be fillable with 'answer' verbatim.",
    "- 'distractor' must be short and the same style/length as 'answer'.",
    "- 'explanation' must be a full 3-4 sentence paragraph, never a short phrase.",
    "",
    "Respond with ONLY raw JSON matching exactly this shape - no markdown, no code blocks, no commentary:",
    '{"concepts":[{"concept":"short 2-6 word label","question":"a focused recall question","answer":"the concise correct answer, ideally under 6 words","distractor":"a plausible but INCORRECT answer, similar length and style to the real answer","cloze":"a declarative sentence stating the fact, with the answer phrase replaced by exactly \'_____\'","explanation":"a rich 3-4 sentence paragraph deeply explaining the concept, its mechanisms, and why it matters"}]}',
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
      decksGeneratedToday: true,
      lastDeckGeneratedDate: true,
    },
  });
  const plan = user?.plan ?? "FREE";

  // Server-side mirror of the UI's Pro gate. The UI disables the button, but
  // that's cosmetic - this is the check that actually enforces it.
  if (plan !== "PRO" && isProModel(requestedModel)) {
    return Response.json(
      { error: "You need a Pro subscription to use this model." },
      { status: 403 },
    );
  }

  // Roll the daily counter over: if the last generation was on an earlier
  // calendar day (or never), today's count is effectively 0. Compare local
  // Y/M/D rather than a 24h delta so "per day" means the calendar day.
  const now = new Date();
  const lastGenerated = user?.lastDeckGeneratedDate ?? null;
  const generatedToday =
    lastGenerated !== null &&
    lastGenerated.getFullYear() === now.getFullYear() &&
    lastGenerated.getMonth() === now.getMonth() &&
    lastGenerated.getDate() === now.getDate()
      ? user?.decksGeneratedToday ?? 0
      : 0;

  // Paywall: FREE plans get 1 deck per calendar day. Only the first chunk of
  // a deck is gated so a multi-chunk deck isn't blocked partway through. This
  // is the authoritative enforcement point - the client just renders the upsell.
  if (plan !== "PRO" && isFirstChunk && generatedToday >= 1) {
    return Response.json({ error: "FREE_LIMIT_REACHED" }, { status: 403 });
  }

  try {
    const model = getProviderModel(plan, requestedModel);
    // maxOutputTokens (AI SDK v7's name; `maxTokens` was the v4 name and no
    // longer type-checks) gives large chunks headroom to finish their JSON.
    const { text: rawText } = await generateText({
      model,
      prompt: buildConceptsPrompt(text),
      maxOutputTokens: 4096,
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

    // Record this deck against the daily quota - only on the first chunk, so
    // a multi-chunk deck counts once. Write the rolled-over count
    // (generatedToday + 1) rather than a raw DB increment so a stale count
    // from a previous day resets to 1 instead of climbing.
    if (isFirstChunk) {
      await prisma.user.update({
        where: { id: session.user.id },
        data: {
          decksGeneratedToday: generatedToday + 1,
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
