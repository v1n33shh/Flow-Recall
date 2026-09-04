import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BUDGET_REACHED_CODE,
  continuationMessage,
  PERSIST_FAILED_CODE,
  runChunks,
  runChunksContinuous,
  type ContinuousProgress,
} from "./ingestChunks";

type Reply = { status: number; body: unknown; headers?: Record<string, string> };

/** Queues one reply per call, so a test can say "429 then 200" and assert that
 * the second attempt is what the run ends up keeping. */
function mockFetch(replies: Reply[]) {
  const calls: { text: string; isFirstChunk: boolean; model?: string; at?: number }[] = [];
  const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
    calls.push({ ...JSON.parse(String(init.body)), at: Date.now() });
    const reply = replies[Math.min(calls.length - 1, replies.length - 1)];
    return new Response(JSON.stringify(reply.body), {
      status: reply.status,
      headers: reply.headers,
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return calls;
}

const cards = (...ids: string[]) => ({
  concepts: ids.map((id) => ({ id, concept: id, question: "q", answer: "a" })),
});

/** runChunks sleeps between chunks and while backing off, so every test drives it
 * through fake timers rather than waiting out its real pacing. */
async function run(chunks: string[], countsFirstChunk = true) {
  const progress: (string | null)[] = [];
  const promise = runChunks(chunks, {
    model: "qwen/qwen3.6-27b",
    countsFirstChunk,
    onProgress: ({ waitingReason }) => progress.push(waitingReason),
  });
  await vi.runAllTimersAsync();
  return { result: await promise, progress };
}

beforeEach(() => {
  vi.useFakeTimers();
  // The retry wait is jittered +/-25% to keep simultaneous clients from waking in
  // lockstep. 0.5 is the midpoint, i.e. a factor of exactly 1, so every test below
  // can assert the real number rather than a range. The jitter itself is covered by
  // its own test at the end.
  vi.spyOn(Math, "random").mockReturnValue(0.5);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("runChunks", () => {
  it("sends chunks in order and concatenates their cards", async () => {
    const calls = mockFetch([
      { status: 200, body: cards("a") },
      { status: 200, body: cards("b", "c") },
    ]);

    const { result } = await run(["one", "two"]);

    expect(calls.map((c) => c.text)).toEqual(["one", "two"]);
    expect(result.concepts.map((c) => c.id)).toEqual(["a", "b", "c"]);
    expect(result.error).toBeNull();
    expect(result.failedAtIndex).toBe(2);
  });

  it("counts only the first chunk against the allowance", async () => {
    const calls = mockFetch([{ status: 200, body: cards("a") }]);
    await run(["one", "two", "three"]);
    expect(calls.map((c) => c.isFirstChunk)).toEqual([true, false, false]);
  });

  it("never claims a first chunk for a continuation", async () => {
    // The library's "Generate Next Section" continues a deck already paid for.
    const calls = mockFetch([{ status: 200, body: cards("a") }]);
    await run(["one", "two"], false);
    expect(calls.map((c) => c.isFirstChunk)).toEqual([false, false]);
  });

  it("retries a 429 and keeps the cards from the successful attempt", async () => {
    // The bug this runner exists for: one rate limit used to end the whole book.
    const calls = mockFetch([
      { status: 429, body: { error: "Rate limited", code: "RATE_LIMITED", retryable: true, retryAfterSeconds: 4 } },
      { status: 200, body: cards("a") },
    ]);

    const { result, progress } = await run(["one"]);

    expect(calls).toHaveLength(2);
    expect(calls[0].text).toBe("one");
    expect(calls[1].text).toBe("one");
    expect(result.error).toBeNull();
    expect(result.concepts.map((c) => c.id)).toEqual(["a"]);
    expect(progress).toContain("Hit the model's rate limit - waiting 4s, then retrying part 1.");
  });

  it("retries a retryable 502", async () => {
    const calls = mockFetch([
      { status: 502, body: { error: "Unparseable", code: "MODEL_UNPARSEABLE", retryable: true } },
      { status: 200, body: cards("a") },
    ]);

    const { result, progress } = await run(["one"]);

    expect(calls).toHaveLength(2);
    expect(result.concepts.map((c) => c.id)).toEqual(["a"]);
    expect(progress.some((p) => p?.includes("came back garbled"))).toBe(true);
  });

  it("gives up after three attempts on the same chunk", async () => {
    const calls = mockFetch([
      { status: 429, body: { error: "Rate limited", retryable: true } },
    ]);

    const { result } = await run(["one", "two"]);

    expect(calls).toHaveLength(3);
    expect(result.error).toBe("Rate limited");
    expect(result.failedAtIndex).toBe(0);
  });

  it("does not retry a failure the server did not mark retryable", async () => {
    // FREE_LIMIT_REACHED is the one that matters: retrying it twice more would
    // only show the paywall three seconds later than it should appear.
    const calls = mockFetch([{ status: 403, body: { error: "FREE_LIMIT_REACHED" } }]);

    const { result } = await run(["one"]);

    expect(calls).toHaveLength(1);
    expect(result.error).toBe("FREE_LIMIT_REACHED");
  });

  it("keeps earlier chunks' cards when a later one fails for good", async () => {
    const calls = mockFetch([
      { status: 200, body: cards("a") },
      { status: 502, body: { error: "Dead", retryable: false } },
    ]);

    const { result } = await run(["one", "two", "three"]);

    expect(calls).toHaveLength(2);
    expect(result.concepts.map((c) => c.id)).toEqual(["a"]);
    expect(result.failedAtIndex).toBe(1);
    expect(result.error).toBe("Dead");
  });

  it("retries a network failure rather than ending the deck", async () => {
    // fetch rejects rather than resolving when a phone loses its connection.
    let attempt = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        attempt += 1;
        if (attempt === 1) throw new TypeError("Load failed");
        return new Response(JSON.stringify(cards("a")), { status: 200 });
      }),
    );

    const { result } = await run(["one"]);

    expect(attempt).toBe(2);
    expect(result.concepts.map((c) => c.id)).toEqual(["a"]);
    expect(result.error).toBeNull();
  });

  it("treats a non-JSON 5xx as retryable and a non-JSON 4xx as final", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>Gateway Timeout</html>", { status: 504 })));
    expect((await run(["one"])).result.error).toContain("couldn't read");

    const calls = vi.mocked(fetch).mock.calls.length;
    expect(calls).toBe(3);

    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>Not Found</html>", { status: 404 })));
    await run(["one"]);
    expect(vi.mocked(fetch).mock.calls).toHaveLength(1);
  });

  // Everything below is the lesson from part 16 of a real 20-part run on the
  // user's phone. Groq's free tier allows 1000 output tokens a MINUTE and one
  // ingest request costs 868-1000 of them, so a rate limit there is a ~43 second
  // wait, not a ~3 second one - the doubling this replaced (1500ms -> 3000ms) just
  // re-tripped the same limit and spent both remaining attempts inside one window.
  it("waits out a whole window when the provider sends no Retry-After", async () => {
    const calls = mockFetch([
      { status: 429, body: { error: "Rate limited", retryable: true } },
      { status: 200, body: cards("a") },
    ]);

    const { result, progress } = await run(["one"]);

    expect(calls).toHaveLength(2);
    expect(progress).toContain("Hit the model's rate limit - waiting 62s, then retrying part 1.");
    expect(result.error).toBeNull();
  });

  it("prefers the provider's own Retry-After over its own guess", async () => {
    mockFetch([
      { status: 429, body: { error: "Rate limited", retryable: true, retryAfterSeconds: 43 } },
      { status: 200, body: cards("a") },
    ]);

    const { progress } = await run(["one"]);

    expect(progress).toContain("Hit the model's rate limit - waiting 43s, then retrying part 1.");
  });

  it("reads Retry-After from the header as well as the body", async () => {
    mockFetch([
      { status: 429, body: { error: "Rate limited", retryable: true }, headers: { "retry-after": "37" } },
      { status: 200, body: cards("a") },
    ]);

    const { progress } = await run(["one"]);

    expect(progress).toContain("Hit the model's rate limit - waiting 37s, then retrying part 1.");
  });

  it("adopts the provider's wait as the spacing for every remaining chunk", async () => {
    // The self-tuning that stops the run re-tripping the limit on chunk 3, 4, 5...
    const calls = mockFetch([
      { status: 429, body: { error: "Rate limited", retryable: true, retryAfterSeconds: 43 } },
      { status: 200, body: cards("a") },
      { status: 200, body: cards("b") },
      { status: 200, body: cards("c") },
    ]);

    const { result } = await run(["one", "two", "three"]);

    expect(result.error).toBeNull();
    expect(calls).toHaveLength(4);
    // calls[1] is chunk 1's retry; the gaps after it are the new spacing. It must
    // clear a WHOLE window, not just the 43s the header asked for: at ~900 output
    // tokens against a 1000/minute ceiling, pacing at 43s trips the limit again on
    // every single chunk.
    const gaps = [calls[2].at! - calls[1].at!, calls[3].at! - calls[2].at!];
    for (const gap of gaps) expect(gap).toBeGreaterThanOrEqual(62_000);
  });

  it("still waits the provider's longer Retry-After when it exceeds a window", async () => {
    const calls = mockFetch([
      { status: 429, body: { error: "Rate limited", retryable: true, retryAfterSeconds: 90 } },
      { status: 200, body: cards("a") },
      { status: 200, body: cards("b") },
    ]);

    const { progress } = await run(["one", "two"]);

    expect(progress).toContain("Hit the model's rate limit - waiting 90s, then retrying part 1.");
    expect(calls[2].at! - calls[1].at!).toBeGreaterThanOrEqual(90_000);
  });

  it("keeps the garbled-response retry quick, since it is a re-roll not a wait", async () => {
    mockFetch([
      { status: 502, body: { error: "Unparseable", code: "MODEL_UNPARSEABLE", retryable: true } },
      { status: 200, body: cards("a") },
    ]);

    const { progress } = await run(["one"]);

    expect(progress).toContain("Part 1 came back garbled - retrying in 6s.");
  });

  it("stops on an exhausted generation budget without retrying, and keeps the cards", async () => {
    // The budget is claimed before the model call, so a retry would only spend three
    // refusals. The code has to reach the caller too: /ingest and the library both show
    // different copy for this than for a rate limit, because "tap again to carry on" is
    // wrong advice when the next tap is refused for the same reason.
    const calls = mockFetch([
      { status: 200, body: cards("a") },
      {
        status: 403,
        body: {
          error: "You've used this month's generation budget.",
          code: "GENERATION_BUDGET_REACHED",
        },
      },
    ]);

    const { result } = await run(["one", "two", "three"]);

    expect(calls).toHaveLength(2);
    expect(result.code).toBe("GENERATION_BUDGET_REACHED");
    expect(result.error).toBe("You've used this month's generation budget.");
    expect(result.concepts.map((c) => c.id)).toEqual(["a"]);
    expect(result.failedAtIndex).toBe(1);
  });

  it("reports no code when a run succeeds", async () => {
    mockFetch([{ status: 200, body: cards("a") }]);
    expect((await run(["one"])).result.code).toBeNull();
  });

  it("scatters the retry wait so simultaneous clients don't wake together", async () => {
    // One Groq key serves every student and the OTPM ceiling is per organization,
    // so two phones generating at once already 429 each other. Identical backoffs
    // would then re-collide on every retry, forever.
    const waits: number[] = [];
    for (const roll of [0, 0.5, 1]) {
      vi.spyOn(Math, "random").mockReturnValue(roll);
      mockFetch([
        { status: 429, body: { error: "Rate limited", retryable: true, retryAfterSeconds: 60 } },
        { status: 200, body: cards("a") },
      ]);
      const { progress } = await run(["one"]);
      const said = progress.find((p) => p?.includes("rate limit")) ?? "";
      waits.push(Number(said.match(/waiting (\d+)s/)?.[1]));
    }

    expect(waits).toEqual([45, 60, 75]);
    expect(new Set(waits).size).toBe(3);
  });

  it("reports which part it is on", async () => {
    mockFetch([{ status: 200, body: cards("a") }]);
    const seen: number[] = [];
    const promise = runChunks(["one", "two", "three"], {
      model: undefined,
      countsFirstChunk: true,
      onProgress: ({ current, total }) => {
        expect(total).toBe(3);
        seen.push(current);
      },
    });
    await vi.runAllTimersAsync();
    await promise;
    expect(seen).toEqual([1, 2, 3]);
  });
});

