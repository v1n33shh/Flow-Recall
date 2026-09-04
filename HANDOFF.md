# FlowRecall — Handoff

**Written 2026-09-04, end of day; §1, §6 and §9 rewritten 2026-09-05. Supersedes the 2026-09-03
version entirely** — earlier ones are in `git log --follow -- HANDOFF.md`. Everything still open from
that version is carried forward in §8.

§2 through §5, §7 and §8 are 09-04's and still stand; they are history and measurements, not status.
**§1, §6 and §9 are the only sections that describe where things are now.**

---

## 1. State right now

| | |
|---|---|
| **Tests** | 524 passed / 524 across 33 files, `npm test` exit 0 |
| **Typecheck** | `npx tsc --noEmit` clean |
| **Lint** | `npx eslint src` — 0 errors, 12 warnings, all predating 09-04 (reader hook deps, unused `createAnthropic`) |
| **Build** | `rm -rf .next && npm run build` — exit 0, with `/api/account/usage` in the route manifest |
| **Git** | **1 commit ahead** of `origin/main`: the deck-deduplication and continuous-generation work, §9. Tree clean. `test-models.mjs` is now gitignored rather than untracked-and-easily-committed |
| **Deployed** | `0f60bd0` is live. **Everything described in §2 is serving students** — see below |
| **Database** | All 10 migrations applied to Supabase, `20260904210000_add_deck_source_key` among them (applied 09-05). `prisma migrate status` → up to date |
| **Device** | Release APK (`DEVTOOLS=1` build) installed on the CPH2001. Library intact — 2 decks, signed in, plan PRO. **Nothing has been re-tested on it since the 09-04 run** — §6 |
| **Groq** | Developer plan **active** (billing confirmed). But the API key still receives free-tier limits — the one unresolved problem, §5 |

### What is and is not deployed

**All of 2026-09-04 shipped.** `origin/main` is at `0f60bd0`. The 09-04 version of this section listed
`a885db3`, `1d6cd31` and `72a69b0` as unpushed; they went out, along with two commits made after it was
written:

| commit | contents | live? |
|---|---|---|
| `06c662c` | PdfDropzone worker extraction, `chunkText`, `runChunks`, route 429 + `retryable`, `RetryError` unwrap, `maxRetries: 0` | yes |
| `a885db3` | ±25% jitter on the retry wait | yes |
| `1d6cd31` | per-request generation budget, usage logging, `FREE_MODEL` env var | yes |
| `72a69b0` | `gpt-oss-120b` switch, `groqProviderOptions()` / `reasoningEffortFor()` | yes |
| `829b25e` | the temporal-dead-zone fix that broke the production build — §7 | yes |
| `0f60bd0` | rebuild so `NEXT_PUBLIC_GROQ_FREE_MODEL` is inlined | yes |
| `fda0719` | deck deduplication + continuous generation — §9 | **no** |

So the per-request generation budget **is** enforcing in production now, which the 09-04 note said it was
not, and `gpt-oss-120b` is what free requests are billed at.

**One thing left unverified.** Whether `GROQ_FREE_MODEL` and `NEXT_PUBLIC_GROQ_FREE_MODEL` are actually
set on Vercel production. `0f60bd0`'s message strongly implies they are — that rebuild has no other
purpose — but reading the production environment was not permitted during the 09-05 session, so it is an
inference, not a check. `vercel env ls production` settles it, and until it does, do not treat "the free
model in production is `gpt-oss-120b`" as confirmed. Both must be identical; §6 explains why.

### The 509 tests include live-database integration tests

`src/lib/freeQuotaDb.test.ts` and `src/lib/clozeGradeRateLimit.test.ts` hit the real Supabase Postgres on
purpose: the guarantee under test is Postgres taking a row lock and re-evaluating an `UPDATE`'s `WHERE`
against the committed row, which no mock can demonstrate. They are ~180s of the ~195s run and they fail
whenever the pooler is unreachable. **Check connectivity before reading a red run as a regression.** They
run about 140s of the ~145s total, so a full `npm test` is not a fast loop — `npx vitest run <file>` is.

---

## 2. What 2026-09-04 changed

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

### 2. Confirm the two Vercel env vars are set (a check, not a change)

```bash
vercel env ls production | grep GROQ
```

