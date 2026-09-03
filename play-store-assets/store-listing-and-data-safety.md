# Play Store submission reference

Drafted from a direct read of the actual codebase (auth, billing, storage) on 2026-08-23,
not guessed, and corrected on 2026-09-03 where the launch tranche had moved underneath it (the
free tier is no longer one deck for life) and where the compatibility tranche added a question
this file did not have (Android auto-backup). This replaces an earlier draft from a prior session that was discussed in
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

### Android auto-backup — the question this form does not ask in so many words
`AndroidManifest.xml` keeps `android:allowBackup="true"` on purpose, so Android's own Auto Backup
copies the app's data directory — the whole IndexedDB library, decks, reviews, highlights, reading
positions — to **the student's own Google Drive**, where it is protected by their Google account and
end-to-end encrypted on Android 9+. It is the only thing that carries their library across a phone
swap when they never signed in.

**Nothing reaches FlowRecall through it**, and the destination is the student's own Drive, not ours.
Play's Data safety article never mentions Auto Backup, so this has to be answered by analogy to the
FAQ it does have — *"My app enables users to upload their data directly to Google Drive or Dropbox
for backup or storage"* — whose answer is "It depends on the particular implementation" and carves
out an upload to the user's own cloud storage that the app "never collects or accesses", governed by
that provider's terms. Auto Backup fits that shape: the platform performs it, we never see it. The
same article's baseline is blunter, though — *"'Collect' means transmitting data from your app off a
user's device"* — and it says the declaration is the developer's alone to make.

So: answer it deliberately rather than by default, and if in doubt say so in the privacy policy,
which costs nothing. The real fix is the Restore Credentials API, which Play requires by April 2027.

