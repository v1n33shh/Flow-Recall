export const maxDuration = 15;

import { generateText } from "ai";
import { z } from "zod";
import { auth } from "@/auth";
import { groqProviderOptions, getFriendlyErrorMessage, parseModelJson, resolveGradeModel } from "@/lib/ai";
import { parseTimezoneOffsetMinutes } from "@/lib/localDay";
import { isOverDailyCap } from "@/lib/clozeGradeRateLimit";

// Only reached when ClozeChallenge's own normalized string match already
// missed - so this is judging genuine wording/phrasing differences, not
// typos or case. Deliberately lenient on HOW it's said and strict on WHAT is
// said: a differently-worded but factually equivalent answer must pass, a
// confidently-worded but wrong fact must fail. This is the sole source of
// truth for "correct" here - unlike SwipeChallenge's self-graded reveal
// path, nothing downstream lets a button tap override this verdict.
const GradeSchema = z.object({
  correct: z
    .boolean()
    .describe(
      "true if the student's answer conveys the same core fact/mechanism as the reference answer, regardless of wording, phrasing, grammar, or level of detail; false if it names a different or incorrect fact",
    ),
});

const requestSchema = z.object({
  cloze: z.string().trim().min(1).max(500),
  correctAnswer: z.string().trim().min(1).max(200),
  userAnswer: z.string().trim().min(1).max(200),
  // Lets the server compute "today" in the student's own timezone (see
  // /api/study/track). Optional so a cached older client without this field
  // still works - falls back to UTC, same as that route.
  timezoneOffsetMinutes: z.number().optional(),
});

const SYSTEM_PROMPT = [
  "You are grading a fill-in-the-blank recall answer.",
  "Judge ONLY whether the student's answer conveys the same core fact or mechanism as the reference answer.",
  "Ignore differences in wording, phrasing, grammar, verb tense, or level of detail.",
  "A confidently-worded answer that names a different or incorrect fact must be graded false.",
].join(" ");

function buildPrompt(cloze: string, correctAnswer: string, userAnswer: string): string {
  return [
    "Respond with ONLY raw JSON matching exactly this shape - no markdown, no code blocks, no commentary:",
    '{"correct": true or false}',
    "",
    `Fill-in-the-blank sentence: ${cloze}`,
    `Reference answer for the blank: ${correctAnswer}`,
    `Student's typed answer: ${userAnswer}`,
  ].join("\n");
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "You must be signed in to grade answers." }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid grading request." }, { status: 400 });
  }

  const { cloze, correctAnswer, userAnswer, timezoneOffsetMinutes } = parsed.data;

  const rateLimited = await isOverDailyCap(session.user.id, parseTimezoneOffsetMinutes(timezoneOffsetMinutes));
  if (rateLimited) {
    // Every other error path here logs server-side - this one should too, so
    // a legitimate user actually hitting the ceiling (vs. an abuse attempt)
    // leaves a trace instead of silently degrading to the self-report
    // fallback with nothing to notice it by.
    console.warn("Cloze grade daily cap reached", { userId: session.user.id });
    return Response.json({ error: "Daily grading limit reached." }, { status: 429 });
  }

  try {
    const model = resolveGradeModel();
    const { text: rawText } = await generateText({
      model,
      system: SYSTEM_PROMPT,
      prompt: buildPrompt(cloze, correctAnswer, userAnswer),
      providerOptions: groqProviderOptions(),
    });

    let rawJson: unknown;
    try {
      rawJson = parseModelJson(rawText);
    } catch (parseError) {
      console.error("Cloze grade JSON parse failed", parseError, "raw text:", rawText);
      return Response.json({ error: "Could not parse grading response." }, { status: 502 });
    }

    const validated = GradeSchema.safeParse(rawJson);
    if (!validated.success) {
      console.error("Cloze grade schema validation failed", validated.error, "raw text:", rawText);
      return Response.json({ error: "Grading response didn't match the expected format." }, { status: 502 });
    }

    return Response.json(validated.data);
  } catch (error) {
    console.error("Cloze grade failed", error);
    return Response.json({ error: getFriendlyErrorMessage(error) }, { status: 502 });
  }
}