Both `GROQ_FREE_MODEL` and `NEXT_PUBLIC_GROQ_FREE_MODEL` should read `openai/gpt-oss-120b`. `0f60bd0` was a
rebuild made for exactly this reason, so they almost certainly are — but it has not been verified, and the
failure is silent in a way worth ruling out: they must be **identical**, because the route's request enum is
built from the server one while the client dropdown reads the public one, so drift produces a 400 from the
app's own schema rather than a comprehensible error from Groq. `NEXT_PUBLIC_*` is inlined at build time, so
changing either one needs a redeploy, not just a `vercel env add`.

Vercel CLI is authenticated as `levinblus-2527`, project `flow-recall` (`prj_QwBfxiWwXox7ikfHp37nWTQKzBuV`),
already linked via `.vercel/repo.json`.

### 3. Deploy §9

The migration it needs is **already applied** (`20260904210000_add_deck_source_key`, 09-05), and it is
additive and nullable, so the currently-deployed code cannot see it. Nothing else gates the push:

```bash
git push origin main
```

Vercel auto-deploys from `main` (proven 09-04: a 14:24 commit reached production at 14:27).

`/api/sync` starts writing `Deck.sourceKey` the moment this lands, which is why the migration had to go
first — a deploy ahead of the `ALTER` would have made every deck push fail.

### 4. Re-run the device test

**Two separate things now need it**, and the second has never been on hardware at all.

Rebuild (`rm -rf .next` first — §7 — then `DEVTOOLS=1 npm run build:apk` → `./gradlew assembleRelease` →
install the **release** APK only, never the debug build) and re-run the real Osho PDF.

Carried over from 09-04, still unverified because the rate limit blocked it:

- all 20 parts complete with no 429
- per-request round trips drop from 27–58 s to the ~2.5 s the model actually takes
- `generationRequestsUsed` on the user row lands at exactly 20, and the logged `outputTokens` near 1079

New, for §9 — and note that **the whole point of the feature is a second upload**, so this needs two runs
of the same PDF, not one:

- upload the Osho PDF a second time and confirm the recognition card appears, naming the existing deck with
  the right card count and sections-left count, **before any request is sent** (patch `window.fetch` to
  watch for that — CapacitorHttp means CDP shows no network events; §7)
- "Continue this deck" appends to that deck and adds no second library row
- the allowance line on the card matches `/api/account/usage`
- "Stop" is honoured at the next section boundary, and the deck's `pendingChunks` afterwards is exactly the
  sections that were not generated — tap again and it resumes there, generating nothing twice
- kill the app mid-run and confirm the same invariant survives it (this is what batching is *for*)
- a deck created before this change still has no `sourceKey`, so re-uploading its source must fall back to
  making a new deck rather than matching the wrong one

### 5. Decide what to do about localStorage — measured 09-05, and it is tighter than expected

This was "worth knowing as a number". The number is bad.

| | chars |
|---|---|
| `flowrecall:savedDecks` | 3,915,306 |
| all 8 localStorage keys | 4,050,062 |
| **headroom before `QuotaExceededError`** | **1,048,576** |
| implied cap | ~5.1–5.3M |

**`pendingChunks` is 97% of it** — 3,801,609 of the 3,915,306. All the cards in the library together are
~113K. Per deck:

| deck | cards | pending | total chars | of which pendingChunks | avg chunk |
|---|---|---|---|---|---|
| The Book of Wisdom (Osho) | 22 | 1023 | 2,639,527 | 2,611,133 | 1219 |
| wisdom | 50 | 402 | 1,256,393 | 1,190,476 | 2952 |
| KEY PROBE 14:49:34 | 15 | 0 | 16,776 | — | — |
| Cardiac cycle - lecture 4 | 3 | 0 | 2,605 | — | — |

So **one more book does not fit**: a fresh Osho deck needs ~1.19M chars of `pendingChunks` (measured off the
`wisdom` deck) against 1.05M of headroom. Uploading it would extract fine, generate and pay for 20 sections,
then throw at `saveDeck` — §9f is what turns that into a message instead of an unhandled rejection, but the
20 requests are still gone.

The 2.64M-char deck is **obsolete**: `avgPendingChunk: 1219` is the old hard-slicing chunker §2b replaced
(36.5% mid-sentence edges), and `wisdom` is the same book redone properly. Deleting it would free 67% of the
library. **That is the user's call, not a cleanup to do unasked.**

