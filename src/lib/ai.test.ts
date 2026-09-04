import { describe, expect, it, vi } from "vitest";
import { APICallError, RetryError } from "ai";
import { getFriendlyErrorMessage, groqProviderOptions, readRateLimit, reasoningEffortFor } from "./ai";

function apiError(statusCode: number, headers?: Record<string, string>, message = "Rate limit reached"): APICallError {
  return new APICallError({
    message,
    url: "https://api.groq.com/openai/v1/chat/completions",
    requestBodyValues: {},
    statusCode,
    responseHeaders: headers,
  });
}

describe("readRateLimit", () => {
  it("returns null for anything that is not a rate limit", () => {
    expect(readRateLimit(apiError(401, undefined, "Invalid API key"))).toBeNull();
    expect(readRateLimit(new Error("The model does not exist"))).toBeNull();
    expect(readRateLimit(undefined)).toBeNull();
  });

  it("recognises a 429", () => {
    expect(readRateLimit(apiError(429))).toEqual({ retryAfterSeconds: null });
  });

  it("recognises a rate limit that only says so in its message", () => {
    // AICredits (the Pro path's OpenAI-compatible gateway) does not always
    // surface a status code the SDK can read.
    expect(readRateLimit(new Error("429 Too Many Requests: rate limit exceeded"))).toEqual({
      retryAfterSeconds: null,
    });
  });

  it("reads retry-after in seconds", () => {
    expect(readRateLimit(apiError(429, { "retry-after": "7" }))).toEqual({ retryAfterSeconds: 7 });
  });

  it("rounds a fractional retry-after up", () => {
    expect(readRateLimit(apiError(429, { "retry-after": "7.66" }))).toEqual({ retryAfterSeconds: 8 });
  });

  it("prefers retry-after-ms when both are present", () => {
    const headers = { "retry-after": "60", "retry-after-ms": "2500" };
    expect(readRateLimit(apiError(429, headers))).toEqual({ retryAfterSeconds: 3 });
  });

  it("reads an HTTP-date retry-after", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-04T12:00:00Z"));
    const headers = { "retry-after": "Fri, 04 Sep 2026 12:00:30 GMT" };
    expect(readRateLimit(apiError(429, headers))).toEqual({ retryAfterSeconds: 30 });
    vi.useRealTimers();
  });

  it("ignores a retry-after that has already passed", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-04T12:00:00Z"));
    const headers = { "retry-after": "Fri, 04 Sep 2026 11:59:00 GMT" };
    expect(readRateLimit(apiError(429, headers))).toEqual({ retryAfterSeconds: null });
    vi.useRealTimers();
  });

  it("caps an absurd wait rather than passing it through", () => {
    // Nobody holds a phone still for an hour, and the client has its own ceiling
    // below this anyway - the cap exists so a bad header can't become the wait.
    expect(readRateLimit(apiError(429, { "retry-after": "3600" }))).toEqual({
      retryAfterSeconds: 120,
    });
  });

  it("ignores a retry-after it cannot parse", () => {
    expect(readRateLimit(apiError(429, { "retry-after": "soon" }))).toEqual({
      retryAfterSeconds: null,
    });
  });

  // The three cases below all come from one real failure: a 20-part deck died at
  // part 16 on the user's phone because generateText had already spent its own
  // retries, so the route caught a RetryError whose message said "Request too
  // large ... output tokens per minute (OTPM)" - no status code it could read, and
  // not the words "rate limit" either. It was answered as a plain 502.
  it("unwraps the SDK's RetryError to find the 429 underneath", () => {
    const wrapped = new RetryError({
      message: "Failed after 3 attempts. Last error: AI_APICallError: Rate limit reached",
      reason: "maxRetriesExceeded",
      errors: [apiError(429, { "retry-after": "43" })],
    });
    expect(readRateLimit(wrapped)).toEqual({ retryAfterSeconds: 43 });
  });

  it("recognises Groq's OTPM phrasing, which never says \"rate limit\"", () => {
    const message =
      "Request too large for model `qwen/qwen3.6-27b` on output tokens per minute (OTPM): Limit 1000, Requested 1456.";
    expect(readRateLimit(new Error(message))).toEqual({ retryAfterSeconds: null });
  });

  it("recognises a requests-per-minute limit too", () => {
    expect(readRateLimit(new Error("Limit reached on requests per minute (RPM)"))).not.toBeNull();
  });
});

describe("getFriendlyErrorMessage", () => {
  it("names the provider's own wait instead of a made-up 60 seconds", () => {
    const message = getFriendlyErrorMessage(apiError(429, { "retry-after": "43" }), { provider: "Groq" });
    expect(message).toBe("You've hit Groq's rate limit. Wait about 43 seconds and try again.");
  });

  it("does not leak a raw OTPM error to the student", () => {
    const wrapped = new RetryError({
      message:
        "Failed after 3 attempts. Last error: AI_APICallError: Request too large for model `qwen/qwen3.6-27b` in organization `org_01k` on output tokens per minute (OTPM): Limit 1000, Requested 1456. Need more tokens? Upgrade to Dev Tier today at https://console.groq.com/settings/billing",
      reason: "maxRetriesExceeded",
      errors: [apiError(429, undefined, "Request too large")],
    });
    const message = getFriendlyErrorMessage(wrapped, { provider: "Groq" });
    expect(message).toBe("You've hit Groq's rate limit. Wait about 60 seconds and try again.");
    expect(message).not.toContain("OTPM");
    expect(message).not.toContain("Dev Tier");
  });

  it("still hides an operations problem behind a neutral message", () => {
    expect(getFriendlyErrorMessage(apiError(401, undefined, "Invalid API key"))).toBe(
      "The Groq service is temporarily unavailable. Please try again later.",
    );
  });
});

describe("reasoningEffortFor", () => {
  it("sends \"none\" only to qwen, which is the only family that accepts it", () => {
    expect(reasoningEffortFor("qwen/qwen3.6-27b")).toBe("none");
    expect(reasoningEffortFor("qwen/qwen3.8-27b")).toBe("none");
  });

  it("sends \"low\" to gpt-oss, which 400s on \"none\"", () => {
    // Measured against the live API: `reasoning_effort` must be one of `low`,
    // `medium`, or `high`. This is the whole reason the value stopped being a
    // constant - swapping GROQ_FREE_MODEL to Groq's own suggested migration target
    // would otherwise have 400'd every request in the app.
    expect(reasoningEffortFor("openai/gpt-oss-120b")).toBe("low");
    expect(reasoningEffortFor("openai/gpt-oss-20b")).toBe("low");
  });

  it("never sends \"none\" to a model outside the qwen family", () => {
    // The regression guard. A future model id must default to the value that is
    // accepted more widely, not to the one that is a hard 400 everywhere but qwen.
    for (const id of ["openai/gpt-oss-safeguard-20b", "llama-3.3-70b-versatile", "groq/compound", "something-new"]) {
      expect(reasoningEffortFor(id)).not.toBe("none");
    }
  });

  it("wraps the effort under the groq provider key so other providers ignore it", () => {
    // A PRO request can resolve to OpenAI or Anthropic-via-AICredits while this is
    // still passed; the SDK only applies an entry under its own provider's key.
    const options = groqProviderOptions();
    expect(Object.keys(options)).toEqual(["groq"]);
    expect(options.groq.reasoningEffort).toMatch(/^(none|low)$/);
  });
});
