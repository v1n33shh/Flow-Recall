import { createGroq } from "@ai-sdk/groq";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { APICallError, type LanguageModel } from "ai";

// The Groq model FREE plans are pinned to: Groq's current smartest free model,
// the versatile 70B. NOTE: llama-3.1-70b-versatile is DECOMMISSIONED on Groq
// (the API hard-rejects it); llama-3.3-70b-versatile is its live replacement.
export const FREE_MODEL = "llama-3.3-70b-versatile";

// The models a Pro plan can request, keyed by the exact id the client sends
// in the dropdown. Anything not in here is treated as "not a Pro model".
export const PRO_MODELS = {
  "gpt-4o": "openai",
  "claude-3-5-sonnet-20240620": "anthropic",
} as const;

export type RequestedModel = typeof FREE_MODEL | keyof typeof PRO_MODELS;

/** True for the paid models that require a PRO plan (gpt-4o, Claude 3.5 Sonnet). */
export function isProModel(requestedModel: string): boolean {
  return requestedModel in PRO_MODELS;
}

/** Human-readable provider name for a given plan+model, for error messages. */
export function providerLabel(plan: string, requestedModel: string): string {
  if (plan === "PRO" && requestedModel === "gpt-4o") return "OpenAI";
  if (plan === "PRO" && requestedModel === "claude-3-5-sonnet-20240620") return "Anthropic";
  return "Groq";
}

/**
 * Routes a generation request to the right provider based on the user's plan.
 * All provider keys (Groq/OpenAI/Anthropic) live in server-side env vars and
 * are never passed from the client. FREE plans are always pinned to Groq
 * regardless of the requested model, so the paid providers are only ever
 * reachable on a PRO plan.
 */
export function getProviderModel(plan: string, requestedModel: string): LanguageModel {
  if (plan !== "PRO") {
    return createGroq({ apiKey: process.env.GROQ_API_KEY })(FREE_MODEL);
  }

  switch (requestedModel) {
    case "gpt-4o":
      return createOpenAI({ apiKey: process.env.OPENAI_API_KEY })("gpt-4o");
    case "claude-3-5-sonnet-20240620":
      return createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY })(
        "claude-3-5-sonnet-20240620",
      );
    default:
      // A PRO user who left the free model selected (or sent an unknown id)
      // still gets a working model rather than a hard error.
      return createGroq({ apiKey: process.env.GROQ_API_KEY })(FREE_MODEL);
  }
}

export function resolveGradeModel(): LanguageModel {
  return createGroq({ apiKey: process.env.GROQ_API_KEY })("llama-3.3-70b-versatile");
}

type FriendlyErrorOptions = {
  /** Provider name shown to the user, e.g. "Groq", "OpenAI", "Anthropic". */
  provider?: string;
};

/** Turns a raw provider error into something a non-technical user can act on. */
export function getFriendlyErrorMessage(error: unknown, options: FriendlyErrorOptions = {}): string {
  const { provider = "Groq" } = options;
  const statusCode = APICallError.isInstance(error) ? error.statusCode : undefined;
  const rawMessage = error instanceof Error ? error.message : String(error);
  const lower = rawMessage.toLowerCase();

  const isInvalidKey =
    statusCode === 401 ||
    lower.includes("invalid api key") ||
    lower.includes("incorrect api key");
  const isDenied = statusCode === 403 || lower.includes("denied") || lower.includes("permission");

  // All keys are server-managed now - a bad or denied key is an operations
  // problem the user can't fix, so we never point them at any settings.
  if (isInvalidKey || isDenied) {
    return `The ${provider} service is temporarily unavailable. Please try again later.`;
  }

  const isRateLimited = statusCode === 429 || lower.includes("quota") || lower.includes("rate limit");
  if (isRateLimited) {
    return `You've hit ${provider}'s rate limit. Wait exactly 60 seconds and try again.`;
  }

  return rawMessage || `Something went wrong talking to ${provider}.`;
}

/**
 * Some Groq models reject `generateObject`'s structured-output mode
 * ("This model does not support response format json_schema"), so routes
 * use plain `generateText` plus a prompt instructing raw JSON, and parse the
 * result manually. Models don't always obey "no markdown" - this strips a
 * ```json fenced block if present, then falls back to grabbing the first
 * balanced-looking {...} or [...] span in case there's chatty pre/postamble.
 */
export function parseModelJson(rawText: string): unknown {
  const trimmed = rawText.trim();

  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  let unfenced = fenceMatch ? fenceMatch[1].trim() : trimmed;

  // AI models sometimes accidentally leave trailing commas which breaks JSON.parse
  unfenced = unfenced.replace(/,\s*([}\]])/g, "$1");

  try {
    return JSON.parse(unfenced);
  } catch {
    const braceMatch = unfenced.match(/[{[][\s\S]*[}\]]/);
    if (!braceMatch) {
      throw new Error("No JSON object found in the model's response.");
    }
    return JSON.parse(braceMatch[0]);
  }
}
