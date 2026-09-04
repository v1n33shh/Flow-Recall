import { createGroq } from "@ai-sdk/groq";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { APICallError, RetryError, type LanguageModel } from "ai";

// The Groq model FREE plans are pinned to: Groq's current smartest free model.
// NOTE: llama-3.1-70b-versatile was DECOMMISSIONED on Groq, replaced by
// llama-3.3-70b-versatile - which Groq itself then deprecated on 2026-08-16
// (see console.groq.com/docs/deprecations), hard-rejecting every request with
// "does not exist or you do not have access to it". Both of Groq's suggested
// migration targets (openai/gpt-oss-120b, and this one) are "reasoning"
// models that - confirmed by directly hitting Groq's API - emit a hidden
// <think>...</think> block by default regardless of what the docs imply
// about a non-thinking default. See GROQ_PROVIDER_OPTIONS below for how
// that's suppressed; without it, every route using this model would burn
// its whole maxOutputTokens budget on reasoning and never reach real output.
export const FREE_MODEL = "qwen/qwen3.6-27b";

// Forces Groq's reasoning models (see FREE_MODEL above) to skip their hidden
// <think> chain-of-thought and go straight to the final answer - required
// for every plain generateText call this app makes, since none of them parse
// or budget for reasoning tokens. Safe to pass even when the resolved model
// turns out to be OpenAI/Anthropic-via-AICredits: the AI SDK only applies a
// providerOptions entry under the matching provider's own key, so a `groq`
// entry is silently ignored by any other provider.
export const GROQ_PROVIDER_OPTIONS = { groq: { reasoningEffort: "none" as const } };

// The models a Pro plan can request, keyed by the exact id the client sends
// in the dropdown. Anything not in here is treated as "not a Pro model".
export const PRO_MODELS = {
  "gpt-4o": "openai",
  "claude-haiku-latest": "anthropic",
} as const;

export type RequestedModel = typeof FREE_MODEL | keyof typeof PRO_MODELS;

/** True for the paid models that require a PRO plan (gpt-4o, Claude 3.5 Sonnet). */
export function isProModel(requestedModel: string): boolean {
  return requestedModel in PRO_MODELS;
}

/** Human-readable provider name for a given plan+model, for error messages. */
export function providerLabel(plan: string, requestedModel: string): string {
  if (plan === "PRO" && requestedModel === "gpt-4o") return "OpenAI";
  if (plan === "PRO" && requestedModel === "claude-haiku-latest") return "Anthropic";
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
    case "claude-haiku-latest": {
      // Routed through AICredits API Gateway (OpenAI-compatible) because Anthropic
      // strictly blocks Indian Debit Cards. Haiku is 5x faster than Sonnet.
      // .chat() forces /v1/chat/completions instead of the newer /v1/responses
      // endpoint that AICredits does not support.
      const aiCredits = createOpenAI({ 
        baseURL: "https://api.aicredits.in/v1",
        apiKey: process.env.ANTHROPIC_API_KEY,
      });
      return aiCredits.chat("anthropic/claude-haiku-latest");
    }
    default:
      // A PRO user who left the free model selected (or sent an unknown id)
      // still gets a working model rather than a hard error.
      return createGroq({ apiKey: process.env.GROQ_API_KEY })(FREE_MODEL);
  }
}

export function resolveGradeModel(): LanguageModel {
  return createGroq({ apiKey: process.env.GROQ_API_KEY })(FREE_MODEL);
}

/** A provider's rate-limit answer, and how long it asked us to wait - `null`
 * seconds where it did not say. Returns `null` for anything that is not a rate
 * limit at all.
 *
 * Read by /api/ingest so a 429 can be passed through to the client as a 429
 * rather than flattened into the same 502 every other provider failure gets. A
 * book-length ingest is 20 sequential requests against a per-minute limit, and
 * the client can only retry the one chunk that tripped it - instead of losing the
 * rest of the deck - if it can tell a rate limit apart from a broken response. */
export function readRateLimit(error: unknown): { retryAfterSeconds: number | null } | null {
  // What generateText throws after exhausting its OWN retries is a RetryError
  // wrapping the real one, and `APICallError.isInstance` on that is false - so
  // the status code and every rate-limit header are one level down. Missing this
  // is how a 429 reached the client as an untyped 502 from a phone: the message
  // read "Failed after 3 attempts. Last error: AI_APICallError: ...".
  const apiError = APICallError.isInstance(error)
    ? error
    : RetryError.isInstance(error) && APICallError.isInstance(error.lastError)
      ? error.lastError
      : null;

  const statusCode = apiError?.statusCode;
  const rawMessage = error instanceof Error ? error.message : String(error);
  const lower = rawMessage.toLowerCase();

  // Groq has two phrasings for the same OTPM ceiling and only one of them says
  // "rate limit": a spent window gives "Rate limit reached ... on output tokens
  // per minute (OTPM)", while a single oversized request gives "Request too large
  // ... on output tokens per minute (OTPM)". Both are 429s, and both are waits.
  const isRateLimited =
    statusCode === 429 ||
    lower.includes("rate limit") ||
    lower.includes("quota") ||
    lower.includes("too many requests") ||
    lower.includes("tokens per minute") ||
    lower.includes("requests per minute");
  if (!isRateLimited) return null;

  return { retryAfterSeconds: retryAfterSeconds(apiError?.responseHeaders) };
}

/** Seconds from a `retry-after` (seconds, or an HTTP date) or `retry-after-ms`
 * header. Capped at two minutes: a provider asking for longer than that is
 * asking for longer than anyone will hold a phone still for, and the client's own
 * ceiling should decide from there. */
function retryAfterSeconds(headers: Record<string, string> | undefined): number | null {
  if (!headers) return null;
  const cap = (seconds: number) => Math.min(Math.max(Math.ceil(seconds), 1), 120);

  const ms = Number(headers["retry-after-ms"]);
  if (Number.isFinite(ms) && ms > 0) return cap(ms / 1000);

  const raw = headers["retry-after"];
  if (!raw) return null;

  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds > 0) return cap(seconds);

  const date = Date.parse(raw);
  if (Number.isFinite(date)) {
    const delta = (date - Date.now()) / 1000;
    if (delta > 0) return cap(delta);
  }
  return null;
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

  // Delegated so this agrees with what the routes act on, and so it recognises
  // the same phrasings and the same RetryError wrapping - a phone showed the raw
  // "Failed after 3 attempts. Last error: AI_APICallError: Request too large ...
  // OTPM: Limit 1000, Requested 1456 ... Upgrade to Dev Tier" because this branch
  // only looked for the words "rate limit".
  const rateLimit = readRateLimit(error);
  if (rateLimit) {
    const wait = rateLimit.retryAfterSeconds ?? 60;
    return `You've hit ${provider}'s rate limit. Wait about ${wait} seconds and try again.`;
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

  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
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
