# FlowRecall

**Turn any PDF or notes into a swipeable, AI-generated study feed — with accounts, subscriptions, and daily streaks.**

FlowRecall ingests your study material (PDF or pasted text), uses an LLM to break it into bite-sized concepts, and serves them back as an interactive feed: swipe challenges, fill-in-the-blank questions, and an AI chat that grades your answers. Finish a session, keep your streak alive.

<!-- TODO: replace with your live URL -->
🔗 **Live demo:** [flow-recall.vercel.app](https://flow-recall.vercel.app)

<!-- TODO: add 2-3 screenshots or a GIF here -->
<!-- ![Study feed](docs/screenshots/feed.png) -->

## Features

- **AI ingestion** — drop a PDF (parsed client-side with pdf.js) or paste text; the server generates a structured concept feed via LLM with Zod-validated output.
- **Interactive study feed** — TikTok-style vertical feed of concept cards, swipe challenges, fill-in-the-blank, and a chat challenge graded by AI.
- **Multi-model AI routing** — a single `getProviderModel(plan, requestedModel)` engine routes requests across **Groq (Llama 3.1)**, **OpenAI (GPT-4o)**, and **Anthropic (Claude 3.5 Sonnet)** based on the user's subscription plan, using the Vercel AI SDK.
- **Auth** — Auth.js (NextAuth) v5 with a credentials provider, bcrypt password hashing, and JWT sessions.
- **Subscriptions** — Stripe Checkout (hosted) with signature-verified webhooks that upgrade the user's plan on `checkout.session.completed`. Free and Pro tiers.
- **Server-side plan enforcement** — the API re-reads the user's plan from the database on every gated request; a stale or tampered JWT can never unlock paid models.
- **Gamification** — daily study streaks computed by calendar-day logic, surfaced in the navbar with a fire micro-animation, plus confetti on session completion.

## Tech stack

| Layer | Tech |
|---|---|
| Framework | Next.js 16 (App Router) · React 19 · TypeScript |
| AI | Vercel AI SDK v7 · Groq · OpenAI · Anthropic |
| Auth | Auth.js (NextAuth) v5 · bcrypt · JWT sessions |
| Database | Prisma 6 · PostgreSQL (SQLite in local dev) |
| Payments | Stripe (subscriptions + webhooks) |
| UI | Tailwind CSS 4 · Motion · neobrutalist design system |
| Testing | Playwright (behavior-verified flows) |

## Architecture notes

- **Plan-based model gating.** The FREE tier is pinned to Groq's `llama-3.1-8b-instant`; PRO unlocks GPT-4o and Claude 3.5 Sonnet. The client dropdown is cosmetic — authorization happens server-side in `/api/ingest` (401 unauthenticated, 403 for a free user requesting a Pro model).
- **Fresh-from-DB authorization.** `plan` is cached in the JWT for cheap UI gating only; every server decision re-queries the database, so billing state is always authoritative.
- **Resilient webhooks.** The Stripe webhook verifies signatures on the raw body (`constructEventAsync`) and uses `updateMany` so a missing user is a no-op rather than a retry loop.
- **Build-safe integrations.** The Stripe client is a lazy server-only singleton, so `next build` succeeds without production secrets.

## Running locally

```bash
git clone https://github.com/v1n33shh/Flow-Recall.git
cd Flow-Recall
npm install
cp .env.example .env   # then fill in the values below
npx prisma migrate dev
npm run dev
```

### Environment variables

| Variable | Purpose |
|---|---|
| `DATABASE_URL` / `DIRECT_URL` | Postgres connection (Neon/Supabase pooled + direct) |
| `AUTH_SECRET` | Auth.js JWT signing secret (`npx auth secret`) |
| `GROQ_API_KEY` | Free-tier model (required) |
| `OPENAI_API_KEY` | Pro tier — GPT-4o (optional) |
| `ANTHROPIC_API_KEY` | Pro tier — Claude (optional) |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` / `STRIPE_PRICE_ID` | Subscriptions (optional for local dev) |

## Roadmap

- Unify the study-time grader onto the server-side AI engine
- Subscription lifecycle handling (cancellations / downgrades)
- Spaced-repetition scheduling for concept review

---

Built by [Vineesh](https://github.com/v1n33shh) — Next.js · AI integration · full-stack SaaS.
