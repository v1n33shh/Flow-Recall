// Driving a deck's chunks through /api/ingest, one at a time, without letting a
// single bad minute cost the whole book.
//
// Shared by the two screens that generate cards: /ingest (a new deck) and the
// library's "Generate Next Section" (the leftovers of one). Both used to run
// their own `for` loop with a flat delay and a bare `throw` on any non-2xx, which
// is how one 429 at part 3 of 20 ended a 476-page book - and, in the library's
// case, discarded the parts that had already succeeded.
import type { Concept } from "./types";
import { apiUrl, API_FETCH_CREDENTIALS } from "./apiUrl";

// Where the gap between chunks starts. Groq's free tier caps requests AND tokens
// per minute, and nothing on the client can know which of the two a given account
// is closest to, so this starts optimistic and the run widens it on evidence
// rather than guessing a safe number up front and making everyone wait for it.
const BASE_CHUNK_DELAY_MS = 1500;
const MAX_CHUNK_DELAY_MS = 90_000;

// A rate limit is a "wait, then it will work" answer, not a failure. /api/ingest
// marks its own 502s retryable too - a model that returns unparseable JSON
// usually returns valid JSON on the next attempt. Neither retry can cost a FREE
// user a deck: every failure path in the route returns before the monthly
// allowance is claimed, so only a chunk that actually succeeded ever spends one.
const MAX_CHUNK_ATTEMPTS = 3;

// Two different waits, because the two failures have nothing in common.
//
// A garbled response is instant to re-roll; seconds is the right order.
//
// A rate limit is measured in MINUTES and the numbers are not a guess. Groq's
// free tier limits output tokens per minute (OTPM) to 1000, and one ingest
// request - 3 cards, each with a paragraph of explanation - measured 868-1000
// output tokens against the pinned model on a real chunk. That is the entire
// minute's budget for a single request, so the sustainable rate on that tier is
// about ONE request per minute, and a second one inside the same window comes
// back "OTPM: Limit 1000, Used 833, Requested 868. Please try again in 42.05"
// with `retry-after: 43`.
//
// So: prefer the provider's own header, and when there is none, wait out a whole
// window rather than re-tripping the same limit twice and burning both remaining
// attempts inside it - which is exactly how a 20-part deck used to die at part 16.
const GARBLED_BACKOFF_MS = 6000;
const RATE_LIMIT_BACKOFF_MS = 62_000;
const MAX_RETRY_WAIT_MS = 125_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type ChunkOutcome =
  | { ok: true; concepts: Concept[] }
  | {
      ok: false;
      message: string;
      /** The route's machine-readable reason, where it sent one. Callers branch on
       * this rather than on the message text - "GENERATION_BUDGET_REACHED" has to be
       * told apart from an ordinary failure, because the advice differs: one says
       * "tap again to finish", and the other means the next tap is refused too. */
      code: string | null;
      /** Worth sending this same text again - see MAX_CHUNK_ATTEMPTS. */
      retryable: boolean;
      /** Specifically a rate limit, which also widens the gap between chunks. */
      rateLimited: boolean;
      /** How long the provider asked us to wait, where it said. */
      retryAfterMs: number | null;
    };

type IngestBody = {
  concepts?: Concept[];
  error?: string;
  code?: string;
  retryable?: boolean;
  retryAfterSeconds?: number;
};

/** One chunk, one request. Reads a failure apart into "try again" and "stop"
 * rather than collapsing everything into a thrown string, because that
 * distinction is the difference between finishing a book and losing it at part 3
 * of 20. */
export async function requestChunk(
  text: string,
  isFirstChunk: boolean,
  model: string | undefined,
): Promise<ChunkOutcome> {
  let res: Response;
  try {
    res = await fetch(apiUrl("/api/ingest"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Only the first chunk of a deck counts against the FREE monthly allowance -
      // continuation chunks are part of the same deck. The offset decides which
      // calendar month that allowance is counted in.
      body: JSON.stringify({
        text,
        model,
        isFirstChunk,
        timezoneOffsetMinutes: new Date().getTimezoneOffset(),
      }),
      credentials: API_FETCH_CREDENTIALS,
    });
  } catch (err) {
    // fetch rejects rather than resolving on a network failure, and on a phone
    // that is a tunnel, a lift or a handover between cells - none of which is a
    // reason to end a deck that is 14 parts in.
    return {
      ok: false,
      message: err instanceof Error ? err.message : "Couldn't reach the server.",
      code: null,
      retryable: true,
      rateLimited: false,
      retryAfterMs: null,
    };
  }

  const rawText = await res.text();

  let data: IngestBody;
  try {
    data = JSON.parse(rawText);
  } catch {
    // Not JSON at all - a platform or gateway error page rather than the route.
    // Retryable on a 5xx for the same reason the route's own 502 is: it is about
    // this attempt, not about this text.
    console.error("Ingest returned non-JSON. Raw response:", rawText);
    return {
      ok: false,
      message: `The server returned something we couldn't read: ${rawText.slice(0, 80)}`,
      code: null,
      retryable: res.status >= 500,
      rateLimited: false,
      retryAfterMs: null,
    };
  }

  if (res.ok && Array.isArray(data.concepts)) {
    return { ok: true, concepts: data.concepts };
  }

  const headerSeconds = Number(res.headers.get("retry-after"));
  const retryAfterSeconds =
    Number.isFinite(headerSeconds) && headerSeconds > 0 ? headerSeconds : data.retryAfterSeconds;

  return {
    ok: false,
    message: data.error ?? "Something went wrong generating that part.",
    code: data.code ?? null,
    retryable: data.retryable === true || res.status === 429,
    rateLimited: res.status === 429,
    retryAfterMs:
      typeof retryAfterSeconds === "number" && Number.isFinite(retryAfterSeconds)
        ? retryAfterSeconds * 1000
        : null,
  };
}

