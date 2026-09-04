# FlowRecall — Handoff

**Written 2026-09-04, end of day. Supersedes the 2026-09-03 version entirely** — earlier ones are in
`git log --follow -- HANDOFF.md`. Everything still open from that version is carried forward in §8.

---

## 1. State right now

| | |
|---|---|
| **Tests** | 478 passed / 478 across 31 files, `npm test` exit 0 |
| **Typecheck** | `npx tsc --noEmit` clean |
| **Lint** | `npx eslint src` — 0 errors, 12 warnings, all predating today (reader hook deps, unused `createAnthropic`) |
| **Build** | `npm run build` succeeds |
| **Git** | 3 commits **ahead** of `origin/main`. Tree clean apart from untracked `test-models.mjs` (scratch, deliberately uncommitted) |
| **Deployed** | `06c662c` **is live** — pushed and auto-deployed to production at 14:27 IST, three minutes after the 14:24 commit |
| **Database** | Migration `20260904150000_add_generation_request_allowance` **applied to Supabase**. `prisma migrate status` → up to date |
| **Device** | Release APK (`DEVTOOLS=1` build) installed on the CPH2001. Library intact — 2 decks, signed in, plan PRO |
| **Groq** | Developer plan **active** (billing confirmed). But the API key still receives free-tier limits — the one unresolved problem, §5 |

**A correction to what I said repeatedly during the session.** I kept saying "four commits unpushed, none of
the server-side work is live." That was wrong, and it matters for reading the rest of this file. `06c662c`
was pushed and has been in production since 14:27, and it is the largest of the four: the worker extraction,
the sentence-aware chunker, `runChunks`, the 429 pass-through, the `RetryError` unwrap and `maxRetries: 0`.
**The core fix is already serving students.** Only the three later commits are not.

### What is and is not deployed

| commit | time | contents | live? |
|---|---|---|---|
| `06c662c` | 14:24 | PdfDropzone worker extraction, `chunkText`, `runChunks`, route 429 + `retryable`, `RetryError` unwrap, `maxRetries: 0` | **yes** |
| `a885db3` | 14:35 | ±25% jitter on the retry wait | no |
| `1d6cd31` | 15:15 | per-request generation budget, usage logging, `FREE_MODEL` env var | no |
| `72a69b0` | 16:20 | `gpt-oss-120b` switch, `groqProviderOptions()` / `reasoningEffortFor()` | no |

The migration is applied while the code that reads those columns (`1d6cd31`) is **not** deployed. That is
safe — extra columns with defaults are invisible to the old code — but it does mean the generation budget is
not yet enforcing anything in production.

### The 478 tests include live-database integration tests

`src/lib/freeQuotaDb.test.ts` and `src/lib/clozeGradeRateLimit.test.ts` hit the real Supabase Postgres on
purpose: the guarantee under test is Postgres taking a row lock and re-evaluating an `UPDATE`'s `WHERE`
against the committed row, which no mock can demonstrate. They are ~180s of the ~195s run and they fail
whenever the pooler is unreachable. **Check connectivity before reading a red run as a regression.**

---

## 2. What today changed

The task was "fix the flashcard issue" — uploading a large PDF froze the phone and then died partway
through with a 502 or a 429. The 2026-09-03 handoff had diagnosed three causes. There were five, and the
one that actually killed decks was not on that list.

### a) Extraction ran on the UI thread — `src/components/PdfDropzone.tsx`

It had its own inline `extractPdfText`: `getDocument`, then a `for` loop over every page calling
`getTextContent`, all on the main thread. On a 476-page book that is a minute-plus of frozen WebView, and on
Android a frozen WebView is indistinguishable from a crashed app.

It now calls `startPdfExtraction` from `src/lib/pdfExtractClient.ts` — the reader's pipeline, **called rather
than copied**, per the standing rule that the reader is finished work. Four things came with it:

- Decoding, paragraph grouping and Type3 cipher recovery all run in `src/workers/pdfExtract.worker.ts`.
- pdf.js gets `cMapUrl` and `standardFontDataUrl`. The inline loop passed neither, so a CID-keyed book
  extracted as mojibake and every card built from it was nonsense. **This was a silent correctness bug**,
  not just a speed one.
- Real progress (`pagesDone` / `totalPages`) instead of an unbounded spinner.
- `classifyPdfError`, so a password-protected PDF is named as one, and `assessPdfText`, so a page-scan is
  refused *before* generation rather than spending a FREE account's deck on stray glyphs.