### Data collection is required for the app to function
Yes — an account is required to use core features (this isn't optional profiling).

### Is data encrypted in transit?
Yes (HTTPS/TLS throughout — Vercel-hosted, standard TLS termination).

### Can users request data deletion?
**Yes — self-serve, in the app.** Account → Danger Zone → **Delete Account**, confirmed by typing the account's own email address. One tap deletes:

- **Server-side:** the `User` row, and with it (via `onDelete: Cascade`) every `Account`, `Session` and `StudyDay` row — so name, email, plan/billing ids, streak history and usage counters all go. Any outstanding `VerificationToken` for that address is swept too.
- **On the device:** the whole reader library (books, files, cached PDF text, highlights, reading positions) plus saved decks, in-progress study state and per-deck progress. Only the light/dark theme preference is kept, so the UI doesn't flip mid-teardown.
- **Billing:** a live Stripe subscription is cancelled at the gateway *first*, and if that call fails **nothing is deleted** — so a deleted account can never be left being charged. (Razorpay is a one-time payment, not a recurring subscription, so there is nothing to cancel there.)

No grace period and no soft delete — it is a hard delete on confirmation. Answer "Yes" to the in-app deletion question and give the URL in the next section. The privacy policy describes this flow and keeps an email fallback for anyone locked out of their account.

## Data deletion URL (Data Safety asks for a link, not "it's in the app")

Give **`https://www.flowrecall.app/privacy`** — its "Data retention and deletion" section names
the in-app path, what deletion removes on the server and on the device, that a subscription is
cancelled first, and an email fallback for anyone who can no longer sign in. `/account` is the
page that actually deletes, but it is behind a login, so the policy page is the better public URL.

---

## App access — the section most likely to get this rejected

FlowRecall requires an account for every core feature, so **"All functionality is available
without special access" is the wrong answer.** Choose *All or some functionality is restricted*
and supply credentials.

**Before submitting, create a dedicated review account** (e.g. `review@flowrecall.app`) and give
Console its email and password with these instructions:

> 1. Open the app and tap Account, then Log In.
> 2. Sign in with the email and password provided.
> 3. All features are then available. Reader content can be added from Reader > Paste Text; a
>    flashcard deck can be generated from Ingest > paste any text > Generate micro-concepts.

⚠️ **The review account must not be the only one, and expect it to be destroyed.** Account >
Danger Zone > Delete Account is now a real, unconfirmed-by-us-anywhere-else button sitting in the
app a reviewer is asked to explore. If they press it, the credentials stop working and the next
review fails for a reason that looks like a broken login. Options, in order of preference:

1. Recreate the review account after every review round, and re-check it can sign in before each
   resubmission.
2. Keep two review accounts and give both, so one surviving is enough.
3. Grant it Pro manually (`plan: "PRO"`) so the reviewer sees the paid experience without a
   payment. This is now a preference rather than a rescue: FREE is **3 decks and 60 AI lookups per
   calendar month** (`FREE_DECKS_PER_MONTH`, `FREE_LOOKUPS_PER_MONTH` in `src/lib/freeQuota.ts`),
   so a reviewer on a FREE account no longer hits a wall after one deck the way they would have
   under the old one-deck-for-life cap.

## Content rating questionnaire

Answers for an educational study tool with no user-to-user content:

| Question area | Answer |
|---|---|
| Category | Reference, News, or Educational |
| Violence, sexuality, profanity, drugs, gambling | None |
| User-generated content / user interaction | **No** — nothing a user creates is visible to any other user; decks and books stay on their own device |
| Shares user location | No |
| Allows purchases | **Yes** — a Pro subscription |
| Contains ads | No |

Expect an "everyone / 3+" style rating. Answer from the app as it actually is: the AI generates
text from material the user supplies, which is not user-to-user content, but say so honestly if
the form asks about AI-generated content.

## Target audience and content

- Target age groups: **18+** (or 13+ if you prefer, but the privacy policy says the app is not
  directed at children under 13 — keep the two consistent).
- Appeals to children: **No.**
- Do not opt into the Teacher Approved / Families programme; it pulls in extra requirements.

## The remaining declarations, all straightforward

| Declaration | Answer |
|---|---|
| Ads | **No ads** — nothing in the app serves them |
| News app | No |
| COVID-19 contact tracing or status | No |
| Financial features | **No** — a subscription is not a financial product; Stripe and Razorpay handle payment and FlowRecall never touches card data |
| Government app | No |
| Data safety: encrypted in transit | Yes |
| Data safety: deletion available | Yes, with the URL above |

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
> Three decks and 60 AI lookups every month, free, no credit card required. Upgrade to Pro for unlimited deck generation and access to the smartest AI models for deeper material.
>
> FlowRecall is built for medical students, law students, and anyone with a stack of dense material to actually learn — not just skim.

---

## The graphic assets, and how they measure against the spec

Checked against Play's own asset requirements on 2026-09-03, then corrected where they missed:

| Asset | Required | This repo |
|---|---|---|
| `icon.png` | 512×512, **32-bit PNG with alpha**, ≤1024 KB | 512×512, 32-bit RGBA, 3 KB — was 24-bit RGB until it was converted |
| `feature-graphic.png` | 1024×500, JPEG or **24-bit** PNG (no alpha) | 1024×500, 24-bit RGB, 68 KB ✓ |
| `screenshots/*.png` | ≥2 to publish, JPEG or 24-bit PNG, each side 320–3840 px, longer side ≤2× shorter | eight at 1080×2160, 24-bit RGB, largest 1023 KB — `03-reader` and `05-study-feed` were 8-bit grayscale until they were converted |

The conversions asserted the RGB pixels identical afterwards, so nothing about how any of them looks
changed.

**One shape decision is still open.** 1080×2160 is exactly 2:1, which is the *maximum* ratio Play
allows, so these publish — but Play separately "highly recommends" at least four screenshots at
**9:16** (1080×1920 minimum) and makes eligibility for some recommendation surfaces depend on it.
Buying that means recapturing at 1080×1920, which is a device session, not an edit.

## Known follow-ups (not blocking today, but don't forget)

- After the *first* Play Console upload: add Google Play App Signing's own SHA-256 to `public/.well-known/assetlinks.json` (Play re-signs your app with its own key, which won't match the upload-key fingerprint currently there).
- Re-verify the "crash logs / diagnostics" and "data deletion" answers above against the app's actual current state right before submitting — both can change independently of this document.
