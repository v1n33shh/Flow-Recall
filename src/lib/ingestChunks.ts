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

/** Sections per persisted batch in a continuous run - the unit of work that reaches
 * the library, not the unit of the student's patience (they tap once and it keeps
 * going). Small on purpose: a batch is the most that an app kill can cost, and 4
 * sections is roughly 30 seconds. Raising it saves localStorage rewrites of a deck
 * that is already megabytes; lowering it risks less. Shared by /ingest's "Continue
 * this deck" and the library's "Generate Next Section" so the two cannot drift. */
export const CONTINUE_BATCH_SIZE = 4;

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
  /** The first chunk this run did not complete: the one that failed, `chunks.length`
   * when none did, or - since Stop is polled before each chunk goes out - the section
   * a Stop landed on, in which case `error` is null. Callers queue this one and
   * everything after it rather than dropping them. */
  failedAtIndex: number;
  /** The failure, or null when every chunk succeeded. */
  error: string | null;
  /** The route's code for that failure, where it sent one - see ChunkOutcome.code. */
  code: string | null;
  /** The chunk spacing this run settled on, after any widening a 429 forced.
   *
   * Returned so a caller running several batches back to back can carry it
   * forward - see runChunksContinuous. Without that, every batch restarts at
   * BASE_CHUNK_DELAY_MS and rediscovers the same limit, which is the sawtooth the
   * comment on delayMs below exists to avoid. */
  delayMs: number;
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
    /** Spacing to start at, for a caller continuing where an earlier run left off.
     * Defaults to BASE_CHUNK_DELAY_MS, i.e. optimistic. */
    initialDelayMs?: number;
    /** Polled before each chunk goes out, so a Stop lands on the next section rather
     * than on the end of the batch. Omitted by /ingest, which has no Stop. */
    shouldStop?: () => boolean;
    onProgress: (progress: ChunkProgress) => void;
  },
): Promise<ChunkRunResult> {
  const { model, countsFirstChunk, initialDelayMs, shouldStop, onProgress } = options;
  const concepts: Concept[] = [];
  // Widened for the rest of the run the first time a 429 proves the current
  // spacing is too tight for this account. Kept across chunks deliberately: once
  // an account has shown where its limit is there is nothing to gain from
  // rediscovering it on every remaining chunk.
  let delayMs = Math.min(
    Math.max(initialDelayMs ?? BASE_CHUNK_DELAY_MS, BASE_CHUNK_DELAY_MS),
    MAX_CHUNK_DELAY_MS,
  );

  for (let i = 0; i < chunks.length; i++) {
    // Before the request goes out, never mid-flight. A request already sent is paid
    // for either way - but the ones after it are not, and sending them spends the
    // allowance the student just asked us to stop spending. Measured on the device
    // before this check existed: a Stop at section 5 ran on to section 8, 40 seconds
    // and 12 cards later, under a button that said "Finishing this section".
    if (shouldStop?.()) {
      return { concepts, failedAtIndex: i, error: null, code: null, delayMs };
    }

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
          delayMs,
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

  return { concepts, failedAtIndex: chunks.length, error: null, code: null, delayMs };
}

/** How far through an unbounded run we are. Sections rather than "parts", because
 * this counts across the whole source rather than within one batch. */
export type ContinuousProgress = {
  /** 1-based index of the section in flight, across the whole run. */
  currentSection: number;
  totalSections: number;
  /** Cards **already persisted** by onBatch. Deliberately not "cards generated":
   * a card that has not been handed to onBatch yet would vanish if the app died,
   * so counting it would overstate what the student actually has. */
  cardsSoFar: number;
  /** From runChunks - a rate-limit or garbled-response wait, while it is waiting.
   * Matters far more here than in a single batch: a 62-second pause inside a
   * twenty-minute run reads as a hang unless the screen says what it is for. */
  waitingReason: string | null;
  /** shouldStop() has gone true and the current section is being finished. Polled
   * on every progress tick so the button can say so immediately, even though the
   * run only acts on it at the next batch boundary. */
  stopping: boolean;
};

/** `ContinuousResult.code` when `onBatch` could not save a batch.
 *
 * Not a code any route sends - no server knows the device is full. It is separate
 * from every other failure because it is the only one where the cards a run reports
 * were NOT kept: they were generated, paid for, and had nowhere to go. Callers must
 * therefore not tell the student "we kept N cards" or "tap again to carry on" for
 * it; the thrown message says the one thing that helps instead. */
export const PERSIST_FAILED_CODE = "PERSIST_FAILED";

export type ContinuousResult = {
  /** Everything this run generated, across every batch - generated, not necessarily
   * saved. On PERSIST_FAILED_CODE the last batch is in here and is NOT in the deck,
   * which is why a caller must not count these as cards the student kept. */
  concepts: Concept[];
  /** The sections still ungenerated when the run ended. Already handed to the last
   * onBatch call; returned so a caller that wants to reconcile can. */
  remaining: string[];
  error: string | null;
  code: string | null;
  stoppedBy: "exhausted" | "user" | "error";
};

/** `ContinuousResult.code` for a monthly generation budget the route has refused. Sent
 * by /api/ingest, unlike PERSIST_FAILED_CODE, but named here for the same reason: the
 * copy below branches on it, and a typo in a bare string is a student told to retry
 * into a wall. */
export const BUDGET_REACHED_CODE = "GENERATION_BUDGET_REACHED";

/** What to tell the student when a continuous run ends badly.
 *
 * Shared because both screens - /ingest's recognition card and the library's deck card
 * - end a run the same way and were saying it in four subtly different sentences ("the
 * cards that came through" against "the cards that did come through"). Copy that tells
 * someone whether to tap again is not a place for drift.
 *
 * The branch that matters is "tap again to carry on", which is right for a rate limit
 * or a garbled response and wrong for both of the others:
 *
 *   - BUDGET_REACHED_CODE: the next tap is refused for the reason this one was, so
 *     inviting it teaches the student the button is broken.
 *   - PERSIST_FAILED_CODE: the next tap regenerates cards the same failed write will
 *     drop again - and the cards this run reports were generated, never saved, so the
 *     "we kept N" count would be a lie on top of it. The thrown message already says
 *     the one thing that helps (free some space), so it stands alone.
 */
export function continuationMessage(run: {
  error: string;
  code: string | null;
  kept: number;
}): string {
  if (run.kept === 0 || run.code === PERSIST_FAILED_CODE) return run.error;
  const cards = `${run.kept} ${run.kept === 1 ? "card" : "cards"}`;
  if (run.code === BUDGET_REACHED_CODE) {
    return `${run.error} We kept the ${cards} generated before it ran out.`;
  }
  return `${run.error} We kept the ${cards} that came through - tap again to carry on.`;
}

/** Works through `chunks` until they run out, the student stops it, or something
 * stops it for them - the whole book from one tap instead of ~115 of them.
 *
 * Batches exist for PERSISTENCE, not pacing: `onBatch` fires after each one, so
 * cards reach the library as they are made and the caller's record of what is left
 * shrinks in step. The invariant every exit path holds is that the `remaining`
 * handed to the last `onBatch` is exactly the sections that have not been
 * generated - which is what makes an unbounded loop safe to offer at all. A run
 * killed at section 90 of 121 has 90 sections' worth saved and resumes at 91.
 *
 * `shouldStop` is polled BETWEEN batches, never mid-batch: the requests in a batch
 * in flight are already paid for, so abandoning them would burn a student's
 * allowance for nothing. "Stop" therefore means "stop after this section".
 *
 * Never throws, for the same reason runChunks does not - a partial run is a result. */
export async function runChunksContinuous(
  chunks: string[],
  options: {
    model: string | undefined;
    /** True only where the very first section spends a monthly deck allowance.
     * Applied to the first batch alone; every later batch continues a deck that has
     * already been paid for. */
    countsFirstChunk: boolean;
    /** Sections per persisted batch. Small keeps the most recent work safe; large
     * keeps localStorage rewrites of a growing deck down. */
    batchSize: number;
    shouldStop: () => boolean;
    /** Persist. Called only when a batch actually produced cards - a batch that
     * failed on its first section leaves `remaining` unchanged, so writing it back
     * would bump the deck's updatedAt for nothing.
     *
     * May throw: storage is finite and a book is large (see DeckStorageFullError).
     * A throw ends the run with PERSIST_FAILED_CODE rather than escaping, because
     * the alternative is spending another batch on cards the same write would
     * drop - and doing that for every remaining section of a book. */
    onBatch: (concepts: Concept[], remaining: string[]) => void;
    onProgress: (progress: ContinuousProgress) => void;
  },
): Promise<ContinuousResult> {
  const { model, countsFirstChunk, batchSize, shouldStop, onBatch, onProgress } = options;
  const generated: Concept[] = [];
  let offset = 0;
  // Carried across batches on purpose. Once a 429 has told this account its
  // spacing is too tight, starting the next batch back at BASE_CHUNK_DELAY_MS
  // would re-trip the same limit and spend a retry rediscovering it - every batch,
  // for the length of a book.
  let delayMs: number | undefined;

  while (offset < chunks.length) {
    const batch = chunks.slice(offset, offset + Math.max(1, batchSize));
    const batchOffset = offset;

    const run = await runChunks(batch, {
      model,
      countsFirstChunk: countsFirstChunk && batchOffset === 0,
      initialDelayMs: delayMs,
      shouldStop,
      onProgress: ({ current, waitingReason }) =>
        onProgress({
          currentSection: batchOffset + current,
          totalSections: chunks.length,
          cardsSoFar: generated.length,
          waitingReason,
          stopping: shouldStop(),
        }),
    });

    generated.push(...run.concepts);
    delayMs = run.delayMs;
    const remaining = chunks.slice(batchOffset + run.failedAtIndex);

    if (run.concepts.length > 0) {
      try {
        onBatch(run.concepts, remaining);
      } catch (persistError) {
        // `remaining` here starts at THIS batch, not after it. Nothing was written,
        // so nothing may be reported as generated - otherwise the sections this
        // batch paid for are marked done while their cards do not exist, and they
        // are gone for good rather than merely unsaved.
        return {
          concepts: generated,
          remaining: chunks.slice(batchOffset),
          error:
            persistError instanceof Error
              ? persistError.message
              : "The cards were generated but could not be saved on this device.",
          code: PERSIST_FAILED_CODE,
          stoppedBy: "error",
        };
      }
    }

    if (run.error) {
      return {
        concepts: generated,
        remaining,
        error: run.error,
        code: run.code,
        stoppedBy: "error",
      };
    }

    // A batch that stopped short of its own length was stopped by the student, not by
    // a failure - runChunks polls shouldStop before each section. Returning here
    // rather than falling through keeps `offset` honest: the sections it never sent
    // must stay in `remaining`, and advancing past them would drop them silently.
    if (run.failedAtIndex < batch.length) {
      return {
        concepts: generated,
        remaining,
        error: null,
        code: null,
        stoppedBy: "user",
      };
    }

    offset = batchOffset + batch.length;
    if (offset >= chunks.length) break;

    if (shouldStop()) {
      return {
        concepts: generated,
        remaining: chunks.slice(offset),
        error: null,
        code: null,
        stoppedBy: "user",
      };
    }

    // The gap runChunks leaves out after its last chunk. Without it the first
    // request of the next batch lands with no spacing at all, which on a
    // rate-limited account is the one place a 429 is guaranteed.
    await sleep(delayMs);
  }

  return {
    concepts: generated,
    remaining: [],
    error: null,
    code: null,
    stoppedBy: "exhausted",
  };
}