/** Drives runChunksContinuous through fake timers, recording what it persisted and
 * what it reported, the way a screen would. */
async function runContinuous(
  chunks: string[],
  options: {
    batchSize?: number;
    countsFirstChunk?: boolean;
    stopAfterBatches?: number;
    /** 1-based batch whose persist throws, standing in for a full device. */
    throwOnBatch?: number;
    /** Stop once this many sections have been requested, mid-batch on purpose. */
    stopAfterSections?: number;
  } = {},
) {
  const batches: { concepts: string[]; remaining: string[] }[] = [];
  const progress: ContinuousProgress[] = [];
  // How many sections have actually been requested so far, which is what a Stop has
  // to be measured against - `batches.length` only moves at batch boundaries.
  const sent = () => (globalThis.fetch as unknown as { mock: { calls: unknown[] } }).mock.calls.length;
  const promise = runChunksContinuous(chunks, {
    model: "qwen/qwen3.6-27b",
    countsFirstChunk: options.countsFirstChunk ?? false,
    batchSize: options.batchSize ?? 2,
    shouldStop: () =>
      (options.stopAfterBatches !== undefined && batches.length >= options.stopAfterBatches) ||
      (options.stopAfterSections !== undefined && sent() >= options.stopAfterSections),
    onBatch: (concepts, remaining) => {
      if (options.throwOnBatch !== undefined && batches.length + 1 === options.throwOnBatch) {
        throw new Error("Your device is out of space for saved decks.");
      }
      batches.push({ concepts: concepts.map((c) => c.id), remaining: [...remaining] });
    },
    onProgress: (p) => progress.push({ ...p }),
  });
  await vi.runAllTimersAsync();
  return { result: await promise, batches, progress };
}

