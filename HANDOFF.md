# FlowRecall — Handoff

**Written 2026-09-03, second session of the day.**
*Supersedes the version written earlier today, which listed next steps that were already done — see §3. Earlier versions: `git log --follow -- HANDOFF.md`.*

## 1. State right now

- **Tests**: 410 passed / 410 across 28 files, `npm test` exit 0 — verified twice this session, before and after the change in §2. This includes the `claimDeckAllowance` suite the earlier handoff reported as failing.
- **Build**: `npm run build` succeeds.
- **Git**: clean tree, `main` == `origin/main`. Nothing to push.
- **Play Store**: internal testing release "1 (1.0)" is live. `public/.well-known/assetlinks.json` carries both fingerprints — the upload key (`E1:F4:35:2F…BC:09`) and Play App Signing (`26:CD:C4:97…04:35`) — so App Links work for Play installs and sideloads alike.
- **Dependencies**: `npm audit` reports **5 vulnerabilities (4 high, 1 moderate, no critical)**, down from 12 at the start of this session.

A caveat on "410/410": `src/lib/freeQuotaDb.test.ts` and `src/lib/clozeGradeRateLimit.test.ts` are *deliberate* integration tests against the real Supabase Postgres — the rationale is in the comment at the top of the former, and it is a good one (the guarantee under test lives in Postgres's row locking, not in this repo). Between them they are ~130s of the ~94s parallel run, and they fail whenever the pooler is unreachable. So the green suite means "410/410 with a live database", and a red run should be checked for connectivity before being read as a regression. That is what happened in the earlier handoff.

## 2. What changed this session

**Removed the `@capacitor/assets` devDependency.** It was declared in `package.json` and invoked by nothing — no npm script, no workflow, no code. It bundled its own ancient `@capacitor/cli@5.7.8`, and through that subtree it carried the only **critical** in the tree (`tar@6.2.1` — arbitrary file create/overwrite via hardlink path traversal), plus `sharp@0.32.6`, `@trapezedev/project` → `@xmldom/xmldom`, and `xcode` → `uuid`. Every one of those chains was reachable *only* through it, so removal cleared them all at once: 12 vulnerabilities (1 critical / 7 high / 4 moderate) → 5 (0 critical / 4 high / 1 moderate). Tests and build were re-run green afterwards. The diff is `package.json` plus 1747 deleted lock lines.

There was no upgrade path — `3.0.5` is the latest published `@capacitor/assets`, which is why `npm audit` reported `fixAvailable: false` for the `sharp` node.

Nothing was lost by removing it. Its outputs, the 56 icon and splash PNGs under `android/app/src/main/res/`, are committed, and its input `assets/icon.png` is still in the repo. If the icons ever need regenerating, run it one-off rather than re-adding the dependency:

```bash
npx @capacitor/assets generate --android
```

## 3. Corrections to the earlier handoff

Its "Exact Next Steps" had transcribed `npm audit`'s `fixAvailable` field without checking those versions against what was installed. For two packages that field pointed at versions *older* than the installed ones, so following the steps literally would have been a downgrade.

| Earlier claim | Reality |
|---|---|
| "Upgrade Next.js to `16.3.4`" | Already `16.3.4` — done in `111eaee`, up from `16.2.10`. |
| "Upgrade Auth.js / `@auth/core` to `5.0.0-beta.25`" | `next-auth` is `^5.0.0-beta.31`, resolving to beta.32; `@auth/core` is 0.41.3. beta.25 is **older**. Nothing to do. |
| "Upgrade Prisma to `6.12.0` (resolves `deepmerge-ts`)" | Already `6.19.3`, so `6.12.0` is a **downgrade** — and it does not resolve `deepmerge-ts`, which is still present at 6.19.3 (§4b). |
| "`pdfjs-dist` upgraded to `4.10.38`" | It went `6.1.200` → **`6.3.289`**, also in `111eaee`. |
| "`git push` requires your local credentials" | Everything was already pushed; tree clean, `main` == `origin/main`. |
| "14 vulnerabilities (4 moderate, 9 high, 1 critical)" | It was 12 (4 / 7 / 1). Now 5. |
| "One test failed due to a temporary network timeout … unrelated to the PDF logic" | True as far as it goes, but that test is an intentional live-Postgres integration test, not a flake to wave past. See the caveat in §1. |

## 4. The 5 remaining vulnerabilities, and why each is still here

Neither remaining chain has a clean fix; both are waiting on someone upstream.

**a) `epubjs@0.3.93` → `@xmldom/xmldom@0.7.13` — 1 high + 1 moderate. This is the one on the production path.**