**`navigator.storage.estimate()` is a trap here.** It reports 234 MB used of a 10.9 GB quota — that is
IndexedDB (the FSRS rows). localStorage has its own hard ~5 MB-class cap that `estimate()` does not reflect
at all, so a future session reading it would conclude there is plenty of room.

The real lever is that `pendingChunks` keeps a whole book's source text in localStorage to re-send it a
section at a time. IndexedDB has ~10 GB free on this device. Moving leftover source text there would remove
the ceiling entirely — a real change, worth a decision, not a quick fix.

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

---

## 9. Deck deduplication and continuous generation — `fda0719`, committed, not deployed

One commit, ahead of `origin/main`. Started in the session after the 09-04 handoff and wound down
mid-flight by a gateway error; reviewed, finished and verified on 09-05. The 09-04 version of this section
called it "partially built" and listed nine files — it is neither partial nor nine files, and it is larger
than its stated goal.

### The problem it solves

`/ingest` had no idea it had seen a source before. Re-uploading a PDF — which is what a student does to
carry on with a book, because `MAX_CHUNKS = 20` means one upload only ever generates the first 20 sections —
produced a **brand new deck** beside the old one, with its own review history, and re-paid for cards the
student already owned. Finishing a 404-section book meant either ~20 uploads each spawning a library row, or
~100 taps of "Generate Next Section" at four sections a tap.

### a) A source has an identity — `src/lib/sourceKey.ts` (new)

`sourceKeyFor(text)` is a whitespace-insensitive 64-bit-ish key (two 32-bit passes plus a character count).
Nothing else about an upload is stable: the filename is whatever the download was called, the title is typed
by the student, and the consumed source text is not kept. The text is.

Two things in there are load-bearing and easy to "simplify" wrongly:

- **Whitespace is collapsed during the walk, not by `.replace(/\s+/g, " ")` first.** The comment records a
  textbook of 6,027,603 characters on the user's phone; normalising first allocates a second copy of that.
- **The whitespace set is not the ASCII five.** pdf.js reconstructs spacing from glyph positions and emits
  NBSP, thin/en/em spaces, narrow NBSP and a leading BOM. If those counted as ordinary characters, a
  re-extraction of the *same file* would key differently — the one thing this must never do.

Not cryptographic on purpose: it matches a student's re-upload against the handful of decks in their own
library, nobody is constructing collisions against their own flashcards, and `crypto.subtle` is async, which
would put a promise in the middle of the upload path for no gain.

### b) `Deck.sourceKey`, synced, never backfilled

Schema, migration `20260904210000_add_deck_source_key` (**applied**), `src/lib/types.ts`, and `/api/sync`
in both directions so a re-upload is recognised on whichever device the student is holding.

**Deliberately not backfilled, and it cannot be.** The source text a deck consumed is not kept, and
`pendingChunks` is only the shrinking remainder — no identity at all. An old deck therefore never matches,
which degrades to *today's* behaviour (a new deck) rather than to a wrong match. Anyone tempted to derive a
key from `pendingChunks` should read that twice.

`findDeckBySourceKey` answers with the **most recently touched** match, because two decks can legitimately
share a key once a student has chosen "start a separate deck", and "the book I'm working on" is the recent one.

### c) `saveDeck` takes an options bag now

`pendingChunks`, `model`, `userId` and `sourceKey` are all `string | undefined`-ish and would have sat
adjacent as positional parameters, where transposing two type-checks cleanly and silently records a user id
as a model. Both call sites are in `src/app/ingest/page.tsx`.

### d) The recognition card — nothing is spent before the student chooses

`handleGenerate` computes the key and, on a match, **returns before chunking**. Every request in that flow
sits behind a button on the card: "Continue this deck", "Start a separate deck", or "Study this deck" when
there is nothing left to generate. Continuing generates from **the deck's own `pendingChunks`**, not from the
text just uploaded — that is the whole point, and it is what makes nothing get regenerated.

The card also shows what one tap can finish, from `/api/account/usage` (new, read-only — it must not roll the
stored counter over, or a page load becomes a write). Omitted entirely when unknown rather than guessed.

### e) One tap finishes the book — `runChunksContinuous`

`src/app/page.tsx`'s "Generate Next Section (4 chunks)" is now "Generate all N remaining sections", and both
screens share `runChunksContinuous`. Three properties hold it together:

- **Batches exist for persistence, not pacing.** `onBatch` fires every `CONTINUE_BATCH_SIZE` (4) sections, so
  cards reach the library as they are made. The invariant every exit path holds: the `remaining` handed to the
  last `onBatch` is exactly the sections that have not been generated. A run killed at section 90 of 121 has
  90 saved and resumes at 91.
- **`shouldStop` is polled between batches, never mid-batch.** The requests in a batch in flight are already
  paid for. "Stop" means "stop after this section", and the button says so while it finishes.
- **The widened rate-limit spacing carries across batch boundaries.** Restarting each batch at
  `BASE_CHUNK_DELAY_MS` would re-trip the same 429 and spend a retry rediscovering it, every batch, for the
  length of a book.

Both `shouldStop` flags are **refs, not state** — the runner polls them from inside a loop that closed over
the render that started it, so a state value read there is forever false.

### f) A full device no longer costs money — added 09-05

Found while reviewing (e), not reported by anything. `persistDecks` was a bare
`localStorage.setItem`, and `runChunksContinuous` called `onBatch` unguarded — so a `QuotaExceededError`
escaped a function documented as never throwing, the batch's paid-for cards were lost, and because the failed
write is *also* the write that would have shrunk `pendingChunks`, the next tap regenerated and re-paid for the
same sections. Forever, four sections at a time, with a raw `DOMException` on screen.

This is not a new bug — `appendConceptsToDeck` has always written this way — but continuous generation is what
makes the quota reachable, and it is precisely the failure class §2e and §2f exist to close.

- `persistDecks` raises a typed `DeckStorageFullError` (matched on DOMException **name and code**, across
  Chromium's `QuotaExceededError`/22 and Gecko's `NS_ERROR_DOM_QUOTA_REACHED`/1014 — never on message text).
  Non-quota failures rethrow untouched, so a real bug is not hidden behind advice that cannot help.
- `runChunksContinuous` catches `onBatch` and ends the run with `PERSIST_FAILED_CODE`, and its `remaining`
  starts at **this** batch, not after it — nothing unwritten may be reported as generated.
- It stops immediately rather than working through the rest of the book: every later batch would spend a
  generation request on cards the same write is going to drop. Tested — 8 sections queued, 2 requests made.
- Both screens special-case the code, because for it "tap again to carry on" is wrong *and* "we kept N cards"
  is false.
- `/ingest`'s catch-path `saveDeck` is wrapped. It could throw the same error a second time and abandon
  `handleGenerate` with no message at all — twenty chunks paid for and nothing on screen.

### Verified 09-05

509/509 tests across 32 files (`npm test` exit 0, +31 over 09-04's 478 — sourceKey 8, storage 11,
runChunksContinuous 12); `tsc --noEmit` clean; `eslint src` 0 errors and the same 12 pre-existing warnings;
`rm -rf .next && npm run build` exit 0 with `/api/account/usage` in the route manifest; the migration applied.

### Not verified

**None of it has run on the device.** That is §6 step 4, and it is the only thing standing between this commit
and being finished — the tests cover the runner's invariants, not that the recognition card appears when a
student re-drops the same PDF into a WebView.

---

## 10. The model swap orphaned every existing deck — found on the device 09-05

**A live production regression, not caused by §9.** Introduced by `72a69b0` plus setting `GROQ_FREE_MODEL`,
and live since that env var was set. Found within minutes of tapping the new button on real decks.

`src/app/api/ingest/route.ts` built its accepted-model enum from the *current* `FREE_MODEL`:

```ts
model: z.enum([FREE_MODEL, "gpt-4o", "claude-haiku-latest"]).default(FREE_MODEL),
```

A deck records what generated it (`Deck.model`) and a continuation replays that id — deliberately, so a PRO
deck is not silently finished on the free model. Every deck created before the swap therefore sends
`qwen/qwen3.6-27b` into an enum that no longer lists it. Measured against production from the device:

```
model: qwen/qwen3.6-27b    -> 400  Invalid option: expected one of
                                   "openai/gpt-oss-120b"|"gpt-4o"|"claude-haiku-latest"
model: openai/gpt-oss-120b -> 200  3 real cards
```

So **"Generate all N remaining sections" was dead on every book a student had already started** — on this
device, 402 sections and 1023 sections, the two decks the feature exists for. It fails in under a second, and
§2g's claim that "qwen remains the fallback" was not true in practice: the route rejected it before any
provider was reached.