export type ChunkProgress = {
  /** 1-based index of the chunk being worked on. */
  current: number;
  total: number;
  /** What the run is waiting for, while it is waiting. Null while in flight.
   * Without it the progress bar sits on the same part for up to 45 seconds with
   * nothing to say, which reads as a hang - and a student who force-quits there
   * loses the deck. */
  waitingReason: string | null;
};

export type ChunkRunResult = {
  /** Everything that succeeded, whether or not the run finished. */
  concepts: Concept[];
  /** Index of the chunk that failed, or `chunks.length` when none did. Callers
   * queue this one and everything after it rather than dropping them. */
  failedAtIndex: number;
  /** The failure, or null when every chunk succeeded. */
  error: string | null;
  /** The route's code for that failure, where it sent one - see ChunkOutcome.code. */
  code: string | null;
};

/** Sends `chunks` in order, retrying the retryable failures and widening the gap
 * when an account proves it needs one. Never throws: a partial run is a result,
 * not an exception, because the caller has cards worth saving either way. */
export async function runChunks(
  chunks: string[],
  options: {
    model: string | undefined;
    /** True on /ingest, where chunk 0 spends the monthly allowance. False for a
     * continuation, which belongs to a deck already paid for. */
    countsFirstChunk: boolean;
    onProgress: (progress: ChunkProgress) => void;
  },
): Promise<ChunkRunResult> {
  const { model, countsFirstChunk, onProgress } = options;
  const concepts: Concept[] = [];
  // Widened for the rest of the run the first time a 429 proves the current
  // spacing is too tight for this account. Kept across chunks deliberately: once
  // an account has shown where its limit is there is nothing to gain from
  // rediscovering it on every remaining chunk.
  let delayMs = BASE_CHUNK_DELAY_MS;

  for (let i = 0; i < chunks.length; i++) {
    onProgress({ current: i + 1, total: chunks.length, waitingReason: null });

    for (let attempt = 1; ; attempt++) {
      const outcome = await requestChunk(chunks[i], countsFirstChunk && i === 0, model);

      if (outcome.ok) {
        concepts.push(...outcome.concepts);
        break;
      }

      if (!outcome.retryable || attempt >= MAX_CHUNK_ATTEMPTS) {
        return {
          concepts,
          failedAtIndex: i,
          error: outcome.message || `Something went wrong on part ${i + 1} of ${chunks.length}.`,
          code: outcome.code,
        };
      }

      // The provider's own Retry-After wins where it sent one: it knows when its
      // window rolls over and we are guessing.
      const targetMs = Math.min(
        outcome.retryAfterMs ??
          (outcome.rateLimited ? RATE_LIMIT_BACKOFF_MS : GARBLED_BACKOFF_MS * attempt),
        MAX_RETRY_WAIT_MS,
      );

      // Jittered, because the Groq key is ONE key for every student: the OTPM
      // ceiling is enforced per organization, so two phones generating at the same
      // moment already 429 each other (measured - both requests failed, neither
      // succeeded). Clients that then back off by the same 62 seconds wake together
      // and collide again. A spread of +/-25% is what breaks that lockstep.
      const waitMs = Math.round(targetMs * (0.75 + Math.random() * 0.5));

      if (outcome.rateLimited) {
        // Self-tuning, and the reason the doubling this replaced was useless:
        // 1500ms -> 3000ms is nowhere near a per-minute window, so the run just
        // re-tripped the limit on the next chunk.
        //
        // Note it takes the LONGER of the header and a full window, not the header
        // alone. `retry-after: 43` says when the current window clears; it is not a
        // sustainable rhythm. A rolling per-minute budget needs spacing of at least
        // cost/limit x 60s, and ~900 output tokens against a 1000 OTPM ceiling is
        // ~54s - so pacing at 43s trips again immediately, every chunk, and settles
        // into a sawtooth that spends one retry per chunk to go half as fast.
        //
        // Built from targetMs, not the jittered wait: jitter exists to scatter
        // simultaneous clients, not to talk this run into a spacing it has already
        // been told is too tight.
        delayMs = Math.min(
          Math.max(delayMs, targetMs, RATE_LIMIT_BACKOFF_MS),
          MAX_CHUNK_DELAY_MS,
        );
      }

      const seconds = Math.ceil(waitMs / 1000);
      onProgress({
        current: i + 1,
        total: chunks.length,
        waitingReason: outcome.rateLimited
          ? `Hit the model's rate limit - waiting ${seconds}s, then retrying part ${i + 1}.`
          : `Part ${i + 1} came back garbled - retrying in ${seconds}s.`,
      });
      await sleep(waitMs);
      onProgress({ current: i + 1, total: chunks.length, waitingReason: null });
    }

    if (i < chunks.length - 1) await sleep(delayMs);
  }

  return { concepts, failedAtIndex: chunks.length, error: null, code: null };
}