### b) Chunk edges landed mid-sentence — `src/lib/chunkText.ts` (new)

`chunkText` lived inside `src/app/ingest/page.tsx` and hard-sliced any paragraph over the budget at fixed
character offsets — mid-word. A PDF page arrives as one paragraph, so nearly every page got mutilated. That
is not cosmetic: the prompt demands a verbatim `sourceQuote` and a `cloze` whose blank `answer` fills
exactly, and neither survives a fragment starting mid-clause, so the model abandons the JSON and the route
answers 502.

The new module breaks on paragraphs, then sentences, then whitespace. The sentence splitter answers "not a
boundary" on every doubt — single capitals (`J. R. R. Tolkien`), a 60-entry abbreviation list, and the rule
that carries it: any period whose next character is lower-case or a digit.

**Measured on the real 476-page `The 48 Laws Of Power` PDF**, auditing every chunk edge for a break inside a
paragraph that is not also a sentence end:

| | chunks | mid-sentence breaks |
|---|---|---|
| old, 1500 chars | 1326 | **484 of 1325 edges (36.5%)** |
| new, 4500 chars | 372 | **0 of 371** |

### c) A 429 could not be recognised — `src/lib/ai.ts`

**This is the one the diagnosis missed, and it is why one rate limit cost a whole book.** `generateText`
spends its own retries and then throws the AI SDK's `RetryError`, and `APICallError.isInstance` on that is
`false` — so the status code and every rate-limit header sat one level down, unread. The route flattened it
into an untyped 502, the client could not tell a wait from a broken response, and the run ended at part 16
of 20.

`readRateLimit` now unwraps `RetryError.lastError`, and matches **both** of Groq's phrasings for the same
ceiling: a spent window says "Rate limit reached", a single oversized request says "Request too large", and
only the first contains the words "rate limit". `getFriendlyErrorMessage` delegates to it, so students stop
seeing `AI_APICallError … Upgrade to Dev Tier today at console.groq.com/settings/billing`.

### d) The waiting happened in the wrong place — `maxRetries: 0`

The SDK's default is 2 retries and it **honours** `retry-after: 43`, so a rate-limited chunk sat inside one
request for 27–58 seconds against the route's own `maxDuration = 60`. The phone measured round trips of
**58527 ms, 58606 ms and 56102 ms** — within 1.5 s of Vercel killing the function and turning a 43-second
wait into a 504. It also means most of that run was absorbing OTPM 429s invisibly, which is why 15 chunks
that each cost ~2.5 s of real model time took 40–58 s apiece.

At `maxRetries: 0` the 429 returns in ~200 ms with its header intact and the client does the waiting — off
the serverless clock, and in front of the student.

### e) The library had a second copy of the whole loop — `src/app/page.tsx`

`handleGenerateNextSection` was the same `for` loop with its own flat delay, a bare `throw` on any non-2xx,
and `await res.json()` (which throws its own unhelpful `Unexpected token '<'` on a gateway HTML page). Worse
than the ingest version: on any failure it discarded every chunk that had already succeeded, so a 429 at
part 3 of 4 threw away three chunks of paid-for cards and the next tap regenerated them.

Both screens now share `runChunks` (`src/lib/ingestChunks.ts`), which keeps partial results and requeues
only from the chunk that actually failed.

### f) Two paths spent money with no ceiling at all — `1d6cd31`

Found while pricing the paid tier, and invisible until then because on the free tier the only currency was
time:

- **Continuation chunks were outside the quota.** `/api/ingest` gates and counts `isFirstChunk` only, so
  "Generate Next Section" was never counted. Finishing the 424-chunk Osho PDF is ~1.5M tokens against **one**
  of three monthly decks.
- **`/api/decks/[id]/shuffle` was metered by nothing.** PRO-gated is not bounded, and at
  `maxOutputTokens: 5200` it is the largest single response the app asks for.

The deck count cannot be made to do this job — it counts decks, the money is spent per request. So there is
now a second allowance beside it: `FREE_GENERATION_REQUESTS_PER_MONTH = 100` (3 decks × 20 chunks = 60, plus
40 of continuation headroom) and `PRO_GENERATION_REQUESTS_PER_MONTH = 2000` as a fair-use ceiling an ordinary
~200-request month never reaches. `claimGenerationRequest` copies `claimLookupAllowance`'s two-statement
idempotent-reset shape; both spending routes claim through it.

**Two deliberate choices not to undo:**