describe("runChunksContinuous", () => {
  it("works through every section and returns all of their cards", async () => {
    const calls = mockFetch([{ status: 200, body: cards("c") }]);
    const { result } = await runContinuous(["a", "b", "c", "d", "e"], { batchSize: 2 });

    expect(calls.map((c) => c.text)).toEqual(["a", "b", "c", "d", "e"]);
    expect(result.concepts).toHaveLength(5);
    expect(result.stoppedBy).toBe("exhausted");
    expect(result.remaining).toEqual([]);
    expect(result.error).toBeNull();
  });

  it("persists each batch as it completes, with remaining equal to the ungenerated sections", async () => {
    mockFetch([{ status: 200, body: cards("c") }]);
    const { batches } = await runContinuous(["a", "b", "c", "d", "e"], { batchSize: 2 });

    // The invariant the whole feature rests on: after every write, `remaining` is
    // exactly what has not been generated, so an app kill resumes cleanly.
    expect(batches.map((b) => b.remaining)).toEqual([["c", "d", "e"], ["e"], []]);
  });

  it("counts only the very first section against the deck allowance", async () => {
    const calls = mockFetch([{ status: 200, body: cards("c") }]);
    await runContinuous(["a", "b", "c", "d"], { batchSize: 2, countsFirstChunk: true });

    expect(calls.map((c) => c.isFirstChunk)).toEqual([true, false, false, false]);
  });

  it("stops between batches when asked, keeping everything generated so far", async () => {
    const calls = mockFetch([{ status: 200, body: cards("c") }]);
    const { result, batches } = await runContinuous(["a", "b", "c", "d", "e", "f"], {
      batchSize: 2,
      stopAfterBatches: 1,
    });

    // One batch ran; the sections after it were never sent.
    expect(calls.map((c) => c.text)).toEqual(["a", "b"]);
    expect(result.stoppedBy).toBe("user");
    expect(result.concepts).toHaveLength(2);
    expect(result.remaining).toEqual(["c", "d", "e", "f"]);
    expect(batches).toHaveLength(1);
    expect(result.error).toBeNull();
  });

  it("stops on a failure with remaining starting at the section that failed", async () => {
    mockFetch([
      { status: 200, body: cards("a") },
      { status: 200, body: cards("b") },
      // Not retryable, so the run gives up on this section rather than re-sending it.
      { status: 403, body: { error: "nope", code: "SOMETHING" } },
    ]);
    const { result, batches } = await runContinuous(["a", "b", "c", "d", "e"], { batchSize: 2 });

    expect(result.stoppedBy).toBe("error");
    expect(result.concepts).toHaveLength(2);
    expect(result.remaining).toEqual(["c", "d", "e"]);
    // The failing batch produced nothing, so it must not have written - that would
    // only bump the deck's updatedAt for a remaining list that had not changed.
    expect(batches).toHaveLength(1);
    expect(batches[0].remaining).toEqual(["c", "d", "e"]);
  });

  it("stops immediately on an exhausted generation budget and passes the code up", async () => {
    const calls = mockFetch([
      { status: 200, body: cards("a") },
      { status: 403, body: { error: "out of budget", code: "GENERATION_BUDGET_REACHED" } },
    ]);
    const { result } = await runContinuous(["a", "b", "c", "d"], { batchSize: 2 });

    // No `retryable` on that answer, so it is sent once - retrying three times would
    // only delay the message by two minutes.
    expect(calls).toHaveLength(2);
    expect(result.code).toBe("GENERATION_BUDGET_REACHED");
    expect(result.stoppedBy).toBe("error");
    expect(result.remaining).toEqual(["b", "c", "d"]);
  });

  it("carries a widened rate-limit spacing across batch boundaries", async () => {
    // Without this the next batch restarts at BASE_CHUNK_DELAY_MS and re-trips the
    // same limit, spending one retry per section for the length of a book.
    const calls = mockFetch([
      { status: 429, body: { error: "slow down" } },
      { status: 200, body: cards("c") },
    ]);
    await runContinuous(["a", "b", "c", "d"], { batchSize: 2 });

    const gaps = calls.slice(1).map((call, i) => call.at! - calls[i].at!);
    // Gap 0 is the retry of the rate-limited section; every gap after it - including
    // the one spanning the batch boundary - must be a full window, not 1500ms.
    expect(gaps.every((gap) => gap >= 62_000)).toBe(true);
    expect(gaps).toHaveLength(4);
  });

  it("reports that it is stopping while it finishes the current section", async () => {
    mockFetch([{ status: 200, body: cards("c") }]);
    const { progress } = await runContinuous(["a", "b", "c", "d"], {
      batchSize: 2,
      stopAfterBatches: 1,
    });

    // The first batch is unaware; the run only learns of the stop once that batch has
    // written, so the ticks before it read false and the button stays "Stop".
    expect(progress.some((p) => p.stopping)).toBe(false);
    // One tick per section (runChunks only ticks again when it has a wait to
    // announce), and only the two sections of the first batch ever ran.
    expect(progress.map((p) => p.currentSection)).toEqual([1, 2]);
    expect(progress.at(-1)?.totalSections).toBe(4);
  });

  it("counts only cards it has actually persisted", async () => {
    mockFetch([{ status: 200, body: cards("c") }]);
    const { progress } = await runContinuous(["a", "b", "c", "d"], { batchSize: 2 });

    // Nothing is claimed before onBatch has had it: a card counted early would
    // vanish if the app died, and the number would have lied.
    expect(progress.filter((p) => p.currentSection === 1).every((p) => p.cardsSoFar === 0)).toBe(true);
    expect(progress.filter((p) => p.currentSection === 3).every((p) => p.cardsSoFar === 2)).toBe(true);
  });

  it("ends the run when a batch cannot be saved, rather than throwing", async () => {
    mockFetch([{ status: 200, body: cards("c") }]);
    const { result } = await runContinuous(["a", "b", "c", "d"], {
      batchSize: 2,
      throwOnBatch: 1,
    });

    // The contract this holds is the whole reason the guard exists: a caller that
    // relies on "never throws" would otherwise lose the result entirely.
    expect(result.stoppedBy).toBe("error");
    expect(result.code).toBe(PERSIST_FAILED_CODE);
    expect(result.error).toBe("Your device is out of space for saved decks.");
  });

  it("leaves an unsaved batch's sections in remaining, so they are not paid for twice", async () => {
    mockFetch([{ status: 200, body: cards("c") }]);
    const { result, batches } = await runContinuous(["a", "b", "c", "d", "e", "f"], {
      batchSize: 2,
      throwOnBatch: 2,
    });

    // Batch 1 saved and shrank the queue to c-f. Batch 2 generated c and d and could
    // not save them, so remaining must still start at "c" - reporting c-d as done
    // would strand cards that do not exist and lose that section for good.
    expect(batches).toHaveLength(1);
    expect(batches[0].remaining).toEqual(["c", "d", "e", "f"]);
    expect(result.remaining).toEqual(["c", "d", "e", "f"]);
    expect(result.code).toBe(PERSIST_FAILED_CODE);
  });

  it("stops spending immediately on a full device instead of working through the book", async () => {
    const calls = mockFetch([{ status: 200, body: cards("c") }]);
    await runContinuous(["a", "b", "c", "d", "e", "f", "g", "h"], {
      batchSize: 2,
      throwOnBatch: 1,
    });

    // Two requests, not eight. Every later batch would generate cards the same write
    // is going to drop, and each one costs a student a generation request.
    expect(calls.map((c) => c.text)).toEqual(["a", "b"]);
  });
});