§6's warning covered a *different* failure — the two env vars drifting from each other. Nobody was watching
the case where the enum has no room for the id it used to be.

**The fix.** `RETIRED_FREE_MODELS` in `src/lib/ai.ts`, and `acceptedModelIds()` feeding the schema:

- Nothing downstream needed changing, which is what makes it safe: `getProviderModel` ignores the requested
  Groq id and builds `FREE_MODEL` for every non-PRO request *and* for any unrecognised id on a PRO one, so a
  retired id runs on today's free model. `providerLabel` falls through to "Groq". `isProModel` correctly says no.
- The accepted set is built from `PRO_MODELS` instead of repeating `"gpt-4o"`/`"claude-haiku-latest"` as
  literals, so the schema can no longer drift from the plan gate.
- De-duplicated, because `FREE_MODEL` *is* a retired id whenever the env vars are unset — the local-dev default.
- **Append to `RETIRED_FREE_MODELS`, never remove.** An id dropped from it is a 400 on somebody's
  half-finished book, silent until they tap Continue.
- `/api/decks/[id]/shuffle` is not affected: it never takes a model from the client (`SHUFFLE_MODEL = FREE_MODEL`).
  `/api/ingest` is the only route with a client-supplied model enum.

**The general lesson worth carrying:** `Deck.model` is persisted client-side and replayed on every
continuation, so **every model id this app has ever shipped is part of the ingest route's input contract
permanently**. Swapping the free model is not a config change; it adds an id to support forever.

### What the device run confirmed before it hit this

- `/api/account/usage` works end to end from the APK against production: `plan PRO, used 5, limit 2000,
  remaining 1995`.
- The new library copy renders: "Generate all 402 remaining sections", "Generate all 1023 remaining sections".
- All four existing decks have `sourceKey: null`, so the no-backfill fallback is real on hardware. (§1's
  "2 decks" was stale — there are four.)
- The storage numbers in §6 step 5.

Everything downstream of the tap was tested once this reached production — §11.

### Clicking this app over CDP, for the next session

All three work on this WebView, contrary to §7's note about Playwright timing out: a synthetic
`MouseEvent{bubbles:true}`, `el.click()`, and `Input.dispatchMouseEvent` at the element's centre. Verified
against the session-length pills. The earlier "the click did nothing" was the click working perfectly — the
run started, 400'd in 922 ms, and the UI was back before a 2-second poll could see it. **Watch the console
and a patched `window.fetch`, not the DOM, for anything that can fail this fast.**

---

## 11. The device test — 2026-09-05, release APK on the CPH2001

Release APK, `DEVTOOLS=1`, cert `e1f4352f…bc09` verified before install, library survived. Driven over CDP
against production. Generation usage went 5 → 54 of 2000.

### Confirmed working

| | |
|---|---|
| Worker extraction | 444 pages in **~25 s**, real progress ("412 of 444 pages"), no frozen WebView |
| Type3 cipher recovery | Text came out clean English. Raw pdf.js on the same file gives `GLVDSSHDUHG` — a uniform −29 glyph offset — so the worker's recovery is doing real work |
| `/api/account/usage` | 200 from the APK, and the card renders it: "Your plan allows 1946 more sections this month - enough to finish this" |
| **Nothing spent before the choice** | `/api/ingest` calls after tapping Generate on a recognised source: **0**. The central guarantee |
| Recognition card | "63 cards · 5 sections left · last added today", matching the deck exactly |
| Continue from the card | 63 → 69 cards, 5 → 3 sections, **0 new library rows** |
| Batch persistence | Every run: cards +3 per section, `pendingChunks` down by exactly the sections consumed |
| Resume invariant | `after.pendingChunks[0] === before.pendingChunks[N]` on every run, with the following six lining up in order |
| Partial keep on failure | Part 12 of 20 exhausted its 3 attempts; the deck kept 33 cards from 11 sections and requeued from 12 — nothing paid for was discarded |
| Round trips | **5.3–7.9 s**, against 27–58 s before 09-04's work. §6 hoped for ~2.5 s; this deck runs on qwen, which is slower than gpt-oss-120b |
| Groq limits | **§5 is resolved.** The key now returns `limit-tokens: 250000`, `limit-requests: 500000` — Developer values, not the free tier's 8000/1000 |
| Both model env vars | The dropdown offers `openai/gpt-oss-120b` and `claude-haiku-latest`, and the route accepts the same — so §6 step 2 is answered: they are set and identical |