- The claim runs **before** the model call, the opposite of `claimDeckAllowance`. That one claims afterwards
  so a model failure cannot cost a student one of their three decks. This one meters money, and the money is
  gone the moment the request goes out — claiming afterwards would leave the ceiling advisory.
- The refusal carries `code: "GENERATION_BUDGET_REACHED"` and **no** `retryable`, threaded through
  `ChunkRunResult`, because both screens must stop saying "tap again to carry on" for it — the next tap is
  refused for the same reason.

### g) The free model is now `openai/gpt-oss-120b` — `72a69b0`

4.1× cheaper per request than `qwen/qwen3.6-27b` (net of the extra reasoning tokens it emits), and a
**Production** model rather than one Groq labels "evaluation purposes only, may be pulled without warning" —
which retires a risk that has already broken this app twice.

**The reason this needed code, not just config:** `gpt-oss` **rejects `reasoning_effort: "none"` with a hard
400** — it must be `low`, `medium` or `high`. The app sent exactly that on every Groq call, from a constant,
across seven routes. So the `GROQ_FREE_MODEL` escape hatch added in `1d6cd31` did **not** work for Groq's own
suggested migration target: flipping the env var alone would have 400'd every request in the app.

`GROQ_PROVIDER_OPTIONS` is now `groqProviderOptions()`, with the mapping in a testable
`reasoningEffortFor(modelId)`: `qwen/*` → `"none"`, everything else → `"low"`. **Do not unify them on
`"low"`** — that bills qwen for reasoning it does not need at $3.00/1M output, and qwen remains the fallback.

---

## 3. The device run — what it proved

Built with `DEVTOOLS=1 npm run build:apk` then `./gradlew assembleRelease`, installed over the existing app
on the CPH2001 (Android 11, WebView 150). Signature matched (`e1f4352f…bc09`), **library survived**. Driven
over CDP with the real `/sdcard/Download/The Book of Wisdom (Osho)….pdf`.

| | before | after |
|---|---|---|
| Cards from one run | 22 | **44** |
| Chunks for the whole book | 1023 + 40 | **404 + 20** |
| Chunk sizes | 1125, 1500, 1399, 1500, 809, 1500 … | 2126–3045, every edge sentence-bounded |
| Worst main-thread stall, 11-minute run | *(never measured; the loop was synchronous)* | **1022 ms** — 1 stall over 1s, 2 over 250ms, 41,289 frames at ~60fps |

Then part 16 of 20 failed with `Request too large … on output tokens per minute (OTPM): Limit 1000,
Requested 1456`, which is what led to §4.

**Note the effective chunk size is ~2600, not 4500.** This book's paragraphs run 2000–2600 characters and the
packer will not split one unless it must, so one paragraph per chunk is the binding constraint. The 4500 cap
is a ceiling this book never reaches.

---

## 4. The measured numbers — keep these, they were expensive to get

### Groq free-tier ceilings, per ORGANIZATION not per user

Every student's request goes out under one server-side `GROQ_API_KEY`, and Groq enforces per organization —
the 429 says so in as many words: `in organization org_01kwhcy15eez7bnn3ddqhka6kj`.

| | free tier | Developer plan (org page) |
|---|---|---|
| Output tokens/minute (OTPM) | **1000** | not published; lifted |
| Tokens/minute | 8,000 | **250,000** |
| Tokens/day | 200,000 (**≈86 requests/day for the whole product**) | **No limit** |
| Requests/minute | 30 | 1,000 |
| Requests/day | 1,000 | 500,000 |

One ingest request costs **868–1000 output tokens**, so on the free tier the sustainable rate is **about one
request per minute for the entire user base**. Two students generating at the same instant both get a 429 —
measured, into a window that had been clear for 70 seconds, `retry-after: 5` and `retry-after: 22`. Neither
was served. `max_tokens` is irrelevant to this: the same chunk succeeded identically at 900, 1200 and 2400.

### Cost per request, measured against the real chunk with the real prompt

| Model | section | in/out per 1M | measured in/out | per request | per deck (20) |
|---|---|---|---|---|---|
| `openai/gpt-oss-120b` | **Production** | $0.15 / $0.60 | 1462 / 1079 | **$0.00087** | **$0.017** |
| `openai/gpt-oss-20b` | Production | $0.075 / $0.30 | 1462 / 1019 | $0.00042 | $0.008 |
| `qwen/qwen3.6-27b` | Preview | $0.60 / $3.00 | 1435 / 886 | $0.00352 | $0.070 |
| Claude Haiku 4.5 (PRO) | — | $1.00 / $5.00 | 1435 / 886 | $0.00587 | $0.117 |