XML injection via unsafe CDATA serialization, plus uncontrolled recursion in serialization leading to DoS. The advisory range is `<=0.8.14`; the hoisted top-level copy is 0.7.13 and it comes from `epubjs`, the EPUB reader the app ships. (The other copy in the tree, `0.9.12` under `@capacitor/cli` → `plist`, is outside the range and fine.)

npm offers `epubjs@0.4.2`, but this needs a decision rather than a command:

- 0.4.2 is a **semver-major**, and epubjs's `latest` dist-tag is still **0.3.93** — the maintainer published 0.4.x and never promoted it. The library is effectively unmaintained.
- The reader is finished work; the standing rule is to call its extraction library, not edit it. A major bump to its rendering engine is exactly the kind of change that rule exists to prevent.
- Verifying it would mean the real EPUB in the library (the Carnegie book) on-device, not a synthetic file.

**b) `prisma@6.19.3` → `@prisma/config@6.19.3` → `deepmerge-ts@7.1.5` — 3 highs, all one chain.**

Stack exhaustion when merging recursive object graphs; advisory range `<8.0.0`. The only fix npm offers is `prisma@6.12.0`, a downgrade to before `@prisma/config` existed — not a real option. This code path is build- and CLI-time config merging, not the request path. It waits on Prisma bumping `deepmerge-ts` to ≥8.

## 5. Do this next

*Decision Made:* We are **leaving `epubjs` at `0.3.93`** for now. The exposure risk (XML injection inside a student-selected EPUB) is minimal, and a major version bump on a finished, unmaintained reader poses a much larger regression risk. We will revisit if `0.4.x` is ever promoted to latest.

**Immediate Task 1: Fix PDF Ingest & Model Crashes — DONE, 2026-09-04. Not committed; the working tree carries it.**

All three diagnosed causes are fixed, plus two more found on the way: a 429 the client could not recognise, and a second copy of the whole loop in the library. Details in §6.

**Immediate Task 2: Phase 3 — flashcard understanding.** Unchanged from the earlier handoff:

1. **Multiple Choice Questions** — generate distractors from the concept map; build the MCQ UI so recognition can be tested without handing the student a 50/50 guess.
2. **Starring concepts** — a star button in the review and sheet-browsing UI, driving the FSRS `importance` multiplier off the flat `0.5` and onto the student's own priorities.
3. **Visual concept graph** — render the existing `concept-map` data, including its edge kinds ("Build on first", "This explains", "Don't confuse").

## 6. The flashcard fix (Task 1), in detail — 2026-09-04

**Tests**: 447 passed / 447 across 31 files, `npm test` exit 0 — 37 new, in the three new test files below. `npm run build` succeeds, `npx tsc --noEmit` clean, `eslint src` 0 errors (12 warnings, all of them older than this work — the reader's hook deps and an unused `createAnthropic` in `src/lib/ai.ts`).

**a) Extraction moved off the main thread — `src/components/PdfDropzone.tsx`.**

It had its own inline `extractPdfText`: `getDocument`, then a `for` loop over every page calling `getTextContent` and joining `item.str` with spaces, all on the UI thread. On a 476-page book that is a minute-plus of frozen WebView, which on Android is indistinguishable from a crashed app.