### Two defects found and fixed

**a) "Stop" ran on for three more sections.** `shouldStop` was polled only between batches, so a Stop during
section 2 of a 4-section batch still sent 3 and 4 — measured at **40 seconds and 12 more cards after the tap**,
under a button reading "Finishing this section". The comment justified this as "the requests in a batch in
flight are already paid for", which is true of the one in flight and false of the three after it: sending
those spends the allowance the student just asked us to stop spending.

`runChunks` now takes `shouldStop` and polls it **before each request**, never mid-flight. A batch that stops
early returns `failedAtIndex` at the first unsent section with `error: null`, and `runChunksContinuous` returns
`stoppedBy: "user"` from there rather than advancing `offset` by the batch length — which would have dropped
the unsent sections silently. Re-measured on the device: **0 requests after the tap**, run over in 7 s,
2 sections consumed, invariant intact.

**b) The recognition card's counts went stale.** It patched `pendingChunks` into its snapshot and left
`concepts` alone, so after continuing it read "**33** cards · 7 sections left" with 57 cards in the deck — and
would have said "Fully generated · 33 cards" at the end. It now reads the deck back from storage (the only
thing that knows what actually landed; adding `run.concepts` would be wrong the other way, since on a persist
failure those are cards the deck does not have), and the summary line is hidden while a run is going, because
it is a snapshot and the progress block is the live count.

### Two things left open

**gpt-oss-120b's 502s were not garbled JSON at all** — diagnosed and fixed, see §12.

**The allowance line is fine** — an earlier note here claimed it was timing-sensitive. It is not. The line
arrives about 1.6 s after the card, because `/api/account/usage` is fetched when the card mounts; a probe that
read the DOM in the same tick the card appeared simply missed it. Re-checked with the call log: one request,
200, and "Your plan allows 1923 more sections this month - enough to finish this" on screen.

### Storage, after the user deleted the obsolete deck

The 2.64M-char old-chunker Osho deck was tombstoned during the session, which is what §6 step 5 said would free
67% of the library. `flowrecall:savedDecks` is now **1,373,689 chars**, down from 3,915,306, so the quota is no
longer near. The analysis in §6 step 5 still holds for the next book — `pendingChunks` is the cost, one book is
~1.19M chars of it — but there is room again.

Live decks now: `Atisha Wisdom Slice` (69 cards, 3 pending, **the first deck on this device with a
`sourceKey`** — `1hzq:9itpyb1b0pxaz`), `wisdom` (98 cards, 386 pending), `KEY PROBE 14:49:34` (15), `Cardiac
cycle - lecture 4` (3).

---

## 12. The 502s were an envelope, not garbled JSON — fixed 2026-09-05

The "came back garbled" failures were the last thing still breaking a book upload: **5 of 26** ingest calls
across §11's runs, and on one run a section burned all three attempts and ended it at part 12 of 20 — 33 cards
instead of 60. §8 and §11 both guessed at structured outputs. Both were wrong about the cause.

### What it actually is

`/api/ingest` has three separate `retryable` 502s and the client shows the same "came back garbled" line for all
of them, so the message hid which one was firing. Probed by calling Groq directly with the app's real prompt on
real chunks off the user's book, then running each response through the exact three gates the route does
(`/tmp/garble-probe.ts`, bundled with esbuild):

```
  2 MODEL_SCHEMA   704tok stop   : Invalid input: expected object, received array
  6 MODEL_SCHEMA   780tok stop   : Invalid input: expected object, received array
 14 ok
```

`finish_reason: "stop"`, 704 and 780 output tokens against a 2400 cap, **valid JSON, complete and correct
cards**. `openai/gpt-oss-120b` simply returns a **bare array** instead of `{"concepts":[…]}` about one call in
eight. So:

- Nothing was garbled. `parseModelJson` parsed it fine.
- Nothing was truncated. The token-budget comment in the route is right and needs no change.
- It is not a quality-gate drop, and not a rate limit.
- The app threw away three good cards, **charged the student a generation request for them**, and reported a
  garble.