Pricing confirmed from Groq's own `/v1/models` endpoint, not a docs page. It also reports
`input_cache_read: $0.075/1M` and `supported_features: [tools, json_mode, structured_outputs, reasoning]`.

### What free students cost, on gpt-oss-120b

| | cap | per call | at the cap |
|---|---|---|---|
| Card generation | 100/month | $0.000867 *(measured)* | $0.087 |
| Reader lookups (define/ask/map) | 60/month | ~$0.0002 *(estimated)* | ~$0.011 |
| **Study grading + teach-back** | **200/DAY** (`DAILY_GRADE_CAP`) | $0.0000546 *(measured)* | **$0.33** |
| **Everything at its ceiling** | | | **~$0.43** ≈ ₹38 |

**1000 free students:** realistic (15–25% max out) **$25–45/month**; all maxing generation + lookups **$98**;
theoretical worst case with every ceiling hit daily **$430**. At ₹299/month, **31 PRO conversions out of 1000
covers the entire free tier**.

**`DAILY_GRADE_CAP = 200` is the loosest number in the app** — 6,000/month, which at the ceiling is ~4× the
whole generation budget. It was set as an abuse ceiling when Groq was free and has never been sized from cost.
Not changed today; flagged as the next thing worth a decision.

### All seven AI routes verified on gpt-oss-120b

Real prompts through their real Zod schemas, because six of them had nothing to do with the ingest
investigation and a swap that fixes deck generation while quietly breaking word lookup in the reader is the
worse outcome.

| route | output tokens | finish | schema |
|---|---|---|---|
| ingest | 1079 | stop | OK — 3 cards |
| shuffle | 980 | stop | OK — 5 cards |
| concept-map | 209 | stop | OK — 3 edges |
| ask | 126 | stop | OK |
| teach-back | 114 | stop | OK |
| define | 106 | stop | OK |
| cloze-grade | 46 | stop | OK |

---

## 5. The one unresolved problem: Groq says Developer, the key gets Free

The Developer plan **is** active — the Billing page offers **Downgrade** (only possible from a paid plan) and
there is a live billing period, 04/09/2026 – 01/10/2026, at $0.00. Organization Limits shows
`openai/gpt-oss-120b` at **250K TPM / 1K RPM / 500K RPD / TPD No limit**.

But a live request with the app's key returns:

```
x-ratelimit-limit-tokens:    8000      <- free tier; org page says 250000
x-ratelimit-limit-requests:  1000      <- free tier RPD; org page says 500000
x-ratelimit-reset-requests:  1m26.4s
```

Both pinned to exactly the free-tier values, which **rules out propagation** — a lag would move them
together, not hold both at the old numbers. And `1m26.4s` is the proof of which bucket is being used:
86,400 seconds ÷ 1,000 = 86.4, so the key is being metered against a free-tier **daily** bucket, not the
Developer per-minute one.

**What was checked and ruled out:** payment method (billing fully configured), propagation (no movement over
~40 minutes of polling), organization limits (correct on the console).

**Leading theory.** The `GROQ_API_KEY` is **63 days old** (confirmed on Vercel: `Production, Preview, 63d
ago`). It was created while the account was on the free plan. Alongside that, the console's Token Usage
showed **0 for the last 30 days** despite ~30 live calls made against that key during this session — which
points at the key belonging to a different project (or organization) than the one that was upgraded. Groq
scopes API keys to a project, and the console breadcrumb reads `Personal / Default Project`.

**The console would not confirm it.** The "Show Current Project Limits" toggle would not flick, and the
sidebar `PROJECT → Limits` page was not reached. That toggle may simply be inert because there are no
project-level overrides to show — in which case project scoping is *not* the cause and this is Groq's side.

**A watcher was left running** at `/tmp/watch-groq-limits.sh` — one 8-token request every 5 minutes, exits
when TPM changes from 8000, gives up after 4 hours. It saw no change. **It dies with the machine/session, so
it is gone now; re-run it if useful.**

---

## 6. Exact next steps, in order

### 1. Settle the Groq limits (blocks a Play Store launch, nothing else)

Do these in order and stop at the first that resolves it.

- **Groq console → API Keys.** What is listed, and which project owns each key? **If the page is empty**, the
  account you upgraded does not own the 63-day-old key and that single fact explains every symptom. Create a
  key in the upgraded project, put it in `.env` and on Vercel, done.
