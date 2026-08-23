export const maxDuration = 15;

import { generateText } from "ai";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { GROQ_PROVIDER_OPTIONS, getFriendlyErrorMessage, parseModelJson, resolveGradeModel } from "@/lib/ai";
import { parseTimezoneOffsetMinutes, wholeDaysBetween } from "@/lib/localDay";

// This fires automatically during normal study (whenever a typed answer
// isn't an exact match), not on a deliberate action - so it's an abuse
// ceiling, not a plan-gated feature limit like decksGeneratedToday. Applies
// to FREE and PRO alike since grading always uses the same free model
// either way. Kept generous enough that heavy legitimate studying never
// comes close - see the schema comment on User.clozeGradesToday.
const DAILY_GRADE_CAP = 200;

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

// Same daily-rollover shape as /api/study/track's streak logic, plus the
// atomic conditional-increment guard from /api/define (updateMany with a
// `lt` where-clause avoids a race where two near-simultaneous requests both
// read the pre-increment count and both slip through past the cap).
async function isOverDailyCap(userId: string, timezoneOffsetMinutes: number): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { clozeGradesToday: true, lastClozeGradeDate: true },
  });
  if (!user) return true;

  const now = new Date();
  const daysSinceLast = user.lastClozeGradeDate
    ? wholeDaysBetween(user.lastClozeGradeDate, now, timezoneOffsetMinutes)
    : null;
  const isNewDay = daysSinceLast === null || daysSinceLast > 0;

  if (isNewDay) {
    // First grade of a new day - reset unconditionally and let it through.
    await prisma.user.update({
      where: { id: userId },
      data: { clozeGradesToday: 1, lastClozeGradeDate: now },
    });
    return false;
  }

  const result = await prisma.user.updateMany({
    where: { id: userId, clozeGradesToday: { lt: DAILY_GRADE_CAP } },
    data: { clozeGradesToday: { increment: 1 }, lastClozeGradeDate: now },
  });
  return result.count === 0;
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
      providerOptions: GROQ_PROVIDER_OPTIONS,
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