The prompt is not the lever: it already ends with a literal `{"concepts":[{…}]}` example, and the model
overrides it anyway.

### The fix

`ConceptsResponseSchema` now normalises the envelope with `z.preprocess`: a top-level array is lifted into
`{concepts: […]}`, anything else passes through unchanged. Nothing else is loosened — cards still go through
`RawConceptSchema` one at a time and an empty array is still a failure.

Placed on the schema rather than in either route because **both** `/api/ingest` and `/api/decks/[id]/shuffle`
validate with it, and shuffle asks for the larger response (`maxOutputTokens: 5200`).

**Measured after the fix: 24 of 24 calls succeeded**, against 2 failures in 16 before. (One of the 24 returned
2 cards rather than 3 — that is the prompt's own "return just that one card rather than padding with a
near-duplicate" instruction working, not a failure.)

### What this means for the original bug

The reported flashcard bug is fixed and verified end to end on the device — §11 and the full run below. This
was the last remaining way a book upload could still die partway through, and it was doing so at roughly a
1-in-15 rate: a section only fails after 3 consecutive bad calls, so at a ~13% per-call rate that is ~0.2% per
section and ~4-7% across a 20-section deck. It should now be effectively zero.

### The full run that proved the original bug fixed

Real 444-page Osho PDF, dropped into the release APK, before this envelope fix:

| | |
|---|---|
| Extraction | 444 pages in **21 s**, live page count, no freeze |
| Parts completed | **20 of 20** |
| Cards | **60** — the full 3-per-section yield |
| 429s | **zero** |
| 502s | 3, **all three recovered on retry** ("Part 6 came back garbled - retrying in 7s") |
| Total | **218 s** end to end |
| Deck | new row, `sourceKey: qdz7:12au8cr1gel0sj`, 399 sections queued, `openai/gpt-oss-120b` |
| Duplicate check | it did **not** match the old same-titled `wisdom` deck, which has no `sourceKey` — the no-backfill fallback behaving correctly on a real collision |

Against the original report — a frozen phone and a run that died at part 16 of 20 with 22 cards — and against
09-04's best measurement of 44 cards.

### Verified after this deployed

| | |
|---|---|
| Re-dropping the same 444-page PDF | Recognition card named the right deck — "wisdom · 60 cards · 399 sections left" — after 20 s of extraction, with **0 `/api/ingest` calls** and **0 new library rows** |
| Continuing it, 16 sections through the live route | **16 requests, 0 failures.** Cards 60 → 108 (+48, three per section), pending 399 → 383, 0 new rows, resume invariant intact |
| Direct-Groq probe after the fix | **64 of 64 clean** across two runs (24 + 40), against 2 failures in 16 before |

Before this fix, 16 requests would have expected about two failures.

### The one residual, and what would remove it

One call in ~40 still fails as `MODEL_UNPARSEABLE` — genuinely malformed JSON this time
(`Expected ',' or '}' after property value at position 2386`, `finish_reason: "stop"`, 875 tokens, so not
truncation). The likely cause is an unescaped `"` inside a string, and `sourceQuote` is the field most exposed
to it: it asks for a verbatim sentence from a book full of quotation marks.

Retries absorb it — at ~2.5% per call, three consecutive failures on one section is ~1 in 64,000 — so it costs
a wasted request, not a dead run.

**Removing it properly means `generateObject`, not a bigger regex.** Groq constrains decoding under
`response_format`, so `JSON.parse` cannot fail on structure. Measured 30 calls in each mode: both clean (too
small a sample to catch a 2.5% event), but json_object averaged **888 output tokens against 961** — 7.6%
cheaper on the field that is ~75% of the bill.

The AI SDK route to this is `generateObject` with a Zod schema, not a `response_format` flag on
`generateText`: `@ai-sdk/groq`'s provider options expose `structuredOutputs` and `strictJsonSchema`, which
apply to `generateObject`. So it is the change §8 describes — delete `parseModelJson` and the three 502s from
all seven routes — and it carries the risk §2g warns about, where a provider-options mistake is a hard 400 on
every request in the app. **Worth doing deliberately, with the same route-by-route verification §4 used, not
as a quick follow-up.**

Note `ConceptsResponseSchema` is now a `z.preprocess`, which `generateObject` cannot convert to a JSON schema.
That refactor needs the plain object schema for generation and keeps the tolerant one for validating whatever
comes back.
