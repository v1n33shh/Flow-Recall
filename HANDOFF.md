# FlowRecall — Handoff

Status as of this handoff: **Full SaaS layer added on top of the original app — user accounts, server-side multi-model AI, Stripe Pro subscriptions, and daily-streak gamification.** The sections in this doc from "## What FlowRecall is" onward describe the earlier **BYOK / account-less** era and are retained for history and product context, but several of their claims (no accounts, "No env vars," client-supplied Groq key for ingestion, `resolveIngestModel → llama-3.3-70b-versatile`) are now **superseded** — see the section immediately below, which is the authoritative description of the current state. Verified end-to-end in-browser (Playwright), including a 13/13 streak-flow pass. Still not committed to git (no repo initialized) and no standing automated test suite.

---

## CURRENT STATE — Accounts, Multi-Model AI, Payments & Gamification (post-Jul-2)

Four productization phases were built on top of the BYOK app described below. Each was typechecked (`tsc --noEmit`), linted, and behavior-verified.

### Phase 1 — Auth & Database
- **NextAuth / Auth.js v5** (`next-auth@5 beta`) with a **Credentials** provider (email + password, bcrypt) — no external OAuth. **JWT session strategy** (Credentials can't use DB sessions). Config in `src/auth.ts`; route handler at `src/app/api/auth/[...nextauth]/route.ts`; registration at `src/app/api/auth/register/route.ts`.
- **Prisma 6** + **SQLite for local dev** (`prisma/dev.db`); the `.env.example` connection string targets Postgres/Supabase for prod. `src/lib/prisma.ts` is the hot-reload-safe singleton. `prisma.config.ts` loads `.env` via `import "dotenv/config"` (Prisma no longer auto-loads it).
- `User` model carries `password?`, `plan @default("FREE")`, and (added later) `currentStreak`/`lastStudyDate`, plus the four Auth.js adapter models.
- Pages: `/login`, `/register` (auto-signs-in after register), `/account` (server component, reads plan from DB).

### Phase 2 — Multi-model AI engine (`src/lib/ai.ts`)
- **`getProviderModel(plan, requestedModel)`** routes by plan: `FREE` → **Groq `llama-3.1-8b-instant`** (requested model ignored); `PRO` → **OpenAI `gpt-4o`** or **Anthropic `claude-3-5-sonnet-20240620`** (unknown/llama falls back to Groq). Added `@ai-sdk/openai@4` + `@ai-sdk/anthropic@4` alongside `@ai-sdk/groq@4`.
- **All AI keys are now server-side env vars** (`GROQ_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`) — the ingest route no longer accepts a client-supplied key. This is a change from the BYOK model described below. (⚠️ **`resolveIngestModel`/`llama-3.3-70b-versatile` no longer exists**; the FREE model is now the smaller `8b-instant` per spec — a quality trade-off for ingestion worth revisiting.)
- `/api/ingest` now: requires login (`auth()`, 401 otherwise), reads `plan` **fresh from the DB** (never trusts the client or the possibly-stale JWT), enforces the Pro gate **server-side** (403 for a FREE user requesting a Pro model), then routes via `getProviderModel`. Request body is `{ text, model }` (no `apiKey`).
- `/ingest` page: gated on login; **Neobrutalist model dropdown** (Llama 3 / Claude 3.5 Sonnet / GPT-4o); disables Generate + shows a red "You need a Pro subscription to use this model." warning when a FREE user picks a Pro model.
- **The one remaining BYOK path:** `/api/grade` (study-time grader) still uses the client's Groq key from Settings/localStorage (`useStoredApiKey`). Intentionally out of scope for these phases; worth unifying later.

### Phase 3 — Stripe subscriptions
- `stripe@22` + `@stripe/stripe-js@9`. `src/lib/stripe.ts` = lazy server-only singleton (`getStripe()`), so `next build` doesn't crash on a missing key.
- `POST /api/stripe/checkout`: login-gated; creates a **`mode: "subscription"`** Checkout Session with **`client_reference_id = user.id`**, `customer_email`, and origin-derived success/cancel URLs; returns the hosted `url`.
- `POST /api/stripe/webhook`: `runtime = "nodejs"`, reads the **raw body**, verifies the signature via **`constructEventAsync`** (400 on bad/missing signature); on **`checkout.session.completed`** does `prisma.user.updateMany({ where: { id: client_reference_id }, data: { plan: "PRO" } })` (updateMany so a missing user is a no-op, not a throw/retry-loop).
- `/pricing` page (Neobrutalist, Free $0 / Pro $10/mo) — "Upgrade Now" sends anon users to `/login`, else starts checkout and `window.location.href = url`. Navbar gained a **Pricing** link.
- **`@stripe/stripe-js` is effectively unused**: v9 removed `redirectToCheckout`, so the hosted-URL redirect is used instead (Stripe's current recommendation). Installed per request; only needed if you later adopt Embedded Checkout/Elements.
- Not done: no `customer.subscription.deleted`/downgrade handling, no `stripeCustomerId`/`subscriptionId` columns. The page's "$10" is display text — the real charge comes from `STRIPE_PRICE_ID`.

### Gamification — daily study streaks
- `User.currentStreak Int @default(0)` + `User.lastStudyDate DateTime?` (added via `prisma db push`).
- **`POST /api/study/track`** (login-gated) advances the streak by **calendar-day** comparison (local-midnight normalized): same day → no change; yesterday → `+1`; 2+ days ago or `null` → reset to `1`; always stamps `lastStudyDate = now`. Returns `{ currentStreak }`.
- Streak reaches the UI via the **JWT/session** (`session.user.currentStreak`, same pattern as `plan`). **Navbar** renders the existing `StreakCounter` next to Account (fire-glow micro-animation at streak ≥ 3, already built in the component).
- **`CompletionSlide`** already fired confetti (`canvas-confetti`, already a dep) on first viewport-enter; it now *also* calls `/api/study/track` and pushes the new value via `useSession().update({ currentStreak })`, which the `jwt` callback merges on `trigger === "update"`.
- **Caveat:** the navbar streak lives in the JWT, so it only refreshes at **login** or **after a completed study session** — a missed-day decay isn't reflected in the navbar until the next login/session (the DB value is always correct).

### Session / JWT plumbing (`src/auth.ts`, `src/types/next-auth.d.ts`)
- `plan` and `currentStreak` are seeded into the token at sign-in (from the `authorize` return) and exposed on `session.user`. Type augmentation lives in `src/types/next-auth.d.ts`.
- **Security note:** the JWT copy of `plan` is only for cheap UI gating. Every server-side authorization decision (`/api/ingest` Pro gate) re-reads `plan` **from the DB**, so a stale token or a tampered request can't unlock paid models.

### New / changed files since the Jul-2 handoff
```
src/auth.ts                            NextAuth v5 config (Credentials, JWT, plan+streak callbacks)
src/types/next-auth.d.ts               Session/User/JWT augmentation (id, plan, currentStreak)
src/lib/prisma.ts                      Prisma singleton
src/lib/stripe.ts                      lazy server-only Stripe client
src/lib/ai.ts                          NOW: getProviderModel + isProModel + providerLabel (multi-provider)
prisma/schema.prisma, prisma.config.ts, prisma/dev.db, prisma/migrations/
src/app/login|register|account|pricing/page.tsx
src/app/api/auth/[...nextauth]/route.ts, src/app/api/auth/register/route.ts
src/app/api/stripe/checkout/route.ts, src/app/api/stripe/webhook/route.ts
src/app/api/study/track/route.ts       streak logic
src/components/Navbar.tsx              + Pricing link + StreakCounter
src/components/CompletionSlide.tsx     + streak track call + session update
src/app/ingest/page.tsx                login gate + model dropdown + Pro gating
```

### Environment variables (this REPLACES the "No env vars" claim below)
Real values go in `.env` (gitignored); placeholders/docs in `.env.example`.
```
DATABASE_URL          SQLite file:./dev.db locally; Postgres URL in prod
AUTH_SECRET           npx auth secret
GROQ_API_KEY          FREE-tier + the /api/grade BYOK fallback  (a real key is present in .env now)
OPENAI_API_KEY        PRO: gpt-4o
ANTHROPIC_API_KEY     PRO: claude-3-5-sonnet-20240620
STRIPE_SECRET_KEY     Stripe API key
STRIPE_PRICE_ID       recurring $10/mo Pro Price id (price_...)
STRIPE_WEBHOOK_SECRET whsec_... for /api/stripe/webhook
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY   optional (unused by the hosted-URL flow)
```

### ⚠️ Operational gotcha (cost real time during testing)
**After a `prisma db push` / schema change, RESTART the dev server.** Next.js watches source but **not** `node_modules`, so a `next dev` process started before the Prisma client was regenerated keeps the old in-memory client — new columns (`currentStreak`) then throw and the route returns **500** even though the code is correct. Symptom: a route that passes an isolated DB test but 500s in the running app. Fix: restart `npm run dev`.

### Verification done this session
- **Multi-model routing:** all six `(plan, model)` combinations return the correct provider/model.
- **Stripe:** valid webhook signature accepted + `client_reference_id` extracted; tampered signature rejected; FREE→PRO DB upgrade confirmed.
- **Streak flow (end-to-end Playwright against the running app, 13/13):** unauth `track` → 401; fresh session `currentStreak = 0`; completing a study session fires confetti + `track` → streak `1`; simulated yesterday-visits → `2` then `3`; same-day repeat stays `3`; DB persists `3`; navbar shows `🔥 3` with fire styling after re-login. Screenshots captured.
- Note this partially updates the old "never tested against a real Groq key" caveat: a **real `GROQ_API_KEY` is now in `.env`**, so FREE-tier ingestion can be exercised for real (OpenAI/Anthropic/Stripe keys are still placeholders).

---

## What FlowRecall is

An active-recall study app that (1) turns pasted notes or a dropped PDF into micro-concepts via an LLM, and (2) serves them back as a TikTok-style vertical swipe feed instead of a traditional flashcard deck, with difficulty that adapts per-concept based on how the user does (D.I.E. — Dynamic Interaction Escalation). Built mobile-first: the primary user is a student on a phone.

Full product spec lives in the original blueprint the user provided (not stored in this repo) — the short version: zero-friction ingestion, infinite-scroll recall UI, and a difficulty system that never lets the user feel stuck.

**Architecture history, for context — this repo has been through three backends:**
1. **Multi-provider BYOK** (Google Gemini / OpenAI, user's choice) via Next.js API routes + Vercel AI SDK.
2. **Fully local, on-device inference** via `@mlc-ai/web-llm` + WebGPU — no backend, no API key, no network calls after the model download. This was scrapped because **most students use phones, and phone GPUs/browsers can't reliably run even a small local LLM** — the whole premise only worked on a capable desktop.
3. **Current: Groq BYOK.** Groq's free tier requires no credit card and its LPU-based inference is fast enough that server round-trip latency stops being the bottleneck — it's the sweet spot between "actually free and frictionless" (unlike a paid backend) and "actually works on a phone" (unlike local inference). The backend is intentionally the *same shape* as chapter 1 (Next.js API routes + `generateObject`), just pointed at one provider instead of a toggle between two — see `src/lib/ai.ts`.

There is no more `useLocalAI` hook, no more `LocalAiBoot`/`LocalAiStatus` components, no more `Provider` type/toggle (Groq is the only option, so Settings just asks for one key).

## Stack

- Next.js 16.2.10 (App Router, Turbopack) + React 19.2 + TypeScript
- Tailwind CSS v4
- `motion` v12 (the renamed/current Framer Motion package — import from `"motion/react"`, not `"framer-motion"`)
- Vercel AI SDK v7 (`ai`, `@ai-sdk/groq`) — `generateObject` against Groq's OpenAI-compatible API
- Zod — validates the model's JSON output (both as the AI SDK's structured-output schema and again client-side isn't needed anymore since validation happens server-side before the client ever sees it)
- `react-dropzone` v15 for the PDF drop zone (tap-to-upload primary, drag-and-drop as a bonus on desktop)
- `pdfjs-dist` v6.1.200 for client-side PDF text extraction

**Heads up for future work in this repo:** this scaffold is on Next.js 16, newer than typical model training data. The project's own `AGENTS.md`/`CLAUDE.md` point at `node_modules/next/dist/docs/` — read those (or the installed package's `.d.ts` files) before assuming an older API shape. Same goes for `@ai-sdk/groq` — it's a real, current, first-party AI SDK provider package (not a hand-rolled OpenAI-compatible shim), check `node_modules/@ai-sdk/groq/dist/index.d.ts` for its actual `GroqChatModelId` union before hardcoding a model name, since Groq's available models change over time.

## Running it

```bash
cd ~/Desktop/Flowrecall
npm run dev       # http://localhost:3000, Turbopack
npx tsc --noEmit  # typecheck
npm run lint      # eslint (react-hooks v6 rules are strict here, see gotchas below)
```

⚠️ **Superseded** — env vars ARE now required (accounts, DB, server-side AI keys, Stripe). See "Environment variables" in the CURRENT STATE section above for the full list, and remember to **restart the dev server after any `prisma db push`**. (The original BYOK-via-Settings key still applies only to the `/api/grade` grader.) `npx prisma db push` syncs the SQLite schema; a real `GROQ_API_KEY` is now present in `.env`, so FREE-tier ingestion can finally be tested for real.

`playwright` + a Chromium binary are installed as dev dependencies. There's no `chromium-cli` available in this environment, so verification was done with ad-hoc Playwright driver scripts (written to the project root, run with `node`, then deleted — none are currently checked in). For mobile verification specifically, use Playwright's device emulation: `chromium.launch()` + `browser.newContext({ ...devices["iPhone 13"] })` gives a real mobile viewport, touch-capable context, and mobile UA — this is how the mobile-optimization pass in this handoff was verified. **Caveat**: this still isn't a *real* touch device — Playwright's emulated touch doesn't perfectly replicate iOS/Android gesture disambiguation (e.g. the horizontal-swipe-inside-vertical-scroll-feed interaction in `SwipeChallenge`). That specific interaction follows Framer Motion's own documented pattern for this exact scenario (`drag="x"` inside a scrollable container) and looks structurally correct, but hasn't been felt on a real phone.

## File map

```
src/app/
  page.tsx                 landing page - CTAs to /settings and /ingest
  layout.tsx                root layout, forces dark mode, sets mobile viewport (see below), mounts <Navbar>
  globals.css               dark theme tokens + .no-scrollbar utility
  settings/page.tsx         BYOK: single Groq API key field, link to console.groq.com/keys, localStorage only
  ingest/page.tsx           paste-text or PDF-drop dashboard -> POST /api/ingest -> concept cards -> "Start studying"
  study/page.tsx            reads the handed-off deck, renders <StudyFeed> or an empty state
  api/ingest/route.ts       text -> concepts (generateObject against Groq), assigns crypto.randomUUID() ids
  api/grade/route.ts        LLM-graded free-recall check for the chat challenge

src/components/
  Navbar.tsx                "Ingest" + "Settings"; hidden entirely on /study for full-bleed immersion; safe-area-aware
  StudyFeed.tsx             the queue/mastery/retry engine - see D.I.E. section below
  FeedSlide.tsx             per-slide chrome (concept label, Retry badge, level pill) + switches on level; safe-area padded
  SwipeChallenge.tsx        Level 1 - draggable true/false judgment
  FillBlankChallenge.tsx    Level 2 - cloze sentence with inline input
  ChatChallenge.tsx         Level 3 - free-text answer, graded via /api/grade
  CompletionSlide.tsx       end-of-deck celebration slide
  PdfDropzone.tsx           tap-to-upload PDF zone (drag-and-drop still works on desktop); extracts text client-side

src/lib/
  types.ts                  Concept (id, concept, question, answer, distractor, cloze)
  storage.ts                localStorage API-key helpers + sessionStorage deck handoff, all via useSyncExternalStore
  ai.ts                     resolveIngestModel/resolveGradeModel (Groq, see model choice below) + getFriendlyErrorMessage
  conceptSchema.ts          zod schema describing the concept-generation output, shared by the ingest route

scripts/
  copy-pdf-worker.mjs       postinstall: copies pdfjs-dist's worker build into public/, version-matched automatically

public/
  pdf.worker.min.mjs        vendored pdf.js worker (regenerated by the postinstall script, don't hand-edit; excluded
                            from eslint in eslint.config.mjs since it's a minified third-party file, not app code)
```

## Groq backend (`src/lib/ai.ts` + the two API routes)

Two different models are used deliberately, not the same one everywhere:

- **`resolveIngestModel` → `llama-3.3-70b-versatile`**: used by `/api/ingest`. Content quality matters most here (writing good questions, plausible distractors, cloze sentences that actually work) — the larger model is meaningfully better at this, and Groq's inference speed means "larger model" doesn't cost as much latency as it would on a typical GPU-based cloud API.
- **`resolveGradeModel` → `llama-3.1-8b-instant`**: used by `/api/grade`. Grading is a simpler lenient-judgment task, and speed matters more here since it's in the feedback loop *during* studying — a snappy response feels better than a marginally smarter one.

`getFriendlyErrorMessage(error)` classifies AI SDK errors (via `APICallError.isInstance()` and its `statusCode`, with message-content matching as a fallback) into three actionable buckets — invalid key (401), no access (403), rate-limited (429) — each with Groq-specific wording, e.g. "Double-check it in Settings" / "Wait a bit and try again." This is a straight port of the same mechanism built for the original Google/OpenAI BYOK version, simplified to a single provider.

## Data model

Every `Concept` is generated in one ingest pass with everything needed for **any** difficulty level, so D.I.E. can freely move a concept between levels without a second API call:

```ts
type Concept = {
  id: string;
  concept: string;      // short label, e.g. "Mitochondria"
  question: string;     // recall question
  answer: string;       // correct answer
  distractor: string;   // plausible wrong answer, powers the Level 1 swipe
  cloze: string;        // sentence with "_____" where the answer goes, powers Level 2
};
```

`id` is assigned server-side in `/api/ingest/route.ts` via `crypto.randomUUID()` after `generateObject` returns.

## Ingestion flow (`/ingest`)

1. User pastes text or drops/taps to upload a PDF (`PdfDropzone` extracts it client-side via `pdfjs-dist` — the raw PDF bytes never leave the browser, only the extracted text is ever sent anywhere).
2. Text is capped at `MAX_INPUT_CHARS = 20000` characters with a visible note if truncated — this is now a **practical/cost sanity limit**, not a hard model constraint like it was with the old local Phi-3-mini (Groq's Llama 3 models have a much larger context window). No chunking/map-reduce for longer documents.
3. `POST /api/ingest` with `{ text, apiKey }` → Zod-validated `generateObject` call against `llama-3.3-70b-versatile` → array of `Concept`.
4. Dropping a PDF auto-fires generation immediately after extraction, same as manual paste + click.

## Phase 2 — Infinite Study Feed

- `StudyFeed` renders a `snap-y snap-mandatory` full-bleed vertical scroller (`fixed inset-0`, no navbar), now with `env(safe-area-inset-top)` padding on the progress bar so it doesn't render under an iPhone notch/Dynamic Island.
- `CompletionSlide` appears after the last item: small radial particle-burst animation, "Deck complete", link back to `/ingest`.
- Progress bar at the top of the feed, driven by mastery (see D.I.E. below), not raw scroll position.

## Phase 3 — Micro-interactions

Three challenge components, one per concept's assigned level, swapped in by `FeedSlide`:

- **`SwipeChallenge` (Level 1)**: shows the question + one candidate answer (either the real `answer` or the `distractor`, chosen via `useState(() => Math.random() < 0.5)` at mount). Drag left/right (Framer Motion `drag="x"`) or tap ✕/✓ buttons (56px, well above the 44px minimum touch-target guideline) to judge true/false.
- **`FillBlankChallenge` (Level 2)**: splits `concept.cloze` on `"_____"`, renders an inline `<input>` in the gap. No model call - purely local string comparison, exact-match/case-insensitive/trimmed.
- **`ChatChallenge` (Level 3)**: free-text `<textarea>`, graded by `POST /api/grade` (LLM judges semantic correctness leniently, not exact string match). Gated behind having an API key.

All three accept `onAnswered(correct: boolean)` — this is the hook D.I.E. uses to react to outcomes.

## Phase 4 — D.I.E. (Dynamic Interaction Escalation)

This is the part that makes the feed adaptive rather than just varied. Implemented entirely in `StudyFeed.tsx` + a small `onViewportLeave` wire in `FeedSlide.tsx`.

**Data structure**: `StudyFeed` holds a `QueueItem[]` (`{key, concept, level, attempt}`) in state, seeded from the initial concepts round-robin (level = `index % 3 + 1`). This queue is **mutable at runtime** — it's not the same as the static concepts array.

**Outcome plumbing**: each challenge component fires `onAnswered(correct)` on submit. `FeedSlide` also wires `onViewportLeave` (Framer Motion) on the slide's wrapping `<motion.section>` — if a slide scrolls out of view without the user ever answering it, that counts as `"skipped"`. Both paths funnel into a single `resolve(item, outcome)` in `StudyFeed`.

**The escalation rule**: on `"incorrect"` or `"skipped"`, look up the item's current level; if it's above 1, splice a new queue item for the *same concept* at `level - 1`, inserted `~3` slides ahead of wherever the failed item currently sits (`RETRY_OFFSET = 3`). If already at Level 1, do nothing — no infinite retry loop. On `"correct"`, add the concept's id to a `masteredIds` set (no requeue).

**Guards that matter**:
- `resolvedKeys` (a `Set` in a `useRef`) ensures each queue item resolves exactly once.
- `currentIndexRef` tracks roughly where the user is in the feed so an async grading result can't insert a retry *behind* where they already are.
- Retry items get a **"Retry" badge** in `FeedSlide`'s header so the adaptation is visible to the user, not mysterious repetition.

**Progress bar semantics**: tracks `masteredIds.size / totalConcepts`, not raw scroll position.

**Design decision worth flagging**: the blueprint's D.I.E. example specifically calls out Level 3 failures triggering a downgrade. I implemented the downgrade generically for *any* level failing (2→1 too).

**Known limitation, not yet handled**: if a Level 1 retry also fails, the concept is simply never marked mastered — no spaced-repetition-style resurfacing, no retry cap.

## Mobile optimization pass

This was a dedicated requirement, not incidental — the target user is a student on a phone, so this got real attention rather than being an afterthought:

- **Viewport config** (`src/app/layout.tsx`, Next.js's `export const viewport: Viewport`, not the old `<meta>`-in-`metadata` approach which is deprecated in this Next.js version): `viewportFit: "cover"` (required for `env(safe-area-inset-*)` to resolve to non-zero values at all — without it, iOS reports 0 for all of them), plus `maximumScale: 1, userScalable: false` to prevent accidental pinch-zoom disrupting the swipe-gesture-heavy feed (the same trade-off TikTok/Instagram make; there's a real accessibility cost to disabling zoom, worth revisiting if that matters for this audience).
- **Safe-area insets**: `Navbar`, `StudyFeed`'s progress bar, and `FeedSlide` all pad for `env(safe-area-inset-top)` / `env(safe-area-inset-bottom)` so content doesn't render under a notch/Dynamic Island or get obscured by the home-indicator gesture bar.
- **iOS auto-zoom-on-focus prevention**: every text input across the app (`Settings`'s key field, `/ingest`'s textarea, `ChatChallenge`'s textarea) uses `text-base` (16px) or larger. iOS Safari auto-zooms the viewport when focusing an input with a computed font-size under 16px — a very common, easy-to-miss mobile web bug. `FillBlankChallenge`'s inline `<input>` relies on inheriting its parent `<p>`'s `text-lg`, which Tailwind's preflight allows via `font: inherit` on form elements.
- **Touch targets**: buttons across the app were audited and bumped to real thumb-friendly sizes — the primary CTAs on `/ingest` and the landing page go full-width with `py-3.5`/`min-h-12` on mobile (collapsing to a compact desktop size at the `sm:` breakpoint), `SwipeChallenge`'s ✕/✓ buttons are 56px, and all interactive elements get `active:scale-*` for tactile tap feedback (mobile has no `:hover`, so relying on hover states alone leaves touch users with zero feedback).
- **`PdfDropzone` copy flipped to mobile-first**: previously led with "Drag & drop a PDF here, or click to browse." Drag-and-drop isn't a mobile gesture, so the primary line is now "Tap to upload a PDF," with "or drag and drop" as a secondary line that's simply irrelevant-but-harmless on a phone and still accurate on desktop. The underlying interaction didn't need to change — `getRootProps()`'s click handler already opens the native file picker on any device, including the "Photos/Files" picker on iOS/Android.
- **`SwipeChallenge`'s `drag="x"` inside `StudyFeed`'s vertical `snap-y` scroll**: this is Framer Motion's own documented pattern for a horizontally-draggable element inside a vertically-scrollable container — constraining `drag` to a single axis is what lets native vertical scroll and the JS-driven horizontal swipe coexist without a custom gesture-arbitration layer. Verified structurally (correct props, no `touch-action` conflicts introduced) but not felt on a real touch device — see the caveat in "Running it."

## Gotchas hit and fixed during development (useful context, not just history)

1. **`useSyncExternalStore` + `JSON.parse` = infinite render loop.** Returning a freshly-parsed object/array from `getSnapshot()` (or `getServerSnapshot()`) on every call gives React a new reference each time even when the underlying value hasn't changed, and `useSyncExternalStore` compares by reference — infinite re-render. Fix: cache the parsed result keyed on the raw string, or return a stable module-level constant for server snapshots. Hit this twice independently in this codebase (once in `storage.ts`, once in the now-removed `useLocalAI.ts`) — any new `useSyncExternalStore` usage needs this checked up front.
2. **`react-hooks/set-state-in-effect` is enforced here** (strict rule bundled with this Next/eslint-config-next version) **and it traces into called functions, not just literal inline `setState` calls** — calling a separately-defined function from inside a `useEffect` that itself calls `setState` still gets flagged, even though the call isn't textually inside the effect body. The robust fix used throughout this codebase: read external state (`localStorage`, an async engine's readiness) via `useSyncExternalStore` or an internally-awaited promise, not via effect-driven `setState`.
3. **`jsx-a11y/aria-proptypes` false-positives on `aria-label="True"` / `aria-label="False"`.** The linter seems to confuse literal strings `"True"`/`"False"` with boolean-typed ARIA props. Sidestepped with more descriptive labels (`"Mark as true"` / `"Mark as false"`).
4. **Monkey-patching `Math.random` to make a test deterministic broke Framer Motion's drag/click handling entirely.** Framer Motion appears to use `Math.random()` internally for gesture/instance bookkeeping. Don't patch global `Math.random` in tests touching any `motion.*` component with `drag` enabled — read the actually-rendered content to decide what to click instead.
5. **All feed slides are mounted simultaneously** (no virtualization — deliberate, for a smooth native `scroll-snap` feed). Unscoped Playwright selectors silently match the *first* matching element in DOM order regardless of scroll position. Scope queries per-slide, e.g. `page.locator("section").nth(i)`.
6. **JSX text spacing**: text like `all {total} concepts` occasionally rendered with a missing space despite the source clearly having one. Reliably fixed with a template literal instead of adjacent JSX text/expression children.
7. **Spreading `getRootProps()` (react-dropzone) directly onto a `motion.div` fails to typecheck** — its native DOM event handler props (e.g. `onAnimationStart`) collide with Framer Motion's own special-cased prop of the same name. Fix: keep `{...getRootProps()}` on a plain `<div>`, nest the animated `motion.div` inside it.
8. **ESLint choked on a vendored file** after copying `pdf.worker.min.mjs` (~1.2MB minified) into `public/`. Fixed via `globalIgnores` in `eslint.config.mjs`.
9. **Screenshot-timing false alarms**: a Playwright screenshot taken immediately after `page.goto(..., {waitUntil: "networkidle"})` can catch an entrance animation mid-fade, making a component look empty. `networkidle` doesn't wait for CSS/JS animations — add a short `waitForTimeout` or `waitForSelector` first.
10. **Groq's model catalog is a real, current `GroqChatModelId` union in `@ai-sdk/groq`'s types** (`llama-3.3-70b-versatile`, `llama-3.1-8b-instant`, etc.) — checked directly against `node_modules` rather than assumed, since Groq's available models are known to change/deprecate over time.

## What's NOT done yet

> Also see the caveats in the CURRENT STATE section: Stripe has no cancellation/downgrade handling or `stripeCustomer`/`subscription` columns; `@stripe/stripe-js` is installed but unused; the navbar streak (JWT-backed) only refreshes at login or after a session; `/api/grade` is still the lone client-BYOK path; and FREE-tier ingestion was downgraded from `70b-versatile` to `8b-instant`.

- No git repository initialized for this project yet — nothing has been committed.
- No automated test suite — all verification so far has been manual, ad-hoc Playwright driver scripts written and discarded per session, plus `tsc --noEmit` / `eslint`.
- **Never tested against a real, working Groq API key.** Both `/api/ingest` and `/api/grade` have only been verified for their error paths (missing/invalid key) via curl and via the browser with a fake key — this is the single most important thing to try next.
- **Never tested on a real mobile device.** Verified via Playwright's `devices["iPhone 13"]` emulation (real mobile viewport, touch-capable context) but not felt on actual hardware — the `SwipeChallenge` drag-vs-vertical-scroll interaction in particular deserves a real-device pass.
- No chunking for long source material — text over 20,000 characters is silently truncated (with a visible note) rather than processed in multiple passes.
- **Partial server-side persistence.** Accounts, `plan`, and `currentStreak`/`lastStudyDate` now persist in the DB (Prisma/SQLite). But **decks and study progress are still client-only** — saved decks live in `localStorage`, the study handoff in `sessionStorage`. No server-side storage of decks, per-concept study history, or spaced-repetition scheduling across devices.
- PDF ingestion only accepts PDFs with real text - no OCR fallback for scanned/image-only PDFs, and no other file types (docx, pptx, images).
- No multiple-choice variant of Level 1 (blueprint says "Tinder-style Swiping (True/False) **or** Multiple Choice" — only the swipe/true-false half is built).
- No handling for a Level 1 concept that keeps failing repeatedly (see D.I.E. limitation above).
- `userScalable: false` disables pinch-to-zoom app-wide for gesture-conflict reasons — worth revisiting for accessibility if that's a concern for this audience.
