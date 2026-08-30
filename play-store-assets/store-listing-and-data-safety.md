# Play Store submission reference

Drafted from a direct read of the actual codebase (auth, billing, storage) on 2026-08-23,
not guessed. This replaces an earlier draft from a prior session that was discussed in
conversation but never saved to a file, and was lost. **Verify against Play Console's
current form wording before submitting** — categories/wording can change, and this is a
reference to work from, not a substitute for your own read of the policy.

## Data Safety form

### Does your app collect or share any of the required user data types?
Yes.

### Personal info
- **Name** — collected (Google OAuth profile, or optional name field on email signup). Used for account functionality. Not shared with third parties beyond the auth/billing processors below.
- **Email address** — collected (required for login). Used for account functionality and account management. Not shared for advertising/marketing.
- **User IDs** — collected (internal account ID). Used for account functionality.

### Financial info
- **Purchase history / other financial info** — collected indirectly: Stripe and Razorpay (payment processors) hold subscription/customer IDs and payment status. **FlowRecall's own servers never receive or store raw card numbers** — Stripe/Razorpay handle card data entirely on their own PCI-compliant systems. Only a customer/subscription ID and plan status are stored on FlowRecall's side.

### Messages / Photos and videos / Audio
- Not collected. No messaging feature, no camera/mic access requested (AndroidManifest only declares the `INTERNET` permission).

### Files and docs
- **User-uploaded study material (PDFs/pasted text)** — sent to the app's backend to generate flashcards, and from there to a third-party AI provider (Groq, and for Pro users optionally OpenAI/Anthropic-compatible providers) for processing. **Not persisted server-side after processing** — the generated flashcard deck is stored only in the user's own browser/app storage (localStorage/IndexedDB), never in FlowRecall's database. Confirm current AI-provider data-retention terms (Groq/OpenAI/Anthropic) before finalizing this section, since their own policies govern how long *they* retain content sent to their APIs.

### App activity
- **App interactions** (study session activity, streak dates, deck-generation counts, definition-lookup counts) — collected to power the app's own features (streaks, usage limits). Not shared with third parties, no advertising use.
- **In-app search history** — not applicable, no search feature.

### App info and performance
- **Crash logs / diagnostics** — not currently collected (no crash-reporting SDK integrated as of this writing — verify this is still true before submitting, since it directly affects this answer).

### Data collection is required for the app to function
Yes — an account is required to use core features (this isn't optional profiling).

### Is data encrypted in transit?
Yes (HTTPS/TLS throughout — Vercel-hosted, standard TLS termination).

### Can users request data deletion?
**Yes — self-serve, in the app.** Account → Danger Zone → **Delete Account**, confirmed by typing the account's own email address. One tap deletes:

- **Server-side:** the `User` row, and with it (via `onDelete: Cascade`) every `Account`, `Session` and `StudyDay` row — so name, email, plan/billing ids, streak history and usage counters all go. Any outstanding `VerificationToken` for that address is swept too.
- **On the device:** the whole reader library (books, files, cached PDF text, highlights, reading positions) plus saved decks, in-progress study state and per-deck progress. Only the light/dark theme preference is kept, so the UI doesn't flip mid-teardown.
- **Billing:** a live Stripe subscription is cancelled at the gateway *first*, and if that call fails **nothing is deleted** — so a deleted account can never be left being charged. (Razorpay is a one-time payment, not a recurring subscription, so there is nothing to cancel there.)

No grace period and no soft delete — it is a hard delete on confirmation. Answer "Yes" to the in-app deletion question and give the same URL as the account page; no support-request fallback is needed.

---

## Store listing description (draft)

**Short description** (max 80 characters):
> Turn any PDF into an AI-powered active-recall flashcard feed.

**Full description** (draft — adjust tone/length to taste, Play Store allows up to 4000 characters):

> Stop re-reading. Start recalling.
>
> FlowRecall turns any PDF, lecture slide deck, or pasted text into an AI-generated active-recall study feed — no manual flashcard-making, no deck-building busywork.
>
> HOW IT WORKS
> 1. Upload a PDF or paste your notes
> 2. FlowRecall's AI reads it and generates challenging recall questions in seconds
> 3. Study through an infinite, swipeable feed — true/false judgment calls and fill-in-the-blank recall, never the same question twice
>
> WHY IT'S DIFFERENT
> • Genuinely adaptive difficulty — get a question wrong, and it comes back at an easier level until you've actually got it
> • AI-verified grading on typed answers — judged on whether you got the *idea* right, not on exact wording
> • Built-in PDF/EPUB reader with highlights and instant AI definitions
> • Daily streak tracking to build a real study habit
>
> FREE TO START
> Try your first deck free, no credit card required. Upgrade to Pro for unlimited deck generation and access to the smartest AI models for deeper material.
>
> FlowRecall is built for medical students, law students, and anyone with a stack of dense material to actually learn — not just skim.

---

## Known follow-ups (not blocking today, but don't forget)

- After the *first* Play Console upload: add Google Play App Signing's own SHA-256 to `public/.well-known/assetlinks.json` (Play re-signs your app with its own key, which won't match the upload-key fingerprint currently there).
- Re-verify the "crash logs / diagnostics" and "data deletion" answers above against the app's actual current state right before submitting — both can change independently of this document.