It now calls `startPdfExtraction` from `src/lib/pdfExtractClient.ts` — the reader's pipeline, called rather than copied, per the standing rule. Four things come with it that the inline loop could not offer:

- The page decoding, geometric paragraph grouping and Type3 cipher recovery all run in `src/workers/pdfExtract.worker.ts`. The UI thread only ever receives finished strings.
- pdf.js gets `cMapUrl` and `standardFontDataUrl`. The inline loop passed neither, so a CID-keyed or non-embedded-font PDF extracted as mojibake — and every card built from it was nonsense. This was a silent correctness bug, not just a speed one.
- Real progress (`pagesDone` / `totalPages`) instead of an unbounded spinner, so a minute of reading does not look like a hang.
- `classifyPdfError`, so a password-protected PDF is named as one instead of "Failed to read that PDF", and `assessPdfText`, so a page-scan is refused **before** generation rather than spending one of a FREE account's monthly decks on stray glyphs.

**b) Chunk edges now land on sentence boundaries — `src/lib/chunkText.ts` (new), `src/lib/chunkText.test.ts` (new, 16 tests).**

`chunkText` lived inside `src/app/ingest/page.tsx` and hard-sliced any paragraph longer than the budget at fixed character offsets — mid-word, mid-clause. That is not a cosmetic problem: the ingest prompt demands a verbatim `sourceQuote` and a `cloze` whose blank `answer` fills exactly, and neither is satisfiable against a fragment starting mid-clause. The model either invents the missing half or abandons the JSON shape, and the route answers 502. This is the "model failure" in the bug report, and its cause was on the client.

The new module breaks on paragraphs where it can, sentences where it must, and whitespace only when a single sentence exceeds the whole budget. The sentence splitter is the interesting part: only a lone `.` is ever ambiguous, and every test answers "not a boundary" on doubt, because refusing a break only makes one piece longer while taking a false one mutilates a sentence. It rejects single capitals (`J. R. R. Tolkien`), a 60-entry abbreviation list, and — the rule that actually carries it — any period whose next character is lower-case or a digit, which covers the abbreviations no list survives contact with.

**Verified on real content**, not fixtures — the 476-page `The 48 Laws Of Power` PDF in `~/Downloads`, run through the real extraction and then both chunkers, auditing every chunk edge for a break inside a paragraph that is not also a sentence end:

| | chunks | mid-sentence breaks |
|---|---|---|
| old, 1500 chars | 1326 | **484 of 1325 edges (36.5%)** |
| new, 4500 chars | 372 | **0 of 371 edges** |

(That book also extracts with scrambled word order in its front matter — a geometric-grouping limitation inside the reader's extraction library, unrelated to chunking and out of scope.)

**c) Chunk size 4500, and pacing that reacts instead of guessing — `src/lib/ingestChunks.ts` (new), `src/lib/ingestChunks.test.ts` (new, 11 tests).**

`DEFAULT_CHUNK_SIZE` is 4500, up from 1500. Free output tokens: the prompt caps the model at 3 cards per chunk regardless of chunk length, so a bigger chunk costs nothing extra to generate — it just gives the model more material to choose its 3 best cards from. `MAX_CHUNKS` on /ingest drops 40 → 20, which is ~90,000 characters of a book in ~20 requests: half the requests the old 40 × 1500 spent, across 1.5× the text.

The delay was a flat `CHUNK_DELAY_MS = 1000`. Nothing on the client can know whether a given account is closer to Groq's per-minute *request* limit or its per-minute *token* limit, so guessing a single number was always going to be wrong in one direction. It now starts at 1500ms and **doubles on the first 429**, capped at 30s, and keeps the widened gap for the rest of the run — once an account has shown where its limit is there is nothing to gain from rediscovering it on every remaining chunk.

The loop itself is now `runChunks` in the new module, because **two screens generate cards, not one** — see (e).