- **Sidebar → PROJECT → Limits** (the nav item, not the broken toggle). If `gpt-oss-120b` reads 8,000 TPM
  there while the org page reads 250,000, the project is overriding and the `Actions` column raises it.
- **Create a fresh API key** in `Personal / Default Project` and test it. This is the discriminator and it
  bypasses the console entirely. Put it in `.env` as `GROQ_API_KEY_NEW="gsk_..."` — **not pasted into chat** —
  and test with the header check in §7.
- **If a fresh key is also capped at 8000, it is Groq's side.** You now have Chat Support on the Dev plan.
  Send them this, and include the `1m26.4s` detail, which is what makes the ticket unambiguous:

  > My organization is on the Developer plan. Organization Limits shows `openai/gpt-oss-120b` at 250K TPM /
  > 1K RPM / 500K RPD. But API requests with my key return `x-ratelimit-limit-tokens: 8000` and
  > `x-ratelimit-limit-requests: 1000` with `x-ratelimit-reset-requests: 1m26.4s`, which are the free-tier
  > values. Organization `org_01kwhcy15eez7bnn3ddqhka6kj`. Please apply the Developer limits to my API keys.

### 2. Push the three commits

```bash
git push origin main
```

Vercel auto-deploys from `main` (proven today: 14:24 commit → 14:27 production deploy). Nothing else is
needed to ship §2f and §2g.

### 3. Set the two Vercel env vars — AFTER step 2, not before

```bash
vercel env add GROQ_FREE_MODEL production              # openai/gpt-oss-120b
vercel env add NEXT_PUBLIC_GROQ_FREE_MODEL production  # openai/gpt-oss-120b
```

**Order matters.** The deployed code (`06c662c`) still has `FREE_MODEL` hardcoded to `qwen/qwen3.6-27b` — the
env-var read arrived in `1d6cd31`. Setting these before pushing does nothing. Setting them after pushing needs
a redeploy to take effect, since `NEXT_PUBLIC_*` is inlined at build time.

They must be **identical**: the route's request enum is built from the server one and the client dropdown reads
the public one, and drift means a 400 from the schema rather than from Groq.

Vercel CLI is authenticated as `levinblus-2527`, project `flow-recall` (`prj_QwBfxiWwXox7ikfHp37nWTQKzBuV`),
already linked via `.vercel/repo.json`.

### 4. Re-run the device test

Rebuild (`DEVTOOLS=1 npm run build:apk` → `./gradlew assembleRelease` → install the **release** APK only,
never the debug build), re-run the real Osho PDF, and confirm three things:

- all 20 parts complete with no 429
- per-request round trips drop from 27–58 s to the ~2.5 s the model actually takes
- `generationRequestsUsed` on the user row lands at exactly 20, and the logged `outputTokens` near 1079

---

## 7. Things that will bite the next session

**`npm run build:apk` fails after a plain `npm run build`.** The script moves `src/app/api` aside for the
static export, but clears only `out/`, not `.next/` — so a `.next/dev/types/validator.ts` left by an ordinary
build cannot resolve the routes and type-checking dies with ten `TS2307`s. `rm -rf .next` first. One-line fix
in `scripts/build-capacitor.mjs`, not taken.

**Driving the app on the device.** The staging trick is not optional: the app requests no storage permission,
and `DOM.setFileInputFiles` is read by the app's own process, so a path under `/sdcard/Download/` is
unreadable to it. Copy into the app's own external dir first:

```bash
adb shell "cp '/sdcard/Download/<book>.pdf' /sdcard/Android/data/app.flowrecall.android/files/wisdom.pdf"
```

Then: the static export writes `out/ingest.html`, so `https://localhost/ingest/` **404s and silently falls
back to the home page** — navigate to `/ingest.html`. A release APK only exposes chrome://inspect when built
with `DEVTOOLS=1`. `adb` lives at `~/Android/Sdk/platform-tools/adb` and is not on `PATH`. And CapacitorHttp
routes fetch through native OkHttp, so **CDP sees no network events at all** — patch `window.fetch` in-page to
observe API traffic.

**A build can "Compile successfully" and still fail.** `next build` compiles, then type-checks, then
prerenders static pages — and a prerender failure comes *after* the success line. Grepping the log for
`Compiled successfully` reported a green build while `/ingest` was failing to prerender, and the bug reached
production (it failed there, safely — Vercel does not promote a failed build). **Check the exit code:**