describe("stopping lands on the next section, not the end of the batch", () => {
  it("sends no further sections once shouldStop goes true mid-batch", async () => {
    const calls = mockFetch([{ status: 200, body: cards("c") }]);
    const { result } = await runContinuous(["a", "b", "c", "d", "e", "f", "g", "h"], {
      batchSize: 4,
      stopAfterSections: 2,
    });

    // Two sections requested, not four. Before shouldStop reached runChunks, a Stop
    // during section 2 still paid for sections 3 and 4 - measured on the device as
    // 40 seconds and 12 cards after the tap, under a button reading "Finishing this
    // section".
    expect(calls.map((c) => c.text)).toEqual(["a", "b"]);
    expect(result.stoppedBy).toBe("user");
  });

  it("keeps the sections it never sent in remaining", async () => {
    mockFetch([{ status: 200, body: cards("c") }]);
    const { result, batches } = await runContinuous(["a", "b", "c", "d", "e", "f"], {
      batchSize: 4,
      stopAfterSections: 2,
    });

    // The invariant that makes an interrupted run safe to resume: c-f were never
    // generated, so they must all still be queued. Advancing offset by the batch
    // length here would have dropped c and d for good.
    expect(result.remaining).toEqual(["c", "d", "e", "f"]);
    expect(batches).toHaveLength(1);
    expect(batches[0].remaining).toEqual(["c", "d", "e", "f"]);
    expect(batches[0].concepts).toHaveLength(2);
  });

  it("does not report a stop as a failure", async () => {
    mockFetch([{ status: 200, body: cards("c") }]);
    const { result } = await runContinuous(["a", "b", "c", "d"], {
      batchSize: 4,
      stopAfterSections: 1,
    });

    expect(result.error).toBeNull();
    expect(result.code).toBeNull();
    expect(result.concepts).toHaveLength(1);
  });

  it("stops runChunks on its own, before the first request of a batch", async () => {
    const calls = mockFetch([{ status: 200, body: cards("c") }]);
    const promise = runChunks(["a", "b", "c"], {
      model: undefined,
      countsFirstChunk: false,
      shouldStop: () => calls.length >= 1,
      onProgress: () => {},
    });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(calls.map((c) => c.text)).toEqual(["a"]);
    // failedAtIndex doubles as "first section not completed", so a caller queues from
    // here whether the run ended in a failure or in a Stop.
    expect(result.failedAtIndex).toBe(1);
    expect(result.error).toBeNull();
  });
});