*One tradeoff to know about:* 3 cards per 4500 characters is a third of the old card density per page of source. In exchange a deck covers 1.5× the text and the truncation banner fires far less often. If decks come back feeling thin, the lever is the "MAXIMUM of 3 flashcards" line in `buildConceptsPrompt` (and then `maxOutputTokens`), not the chunk size.

**d) The fourth cause: a 429 could not be recognised, so it ended the deck — `src/app/api/ingest/route.ts`, `src/lib/ai.ts`, `src/lib/ai.test.ts` (new, 10 tests).**

This is the one the diagnosis missed, and it is why a single rate limit cost a whole book. The route's `catch` flattened *every* provider failure into a 502 with a friendly string. A rate limit is a "wait, then it will work" answer, but the client could not tell it apart from a broken response, so it threw, and the run ended at part 3 of 20.

- New `readRateLimit(error)` in `src/lib/ai.ts` recognises a rate limit (status **or** message, since the Pro path's AICredits gateway does not always surface a code) and reads the provider's own wait from `retry-after` (seconds or HTTP-date) or `retry-after-ms`, capped at 120s.
- The route now answers **429** with `code: "RATE_LIMITED"`, `retryAfterSeconds` and a `Retry-After` header. Its parse / schema / quality-gate 502s carry `retryable: true`, and the generic 502 defers to `APICallError.isRetryable` so a rejected key is not retried three times.
- The client retries a retryable chunk up to 3 attempts, preferring the provider's `Retry-After` over its own backoff, and shows what it is waiting for rather than sitting on the same part in silence for 45 seconds.

**Retrying costs a FREE user nothing**, and that is load-bearing: every one of those failure paths returns *before* `claimDeckAllowance`, so the monthly allowance is only ever claimed by a chunk that actually succeeded.

`maxOutputTokens` went 2400 → 3000. A truncated response is a dead batch, not a degraded card, and each chunk now carries three times as much source material for a model to be tempted past its 3-card cap by. A cap is not a target, so a well-behaved response costs nothing for the headroom.

**Confirmed unrelated**: `reasoningEffort: "none"` still works on `qwen/qwen3.6-27b` — `test-models.mjs` (untracked scratch, left in place) returns a clean short answer with no `<think>` block. The pinned free model was never part of this.

**e) The library's "Generate Next Section" had the same bug, and lost more when it fired — `src/app/page.tsx`.**

`handleGenerateNextSection` was a second copy of the same loop: its own flat `CHUNK_DELAY_MS`, a bare `throw` on any non-2xx, and `await res.json()` (which throws its own unhelpful `Unexpected token '<'` on a gateway HTML page). This is the path the ingest screen's own error message sends students to — "tap Generate Next Section to finish this deck" — so leaving it unfixed would have meant the reported bug simply moving to a different screen.

Worse than /ingest's version: on any failure it discarded `newConcepts` entirely and left `pendingChunks` untouched, so a 429 on part 3 of 4 threw away three chunks of cards that had already cost real tokens, and the next tap re-generated and re-paid for them.

Both screens now call `runChunks`. The continuation keeps whatever succeeded and requeues only from the chunk that actually failed, and its button says which part it is on (and what it is waiting for) instead of "Generating..." for up to a minute.

## 7. On the phone, 2026-09-04 — and the root cause the diagnosis missed

Built with `DEVTOOLS=1 npm run build:apk`, `./gradlew assembleRelease`, installed over the existing app on the CPH2001 (Android 11, WebView 150). Signature matched (`e1f4352f…bc09`), **library survived** — 2 decks, still signed in, plan PRO. Driven over CDP with the real `/sdcard/Download/The Book of Wisdom (Osho)….pdf` staged into the app's own external dir (`/sdcard/Android/data/app.flowrecall.android/files/`), because the app holds no storage permission and `DOM.setFileInputFiles` is read by the app's own process.

**What the run proved**

