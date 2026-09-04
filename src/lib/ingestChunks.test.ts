import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runChunks } from "./ingestChunks";

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