describe("continuationMessage", () => {
  const RATE = "Part 3 hit a rate limit.";

  it("invites another tap when another tap would actually help", () => {
    expect(continuationMessage({ error: RATE, code: "RATE_LIMITED", kept: 6 })).toBe(
      "Part 3 hit a rate limit. We kept the 6 cards that came through - tap again to carry on.",
    );
  });

  it("does not invite another tap when the budget is gone", () => {
    // The next tap is refused for the reason this one was, so inviting it teaches the
    // student the button is broken.
    const message = continuationMessage({ error: "You've used this month's allowance.", code: BUDGET_REACHED_CODE, kept: 6 });
    expect(message).toBe("You've used this month's allowance. We kept the 6 cards generated before it ran out.");
    expect(message).not.toContain("tap again");
  });

  it("says nothing about keeping cards it did not keep", () => {
    // On a persist failure those cards were generated and never saved, so a count
    // would be a lie - and the thrown message already says the one thing that helps.
    const error = "Your device is out of space for saved decks.";
    expect(continuationMessage({ error, code: PERSIST_FAILED_CODE, kept: 12 })).toBe(error);
  });

  it("stands alone when nothing came through", () => {
    expect(continuationMessage({ error: RATE, code: "RATE_LIMITED", kept: 0 })).toBe(RATE);
    expect(continuationMessage({ error: RATE, code: null, kept: 0 })).toBe(RATE);
  });

  it("counts one card as a card", () => {
    expect(continuationMessage({ error: RATE, code: null, kept: 1 })).toContain("the 1 card that came through");
  });

  it("gives an unrecognised code the retry advice, which is the safe default", () => {
    // A code this build has never seen is far more likely to be a transient provider
    // failure than a permanent refusal, and the cost of being wrong is one tap.
    expect(continuationMessage({ error: RATE, code: "SOMETHING_NEW", kept: 3 })).toContain("tap again");
  });
});