| | before | after |
|---|---|---|
| Cards from one run | 22 | **44** |
| Chunks for the whole book | 1023 + 40 | **404 + 20** |
| Chunk sizes | 1125, 1500, 1399, 1500, 809, 1500 … | 2126–3045, every edge sentence-bounded |
| Worst main-thread stall, whole 11-min run | *(never measured; the loop was synchronous)* | **1022 ms**, 1 stall over 1s, 2 over 250ms, 41,289 frames at ~60fps |

The UI freeze is gone and the chunker is doing what §6b claimed. Note the effective chunk size is **~2600, not 4500**: this book's paragraphs run 2000–2600 characters, and the packer refuses to split one unless it must, so one paragraph per chunk is the binding constraint. The 4500 cap is a ceiling this book never reaches.

**Then part 16 of 20 failed, and it named the real cause.**

```
Request too large … on output tokens per minute (OTPM): Limit 1000, Requested 1456
```

Reproduced locally against the pinned model on that same 2706-character chunk off the phone:

- One ingest request costs **868–1000 output tokens** (3 cards, each with a paragraph of explanation). `finishReason` was `stop` at every cap tested.
- Groq's free tier allows **1000 output tokens per minute**. So the sustainable rate is **about one request per minute**, full stop.
- Two requests inside one window: the second returns `429`, `Rate limit reached … OTPM: Limit 1000, Used 833, Requested 868. Please try again in 42.05`, with **`retry-after: 43`**.
- **`max_tokens` is irrelevant to this.** The same chunk succeeded identically at 900, 1200 and 2400. So the §6d note about raising it to 3000 was wrong on its own terms — **reverted to 2400.**

The run had been pacing at 40–58s between chunks, just fast enough to accumulate, and tripped at part 16. This — not chunk mutilation — is the `429` in the original bug report. Mutilation was real (36.5% of edges) and worth fixing, but it was not what killed the deck.

**Corrections made after the device run**

- `readRateLimit` now **unwraps the AI SDK's `RetryError`**. This is why the 429 reached the client as an untyped 502 even in principle: `generateText` spends its own three fast retries inside the same one-minute window, then throws a `RetryError`, and `APICallError.isInstance` on that is `false` — so the status code and every rate-limit header sat one level down, unread.
- It also matches Groq's **two** phrasings for the same ceiling: a spent window says "Rate limit reached", a single oversized request says "Request too large", and only the first contains the words "rate limit".
- `getFriendlyErrorMessage` delegates to it, so the student stops seeing `AI_APICallError … Upgrade to Dev Tier today at console.groq.com/settings/billing`, and gets the provider's actual wait instead of a hardcoded "exactly 60 seconds".
- The rate-limit backoff is **62s** (was 6s, 12s) with a 125s ceiling, and the inter-chunk delay now adopts **the longer of the provider's `Retry-After` and a full window** as the run's spacing, instead of doubling 1500 → 3000. Doubling was useless against a per-minute window: it re-tripped the limit and spent both remaining attempts inside it. `Retry-After` alone is not enough either — it says when the *current* window clears, and a rolling per-minute budget needs spacing of at least cost/limit × 60s, so pacing at the 43s Groq asks for trips again on every chunk.
- **`maxRetries: 0` on the route's `generateText`.** This is the one that removes a 504 waiting to happen. The SDK's default is 2 retries and it *honours* `retry-after: 43`, so a rate-limited chunk sat inside a single request for 27–58 seconds against this route's own `maxDuration = 60`. The phone measured round trips of **58527 ms, 58606 ms and 56102 ms** — within 1.5 s of Vercel killing the function. It also means most of that run was already absorbing OTPM 429s invisibly inside single requests, which is why 15 chunks that each cost ~2.5 s of real model time took 40–58 s apiece. At 0 the 429 returns in ~200 ms with its header intact and the client does the waiting, off the serverless clock and in front of the student.