```bash
rm -rf .next && npm run build > /tmp/build.log 2>&1; echo "exit: $?"
```

The bug itself is worth knowing as a class: `MODEL_OPTIONS` in `src/app/ingest/page.tsx` calls
`freeModelLabel()` during module evaluation, and that function read a `const` declared *below* it — a
temporal-dead-zone `ReferenceError`, not `undefined`. Function declarations hoist; `const` bindings do not.
`tsc --noEmit` stayed clean throughout, because TypeScript does not model TDZ across a call. The map is now
declared above its consumer and there is a comment there saying why the order matters.

**Checking the rate limits without the console:**

```bash
export GROQ_KEY=$(grep -m1 '^GROQ_API_KEY=' .env | sed 's/^GROQ_API_KEY=//; s/^"//; s/"$//')
curl -s -D - -o /dev/null -X POST https://api.groq.com/openai/v1/chat/completions \
  -H "Content-Type: application/json" -H "Authorization: Bearer $GROQ_KEY" \
  -d '{"model":"openai/gpt-oss-120b","messages":[{"role":"user","content":"ok"}],"max_tokens":8,"reasoning_effort":"low"}' \
  | grep -i ratelimit
```

**Groq ≠ Grok.** `console.x.ai` is xAI's Grok and has nothing to do with this app; a team called "Flowrecall"
was created there by mistake today with a $0.00 balance and no key — harmless, can be deleted. Anything
referencing `GROQ_API_KEY`, `qwen/`, `gpt-oss`, or `api.groq.com` is Groq.

**Do not save a Groq model allowlist with only `gpt-oss-120b` checked.** "Only allow these models" blocks
everything else org-wide, including the `qwen/qwen3.6-27b` that production still runs on until step 3 above is
done. An allowlist needs **both** ids, or rollback requires a deploy.

---

## 8. Carried forward, still open

### The 5 remaining npm vulnerabilities — accepted, with reasons

`npm audit` reports **5 (4 high, 1 moderate, no critical)**, down from 12. Neither chain has a clean fix.

**`epubjs@0.3.93` → `@xmldom/xmldom@0.7.13`** — 1 high + 1 moderate, XML injection via unsafe CDATA
serialization plus uncontrolled recursion. This is the one on the production path. **Decision made and
standing: stay on 0.3.93.** `0.4.2` exists but is a semver-major that the maintainer never promoted to the
`latest` dist-tag, the library is effectively unmaintained, and the reader is finished work whose rendering
engine must not be swapped. Revisit only if `0.4.x` is ever promoted.

**`prisma@6.19.3` → `@prisma/config` → `deepmerge-ts@7.1.5`** — 3 highs, one chain, stack exhaustion on
recursive merges. Build- and CLI-time config merging, not the request path. The only fix npm offers is
`prisma@6.12.0`, a downgrade to before `@prisma/config` existed. Waits on Prisma bumping to `deepmerge-ts` ≥8.

**`npm audit fix --force` would roll Prisma back and major the reader. Do not run it.**

### Phase 3 — flashcard understanding (unstarted)

1. **Multiple Choice Questions** — generate distractors from the concept map; build the MCQ UI so recognition
   can be tested without handing the student a 50/50 guess.
2. **Starring concepts** — a star button in the review and sheet-browsing UI, driving the FSRS `importance`
   multiplier off the flat `0.5` and onto the student's own priorities.
3. **Visual concept graph** — render the existing `concept-map` data, including its edge kinds ("Build on
   first", "This explains", "Don't confuse").

### Smaller things worth a decision

- **`DAILY_GRADE_CAP = 200`** is the loosest cap in the app and the largest cost exposure per student (§4).
- **`gpt-oss-120b` supports `structured_outputs` and `json_mode`**, which qwen did not — which is the entire
  reason seven routes hand-parse JSON and return 502s when it fails. Switching to real structured outputs
  would delete that failure mode.
- **Output volume is the real cost lever** — ~75% of the bill. `explanation` (3–4 sentences) is most of the
  886–1079 output tokens. Trimming it or dropping to 2 cards a chunk trades card quality, so it is a product
  decision rather than an optimisation.
- **Play Store**: internal testing release "1 (1.0)" is live. `versionCode` **must** be bumped in
  `android/app/build.gradle` for every upload. Play App Signing re-signs, so a sideloaded APK cannot upgrade
  in place — say so wherever the APK is offered.
