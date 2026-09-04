export const maxDuration = 30;

import { generateText } from "ai";
import { auth } from "@/auth";
import {
  FREE_MODEL,
  groqProviderOptions,
  getFriendlyErrorMessage,
  getProviderModel,
  parseModelJson,
} from "@/lib/ai";
import { isOverDailyCap } from "@/lib/clozeGradeRateLimit";
import { parseTimezoneOffsetMinutes } from "@/lib/localDay";
import {
  TeachBackResponseSchema,
  buildTeachBackPrompt,
  teachBackRequestSchema,
} from "@/lib/teachBackSchema";

/** The one place in the app where a student PRODUCES understanding and has it
 * corrected, rather than recognising an answer someone else wrote.
 *
 * Structurally /api/ask - same auth gate, same lenient parse, same validate-then-
 * return - with one deliberate difference: the limit.
 *
 * /api/ask and /api/concept-map both spend from `definitionsUsed`, the FREE bucket
 * of FREE_LOOKUPS_PER_MONTH (60 a month, and 20 for life before that). This route
 * uses `isOverDailyCap` instead, the same abuse ceiling /api/cloze-grade uses (200 a
 * day, FREE and PRO alike). Drawing on a monthly allowance shared with reader
 * definitions and concept mapping would make this feature useless at exactly the
 * moment it is worth something: a student working through a hard chapter explains
 * ten concepts back in one sitting, and telling them that cost them a sixth of the
 * month's lookups teaches them to stop.
 *
 * The cost of that choice, stated plainly because it is real: this shares one
 * counter with cloze grading, so a student who spends 150 of their day here has 50
 * grades left for study before typed answers fall back to self-report. At a 200
 * ceiling nobody studying honestly comes close, and splitting them is one nullable
 * column on the day that stops being true. */

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json(
      { error: "You must be signed in to explain a concept back." },
      { status: 401 },
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = teachBackRequestSchema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => issue.message).join("; ");
    return Response.json({ error: message || "Invalid request." }, { status: 400 });
  }

  // Fails closed when the row is gone, which is what a JWT outliving its account
  // produces - see the same note in /api/ask.
  const rateLimited = await isOverDailyCap(
    session.user.id,
    parseTimezoneOffsetMinutes(parsed.data.timezoneOffsetMinutes),
  );
  if (rateLimited) {
    console.warn("Teach-back daily cap reached", { userId: session.user.id });
    return Response.json(
      { error: "You've hit today's limit for this. It resets tomorrow." },
      { status: 429 },
    );
  }

  try {
    const model = getProviderModel("FREE", FREE_MODEL);
    const { text: rawText } = await generateText({
      model,
      prompt: buildTeachBackPrompt(parsed.data),
      // Three lists of up to six short sentences, plus the JSON envelope. The pinned
      // model is a reasoning model, so groqProviderOptions() is not optional -
      // without it the whole budget goes to a hidden think block and never reaches
      // output.
      maxOutputTokens: 1200,
      providerOptions: groqProviderOptions(),
    });

    let rawJson: unknown;
    try {
      rawJson = parseModelJson(rawText);
    } catch (parseError) {
      console.error("Teach-back JSON parse failed", parseError, "raw text:", rawText);
      return Response.json(
        { error: "The model returned a response we couldn't understand. Please try again." },
        { status: 502 },
      );
    }

    const validated = TeachBackResponseSchema.safeParse(rawJson);
    if (!validated.success) {
      console.error("Teach-back schema validation failed", validated.error, "raw text:", rawText);
      return Response.json(
        { error: "The model's response didn't match the expected format. Please try again." },
        { status: 502 },
      );
    }

    // Every list defaults to empty so one missing key costs that key rather than the
    // whole debrief - which means an empty object parses clean and would render as a
    // confident "nothing to say about your explanation". That is not a verdict, it is
    // a model that did not answer, and it has to read as the failure it is.
    const { correct, missing, wrong } = validated.data;
    if (correct.length + missing.length + wrong.length === 0) {
      console.error("Teach-back returned three empty lists", "raw text:", rawText);
      return Response.json(
        { error: "We couldn't read your explanation this time. Please try again." },
        { status: 502 },
      );
    }

    return Response.json(validated.data);
  } catch (error) {
    console.error("Teach-back failed", error);
    return Response.json(
      { error: getFriendlyErrorMessage(error, { provider: "Groq" }) },
      { status: 502 },
    );
  }
}