**Tests**: 460 / 460 across 31 files, `npm test` exit 0. `npm run build` succeeds, `tsc --noEmit` clean, `eslint src` 0 errors / 12 pre-existing warnings.

## 8. The free tier cannot serve more than one student at a time

Asked directly, and measured, because it is a different question from "does one upload work".

**Every student's request goes out under one server-side `GROQ_API_KEY`** (`src/lib/ai.ts`, three call sites), and Groq enforces OTPM **per organization** — the 429 says so in as many words: `in organization org_01kwhcy15eez7bnn3ddqhka6kj … on output tokens per minute (OTPM)`. So the 1000-token minute is not per user. It is the whole product's budget.

Two requests fired at the same instant, into a window that had been clear for 70 seconds:

| | result |
|---|---|
| student-1 | **429**, `retry-after: 5` |
| student-2 | **429**, `retry-after: 22` |

Neither succeeded. Two requests each reserving ~886 output tokens exceed 1000 together, so both were rejected rather than one being served and one queued.

Headers off a successful call, for the record: `x-ratelimit-limit-requests: 1000` (reset `1m26.4s`, so per minute — irrelevant here) and `x-ratelimit-limit-tokens: 8000` per minute. At ~1435 input + ~886 output = ~2321 tokens a request, **TPM 8000 caps the whole organization at ~3.4 requests a minute even if OTPM were lifted.** Neither number is per-student, and no client-side change can divide them.

What that means in practice, at ~1.1 requests/minute org-wide and 20 parts to a deck:

- **1 student**: ~20 minutes a book. Works.
- **2 students at once**: measured above — both fail, then retry into each other. ~40+ minutes each.
- **10 students**: one request per student per ~10 minutes. A book becomes 3+ hours, with a rate-limit notice on screen almost continuously.
- **A class**: unusable. Not "slow" — the retry logic keeps it from *losing* work, but there is no capacity to hand out.

**Added because of this**: the retry wait is now jittered ±25%. Without it, every client that trips the shared ceiling backs off by the same 62 seconds, wakes in lockstep and collides again — a thundering herd the previous version would have created and then blamed on the provider.

The fix is capacity, and it is a billing decision, not a code one: Groq's paid tier, or routing students to the Pro model. Reducing output per request (fewer cards, shorter `explanation` in `buildConceptsPrompt`) buys a factor of ~1.5, which changes nothing about the shape of the problem.

## 9. The generation budget, 2026-09-04 — two uncapped paths closed

Asked before binding a paid model: what does a free student cost, and can it run away? It could, two ways, and neither was visible on the free tier because there the only currency was time.

- **Continuation chunks were free of the quota.** `/api/ingest` gates and counts `isFirstChunk` only, so "Generate Next Section" was uncounted, forever. Finishing the 424-chunk Osho PDF is ~1.5M tokens against **one** of three monthly decks.
- **`/api/decks/[id]/shuffle` was metered by nothing at all.** PRO-gated is not bounded, and at `maxOutputTokens: 5200` it is the largest single response the app asks for — so an unlimited tap was the most expensive uncapped path in the product.

**Added: a second allowance that counts requests, not decks.** `FREE_GENERATION_REQUESTS_PER_MONTH = 100` (3 decks × 20 chunks = 60, plus 40 of continuation headroom) and `PRO_GENERATION_REQUESTS_PER_MONTH = 2000` as a fair-use ceiling — an ordinary PRO month is ~200 requests and never sees it. `claimGenerationRequest` in `src/lib/freeQuotaDb.ts` copies `claimLookupAllowance`'s two-statement idempotent-reset shape, and both spending routes claim through it.

Two things about that claim are deliberate and worth not undoing:

