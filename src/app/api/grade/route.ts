import { generateText } from "ai";
import { z } from "zod";
import { getFriendlyErrorMessage, parseModelJson, resolveGradeModel } from "@/lib/ai";

const GradeSchema = z.object({
  correct: z
    .boolean()
    .describe(
      "true ONLY if the student demonstrates deep, accurate mastery of the concept via the Feynman Technique; false for one-word, vague, shallow, or incomplete explanations that miss key details",
    ),
  feedback: z
    .string()
    .describe(
      "One or two sentences. If correct, briefly affirm what they nailed. If incorrect, name the exact key details or mechanisms they failed to explain.",
    ),
});

const requestSchema = z.object({
  question: z.string().min(1),
  correctAnswer: z.string().min(1),
  userAnswer: z.string().min(1),
});

// The graded card asks students to *teach* the concept back, not just recall a
// fact - so the grader is deliberately demanding. Shallow answers must fail.
const GRADE_SYSTEM_PROMPT = [
  "You are a strict, elite university professor grading a student using the Feynman Technique.",
  "The student must explain the concept deeply and accurately, in their own words.",
  "Do not accept one-word answers, vague hand-waving, or a bare restatement of the question.",
  "If they miss key details, grade it as correct: false and explain exactly what they missed.",
  "If they demonstrate genuine mastery, grade it as true.",
].join(" ");

function buildGradePrompt(question: string, correctAnswer: string, userAnswer: string): string {
  return [
    "Grade the student's explanation against the master explanation.",
    "",
    "Respond with ONLY raw JSON matching exactly this shape - no markdown, no code blocks, no commentary:",
    '{"correct": true or false, "feedback": "1-2 sentences: affirm mastery, or name the exact key details they missed"}',
    "",
    `Concept question: ${question}`,
    `Master explanation (ground truth): ${correctAnswer}`,
    `Student's explanation: ${userAnswer}`,
  ].join("\n");
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = requestSchema.safeParse(body);

  if (!parsed.success) {
    return Response.json({ error: "Invalid grading request." }, { status: 400 });
  }

  const { question, correctAnswer, userAnswer } = parsed.data;

  try {
    const model = resolveGradeModel();
    const { text: rawText } = await generateText({
      model,
      system: GRADE_SYSTEM_PROMPT,
      prompt: buildGradePrompt(question, correctAnswer, userAnswer),
    });

    let rawJson: unknown;
    try {
      rawJson = parseModelJson(rawText);
    } catch (parseError) {
      console.error("Grade JSON parse failed", parseError, "raw text:", rawText);
      return Response.json(
        { error: "The model returned a response we couldn't understand. Please try again." },
        { status: 502 },
      );
    }

    const validated = GradeSchema.safeParse(rawJson);
    if (!validated.success) {
      console.error("Grade schema validation failed", validated.error, "raw text:", rawText);
      return Response.json(
        { error: "The model's response didn't match the expected format. Please try again." },
        { status: 502 },
      );
    }

    return Response.json(validated.data);
  } catch (error) {
    console.error("Grade failed", error);
    return Response.json({ error: getFriendlyErrorMessage(error) }, { status: 502 });
  }
}