- It runs **before** the model call, the opposite of `claimDeckAllowance`. That one claims afterwards so a model failure cannot cost a student one of their three decks. This one meters money, and the money is gone the moment the request goes out — a failed generation still burned the tokens. Claiming afterwards would leave the ceiling advisory.
- The refusal carries `code: "GENERATION_BUDGET_REACHED"` and **no** `retryable`, so `runChunks` stops instead of spending three refusals on it. The code is threaded through `ChunkRunResult` because both screens need to say something different for it: "tap Generate Next Section to finish" is right for a rate limit and wrong here, where the next tap is refused for the same reason.

Migration `20260904150000_add_generation_request_allowance` is **applied to Supabase**. Additive only (`generationRequestsUsed INTEGER NOT NULL DEFAULT 0`, `generationResetAt TIMESTAMP(3)` nullable), so existing rows read as count 0 with no marker and get their first fresh allowance at the next month boundary.

**Also in:** `console.log` of `usage` in both generating routes — nothing recorded token spend before, and the measured baseline to compare against is **1435 input / 886 output** per ingest request. And `FREE_MODEL` now reads `GROQ_FREE_MODEL` (client: `NEXT_PUBLIC_GROQ_FREE_MODEL`) with the current id as the default, because Groq lists `qwen3.6-27b` under **Preview** — "not for production" — and §6/§7's history is two decommissions that each needed an app release to fix. The next one is a Vercel config change. **Both vars must be set to the same value**; the route's request enum comes from the server one and the dropdown from the public one, and drift means a 400.

**Tests**: 474 / 474 across 31 files. The nine new live-Postgres cases include both money-losing races — two concurrent requests cannot both take the last slot, and four at a month boundary get one shared budget rather than one each.

**The economics, for the record.** Measured per ingest request: 1435 in, 886 out.

| | input $/1M | output $/1M | per request | per deck (20) | 3 decks |
|---|---|---|---|---|---|
| Groq free | — | — | $0 | $0 | but ~86 requests/**day** org-wide |
| Groq paid `qwen3.6-27b` | $0.60 | $3.00 | $0.0035 | $0.070 | **$0.21** |
| Claude Haiku 4.5 | $1.00 | $5.00 | $0.0059 | $0.117 | $0.35 |

A fully-utilising free student is ~$0.35/month on Groq paid against ₹299 (~$3.40) PRO revenue. **Prompt caching does not help** and was checked rather than assumed: Haiku 4.5 needs a 4096-token minimum cacheable prefix and the fixed part of `buildConceptsPrompt` is ~730 tokens, so a marker would silently never cache; Groq's cached-input discount only touches input, which is 25% of the bill. The real efficiency lever is output volume — `explanation` is most of the 886 — and that trades card quality, so it is left as its own decision.

## 10. Do this next, in this order

1. **Deploy.** The APK calls the live API (`NEXT_PUBLIC_API_URL`), so every server-side fix above — the 429 pass-through, the `retryable` flags, the friendly message — is inert until `main` is deployed. The device run above exercised the client half against the *old* route. Nothing is committed yet.
2. **Decide the PRO default.** `DEFAULT_MODEL` in `src/app/ingest/page.tsx` is the free Qwen model for everyone, so this PRO account spent an 11-minute run inside Groq's free-tier OTPM ceiling. Defaulting a PRO plan to `claude-haiku-latest` is a one-line change and probably the single biggest speed win available — but the Pro path goes through the AICredits gateway and **its rate limits were not measured** (it bills real credits; not spent without asking).
3. **Accept the free-tier ceiling, or lower the output.** At ~900 output tokens a request and 1000 OTPM, a 20-part deck on the free tier takes ~20 minutes and no retry logic can change that. The only client-side lever is fewer cards per chunk or a shorter `explanation` — both in `buildConceptsPrompt`. Worth a decision rather than a drift.
4. `scripts/build-capacitor.mjs` clears `out/` but not `.next/`, so a plain `npm run build` followed by `npm run build:apk` fails type-checking on a stale `.next/dev/types/validator.ts` that references the API routes the script has moved aside. One line; not touched.
