# FlowRecall — Handoff

**Written 2026-09-02, end of session; updated the same day once the device verification it was
waiting on came back clean.** This file replaces the previous reverse-chronological log; every
earlier version is still in git (`git log --follow -- HANDOFF.md`) if you need the older
sessions' measurements and reasoning.

Read **State right now** and **Do this next** before touching anything. The rest is why.

---

## 🎯 The objective

Make FlowRecall the **#1 educational app** by taking the flashcard section to a premium level
that surpasses Anki — not swiping with a nicer skin, but features that make a student
*understand*. The five-move roadmap is `~/.claude/plans/goofy-moseying-heron.md`; today's
build plan is `~/.claude/plans/twinkly-shimmying-hennessy.md`.

**CRITICAL RULE: do not touch the reader.** It is finished and correct. Call its extraction
library; never edit it. This upgrade is the flashcard section only.

---

## State right now

**`main` == `origin/main` == `0099119`, and there is a large UNCOMMITTED tranche on top of
it** — the four phases described under *The launch tranche* below. Everything in it passes; none of
it is committed, deliberately, because it changes what a FREE account gets and that is worth
reviewing before it lands. `git status` is the honest picture.

| | |
|---|---|
| Tests | **375 passing**, 26 files — 21 pure-node, and for the first time 5 that render components |
| Typecheck | `npx tsc --noEmit` clean |
| Lint | **0 errors / 45 warnings** (all 45 pre-date today) |
| Builds | `npm run build` and `npm run build:apk` + `gradlew assembleRelease` both pass |
| Migrations | **8 of 8 applied** to production Supabase — `prisma migrate status` says "up to date" |
| Phone | shipping build carrying the launch tranche, devtools **off**, md5 `5cb8593c21a6b7a5285a87155933bd80` |
| Download | `public/flowrecall-release.apk` refreshed, byte-identical to the phone, cert `e1f4352f…bc09` |
| Play | **AAB builds and is signed with the upload key** — `android/app/build/outputs/bundle/release/app-release.aab`. Never uploaded |
| Device state | 1 deck (*Cardiac cycle - lecture 4*, 3 concepts), 3 units, 6 memory rows, 14 reviews, 4 asks, 2 teach-backs |
| Server state | same, and it holds the concept map and both teach-backs |

**The Vercel Security Checkpoint has expired.** Polling `https://www.flowrecall.app/` to detect a
deploy had tripped IP-scoped bot protection, and every request from this machine *and from the
phone* returned 403 with an Astro challenge page instead of the app — including `/api/sync`. One
`curl -s -o /dev/null -w '%{http_code}' https://www.flowrecall.app/api/sync` now returns 405 and
the phone reaches the API normally. **Do not poll that host in a loop again** — detect a deploy by
checking `git log origin/main` and then making one request, not eighty.

The verification it blocked has since run and passed — see **The sync-rebuild verification** below.

---

## Do this next

**The binding constraint is a calendar, not code.** The Play developer account is a **personal**
one, so it must run a closed test with **12 testers opted in continuously for 14 days** before it
may even apply for production access. That clock starts only once a build is uploaded and 12 real
people have accepted the invite, so:

1. **Review and commit the launch tranche** (below). It is the thing that makes a closed test worth
   running — without it a tester generates one deck, hits a wall, and never sees the concept map,
   teach-it-back or the projection.
2. **Upload the AAB.** It builds and is signed with the upload key:
   `npm run build:apk && (cd android && ./gradlew bundleRelease)`. **Decide the signing question
   before the first upload, because it cannot be undone** — Play App Signing re-signs with Google's
   key, so anyone who sideloaded `public/flowrecall-release.apk` cannot upgrade in place. Sync makes
   that recoverable only if they signed in first, so say so wherever the APK is offered. See
   AGENTS.md.
3. **Fill the Data Safety form from `src/app/privacy/page.tsx`** rather than from memory — it already
   names Groq, OpenAI and Anthropic as processors and covers retention and deletion. Declare
   email/account, uploaded note text sent to third-party AI, Razorpay payment data, usage counters.
   Play also wants a **web-reachable** account-deletion URL, not just the in-app path.
4. **Make the two listing assets that are not in the repo**: a 512×512 icon and a 1024×500 feature
   graphic. Launcher icons are already complete at every density. Screenshots follow the standing
   privacy rules — name "Unknown", no email, no status bar or shade.
5. **Recruit the 12 testers.** Nothing in code shortens this, and it is the critical path.

### Then, in priority order

- **MCQ (Move 3).** The swipe is a 50/50 guess and mastery leans on one production path. The last
  endorsed piece of the old roadmap.
- **A real `importance` signal.** Still a flat 0.5. Starring a concept is the honest first signal.
- **The visual concept graph.** Edges are validated and stored, so it is a rendering job — but 120
  nodes will not read at 360dp and it needs an interaction design first.

### Known, unaddressed, and worth a decision

`npm audit` reports **4 critical / 18 high**, none of them introduced by the launch tranche. Two
matter for a store launch specifically: a **pdf.js arbitrary-JS-execution on opening a malicious
PDF** (this app's entire input is user-supplied PDFs) and a **Next.js middleware/proxy bypass in App
Router**. Also `@auth/core`'s homoglyph email-normalisation bypass. Upgrading these is its own
tranche and should happen before, not after, strangers are invited to upload files.

---

## The sync-rebuild verification

**It passed.** A foreground sync cannot silently undo the exam date. Done on the phone against
production, `0099119`, devtools build, 360×768dp — then the shipping build put back.

What was proved, in the order it had to be: an exam date set through the deck card's own control
stored **local** midnight (`Sat Sep 12 2026 00:00:00 GMT+0530`, not the UTC midnight that would
have read as the 11th here) and moved **all 6** memory rows from 0.905 to 0.95, tightening every
interval. A `since: null` pull through the app's own session returned that `examDate` from
Postgres, so the push carries it. Then the real case: the local deck rewound so the pull saw the
remote copy as newer, which is what makes `syncNow` write it and therefore run
`rebuildMemoryStore`. **All 6 rows came out of that rebuild still at 0.95.** Clearing the date
reversed all 6 to 0.905 and that clear reached the server too (`examDate` absent on the next
pull), so a paper does not stay on the calendar on another device.

**The rebuild was proved to have actually run, not assumed.** One memory row was first poisoned to
`desiredRetention` 0.5 — a value no code path produces. After the sync it was gone, so the rows
really were recomputed. Without that, 0.95 surviving is indistinguishable from a rebuild that
never happened, and the test proves nothing.

**If you ever repeat this, rewinding `updatedAt` alone does not work, and it fails silently.**
`PUSH_SAFETY_MS` is **7 days**, so the push filter is `deckStamp > since - 7d` and a deck rewound
by minutes is still pushed — carrying the fabricated stamp up, after which the server agrees with
local, nothing is newer, no rebuild runs, and the test quietly measures nothing. `deckStamp` is
`max(createdAt, updatedAt, deletedAt)`, so **`createdAt` has to go back past that cutoff as well**;
then the deck is not pushed at all, the pull returns the server's real row, and `mergeRemoteDecks`
restores the true stamps before `rebuildMemoryStore` reads them. Nothing fabricated reached
Postgres — the server's `updatedAt` was unchanged afterwards, and the census held on both sides
(3 units, 6 memory, **14 reviews**, 4 asks, 2 teach-backs).

**Two things worth knowing that came out of it:**

- `visibilitychange` **does** fire in the Android WebView on HOME — `hidden` logged, and
  `SyncEngine` started its sync 3ms later. Worth recording because `MobileAuthBridge`'s own comment
  says the WebView cannot be trusted with it, which is true for *resume* but not for backgrounding.
  Backgrounding and foregrounding is a reliable way to force a sync on the device.
- **A release APK is not bit-reproducible.** A fresh no-devtools build of the same commit came out
  `8590ed36…` against the committed download's `2de67e50…`, same cert. So "confirm the phone's md5
  matches `public/flowrecall-release.apk`" means **installing that committed file**, not building a
  fresh one and hoping. The phone now carries `2de67e50c5c925376673cf168334a537` byte-for-byte,
  zero `webview_devtools_remote` sockets, no `adb forward` left behind.

---

## What today added

Nine commits, in three tranches. Each is independently shippable and leaves the app working.

```
4c7aa42  Let a student name the exam, and drill for it              <- HEAD, origin/main
ffcdd46  Tell them what they will still know next week
38761c0  Stop the wrong list from congratulating a student on being wrong
b991715  Record what teach-it-back is, and the order the rest has to happen in
be6e9c7  Let a student explain it back, and be told what they missed
878b9ac  Keep the edge the model got right, and say why nothing looser
266df2e  Record what the concept map is, and what it has not proved yet
ded772c  Turn a deck into a subject, not a pile of facts
b8fb2b6  Deliver the export the way a phone can actually receive it
```

### Tranche 1 — the concept map, and the defect the device found (`ded772c`, `878b9ac`)

Every concept on the revision sheet now shows three rows of tappable chips — **Build on first**,
**This explains**, **Don't confuse** — with a numbered **Learning path** above the list putting
prerequisites before what needs them. Tapping a chip scrolls to that concept, dropping the filter
first if it is hiding the target (scrolling to an unrendered element silently does nothing; it
needs two `requestAnimationFrame`s, one for the render that puts the row back).

Edges come from **one pass over a finished deck** (`/api/concept-map`), not from ingest. Ingest
sees 1500 characters at a time and never has two chunks in front of it, so it structurally cannot
relate a concept from chunk 1 to one from chunk 7, and it would leave every deck the student
already owns unmapped forever. One mapping costs one AI lookup however many batches a big deck
takes (`MAP_BATCH_SIZE` is 40, and every batch carries every label so a cross-batch edge stays
expressible).

`relation` is a **loose string** in the zod schema rather than an enum: an enum would fail the
whole response over one invented `related_to`, and a partial map beats no map. `validateEdges` is
the only place labels cross to ids, and it drops five classes of edge — an end not in the deck, an
ambiguous label two cards share, a self-edge, an invented relation, a duplicate (`contrast` being
symmetric and deduped both ways).

**Verified against the real model** on a neurotransmission deck chosen because it shares nothing
with the prompt's own worked examples: 6 edges returned, all 6 kept, every direction right, and it
stayed restrained — 6 edges for 6 concepts, not 30.

**Then the phone found what no test would have.** Mapping the real *Cardiac cycle* deck, the model
returned the one relationship it has — *Frank-Starling Mechanism* **explains** *Stroke Volume
Calculation* — and spelled it **"Franks-Starling Mechanism"**. `validateEdges` dropped it, stored
`[]`, and the sheet then told the student *"this deck's ideas do not lean on each other in a way
worth drawing"*. One stray letter turned a right answer into a confident falsehood, and because
`[]` is stored rather than `undefined` the sheet read as authoritatively mapped.

Cause: `normalizeForCompare` splits on **whitespace**, so it strips a plural "s" only from the end
of a whitespace-delimited word, and this one sat inside a hyphenated one. `normalizeLabel` now
treats a hyphen, dash or slash as the word boundary it is, so both spellings normalise to
`frank starling mechanism`. **Not** fixed inside `normalizeForCompare`: cloze grading compares a
student's typed answer with that function, and loosening it there would change what counts as
correct recall.

**A bounded edit-distance fallback was written and cut**, and the reasoning is in the file so it
does not get re-added: no string metric separates "the model misspelt a label it was shown" from
"the model named a neighbouring concept this deck lacks". At two edits *ADP Yield* resolves to
*ATP Yield* and *Type I Error* to *Type II Error*. A missing edge costs a student one connection
they can still find; an invented one teaches them something false and looks identical to a real
one. A test pins the ATP/ADP case.

**Device pass, all at 360×768dp:** whole loop works from the phone (cross-origin with the session
cookie through CapacitorHttp, 200 in ~5.5s); every edge resolved to a real concept id; the numbered
path came out in topological order (`01 Heart Sound Origin / 02 Frank-Starling / 03 Stroke Volume
Calculation`) and was **byte-identical across three separate visits**, every concept exactly once,
no loop; all three chip rows render as real bordered buttons, 120–159px, none overflowing, opacity
1, no hover anywhere; tapping a chip scrolled its card from `top -186` to `top 159`. The server
holds the map. Census unchanged either side.

**What that pass could NOT settle:** the map's *quality* on this deck is not evidence, because the
prompt's own worked examples are built from *Preload / Frank-Starling / Stroke Volume* — the same
material. The uncontaminated quality check is the neurotransmission one. And a pass whose every
edge is discarded still tells the student the deck has no structure; telling the truth there needs
a stored "found edges, could not place them" distinct from "found none", which is a schema change
deliberately not smuggled in.

### Tranche 2 — teach it back (`be6e9c7`, `38761c0`)

The only surface in the app where a student **produces** understanding instead of recognising an
answer someone else wrote. `/api/teach-back` takes their own explanation of one concept and returns
three lists: **what you got**, **what you left out**, **where your material says otherwise**.

**No score, deliberately.** A number becomes the thing they optimise, and "write until the number
goes up" is not the exercise. What they need is which part of their own explanation was broken.

Every response list `.default([])` so a missing key costs that key rather than the whole debrief —
which means `{}` parses clean, so **the route rejects all three lists being empty**: that is not a
verdict, it is a model that did not answer, and the student must not be charged for it.

Most of the prompt's length goes on the two failures a student would be right to resent: being
marked **wrong** for a fact their card never mentioned, and being told something was **missing**
that the material never contained. Both turn a study tool into one that moves the goalposts.

**The limit is `isOverDailyCap`** (200/day, FREE and PRO alike) rather than the FREE lifetime 20
that `/api/ask` and `/api/concept-map` spend. A lifetime 20 would kill the feature exactly where it
earns its place — a student working a hard chapter explains ten concepts in a sitting. The cost,
documented in the route: this shares one counter with cloze grading, so spending 150 here leaves 50
grades before typed answers fall back to self-report.

Attempts persist like asks — **IndexedDB v3**, immutable, userId-scoped — and join `SyncPayload`. A
second attempt is a new row, never an edit, because re-reading last month's explanation beside this
month's is the point.

**Verified against the real model** on an attempt built to carry four things at once: one right
point, one omission, one claim contradicting the stated mechanism, and one claim TRUE but absent
from the card. Three landed first time; the beyond-material claim was correctly left alone.

**The fourth found a defect.** The `wrong` entry came back as *"You correctly said the mechanism is
stretch itself rather than calcium release"* — right finding, worded as praise, rendered under a
heading reading **Your material says otherwise**, and inverting what was written. Cause: the
prompt's JSON example showed `"wrong":[]`, an **empty array**, so the only entry template the model
had to copy was the `correct` list's *"You correctly said …"*. The list that most needed a worked
example was the one given none. Fixed with a real example entry, the required shape *"You said X;
the material says Y"*, and an explicit ban on praise wording there. **5 runs out of 5** now word it
as a correction. A test asserts `"wrong":[]` cannot come back.

**Measured flaw, stated as a number:** across 26 live calls, **about 1 in 12** returned malformed
JSON (truncated mid-array). The route 502s with a readable message and the client **keeps the
draft**, so it costs a retry and one of the day's 200. Raising the token budget is not the fix —
the failures came 500 characters into a 4800-character budget. A single in-route retry is the cheap
lever if it ever measures worse.

**Device pass:** the v3 upgrade added the store and left everything else exactly as it was — units
3, memory 6, **reviews 14**, asks 4, which is the check that mattered since the review log cannot
be regenerated. Three rows render with 3/3/1 entries, nothing overflowing; the collapsed pill
counts history (*"Your explanations (1)"*, 168px); a foreground sync put the attempt in Postgres
with the same 375-character text and timestamp.

**The user's own probe is on the server and worth knowing about:** they submitted `"blah lnbb"`
deliberately, and got `correct: 0, missing: 6, wrong: 0` — the prompt's gibberish branch behaving
as specified, with no invented credit and no scolding. That response hit **exactly 6**, which is
the schema's hard cap, so one more would have 502'd a good answer. Six runs on a much richer
concept with the same nine-character attempt all returned exactly 6 — the model is obeying the
prompt's "six maximum", not landing there by luck. Left alone rather than made to truncate: a
speculative change to deployed code for a failure that would not reproduce. **Latent risk:** if a
future model ignores that line, the symptom is a 502 on a good answer.

### Tranche 3 — Move 5, "show them what they know" (`ffcdd46`, `4c7aa42`)

The reason to open the app when you are **not** studying, which the home screen never had. No AI
call anywhere in it: every number is derived from FSRS state already on the device.

**The projection.** `MemoryOverview` sits under `TodaySession` on the home screen and prints
*"2 of 3 concepts you'll still recall"* with the horizon above it. Anki cannot print that sentence
and not for want of polish — a wall-clock due date carries no probability, so there is nothing in
it to project. A decay curve can be evaluated at any future date.

`projectedRecall` makes three judgements, each chosen to be **harder** on the student than the
alternative:

1. A concept's probability is the **mean across the formats it has been asked in**, not the best of
   them. Taking the max assumes the exam always probes the format they are strongest at.
2. A **never-opened concept contributes 0 and still counts in the total**, so the number cannot
   climb by ignoring work.
3. `expected` is a **sum of probabilities** — 0.9 + 0.9 is 1.8 concepts. Rounding stays with the
   caller.

The caption says *"If you don't review between now and then"*, because that is what the arithmetic
assumes. Anything warmer would make an honest projection into a quiet promise. (The plan's own
draft wording, "at tonight's pace", was rejected for exactly that reason.)

**The exam date.** `desiredRetentionFor(importance, daysUntilExam)` has accepted that second
argument since it was written and had never once been given one — both call sites passed `null`.
Inside 21 days it lifts a deck's floor to 0.95, so naming the date **shortens every interval in
that deck**. Three places had to know, and the third is the one that would have silently undone the
other two:

- **`recordReview`** reads the dates before opening its transaction, keeping the body to nothing
  but IndexedDB requests — the rule that makes it obviously safe rather than safe-if-you-check.
- **`applyExamDateToMemory`** sweeps rows already written, because a memory row carries the target
  in force when it was last touched. Without it, a student who set the date and studied would be
  drilled and one who set it and looked at the screen would see nothing happen.
- **`rebuildMemory` now takes the decks**, because it runs after every sync pull. Without them the
  next foreground sync would relax a deck whose paper is next week. **Verified on the device** —
  see **The sync-rebuild verification** above.

`replayDivergences` deliberately gets no decks: it compares recorded against replayed **stability**,
and stability does not depend on the retention target — only `dueAt` does. So an exam date can never
make the self-check cry wolf.

`soonestExamDate` reads **no clock**, and that is not stylistic: a React component may not read one
while rendering (the compiler lint rule is an error, not a warning, and caught two attempts today).
"Which exam" resolves purely; "is it still ahead" is decided by `daysUntilExam` inside an effect.
Dates are stored as **local midnight** and the input is parsed from its parts, never through
`new Date("YYYY-MM-DD")`, which is UTC midnight — the previous evening for half the world.

**Also fixed, found while reading these files:** deleting a deck tombstones the row and leaves its
units in IndexedDB, so an account-wide projection over every unit would have charged the student for
concepts they threw away — "61 of 94" for a library holding 40. The overview counts live decks only.

**Device pass — the number was checked, not trusted.** Recomputed independently from the raw memory
rows: `1.8293 of 3` → renders as `2 of 3`, which is what the screen showed. 312px wide at 360dp, no
overflow. Setting an exam date 10 days out moved **all 6 rows** from 0.905 to **0.95** and tightened
every interval (2.14 days → 0.93, 0.23 → 0.10), reaching rows last reviewed *before* the date
existed. The heading switched to *"On exam day (10 days)"* live, no reload — which is also the
reactivity check, since it came through the same `recall-engine-update` event `recordReview` fires.
Clearing reversed all 6 rows and emptied the field. And the number is not pinned behind rounding:
1.8292 at 7 days versus 1.7508 at 10.

**I deliberately did not** answer cards to prove the number moves after a session — that writes real
reviews into their FSRS state on their behalf, and reactivity was already proven above.

**Polish debts cleared:** `fireSmallBurst` deleted (zero callers, docblock naming a "Level 3" that
no longer exists — wiring it up would have been inventing a feature to justify dead code);
`FeedSlide`'s sweep timer now cleared on unmount; `useReducedMotion`, previously consulted **nowhere**
in a feed that animates every slide, is honoured; and the "Generated" badge now waits for the
viewport instead of springing in on mount while off-screen, which meant the one animation saying
"this was made for you" played to nobody every single time.

**Left alone on purpose:** the `isNew` sweep still crosses only the header row rather than the whole
card. Widening it means moving an absolutely-positioned decoration into the feed's scroll column,
whose behaviour is documented as measured on the device. A cosmetic gain is not worth touching that.

Also today, before all three: the **export button** was wired and made to work on a phone
(`b8fb2b6`). The Android WebView silently drops `<a download>` blob URLs — `/api/export` returned
200 and 16,600 bytes and nothing reached the filesystem. Now `@capacitor/filesystem` +
`@capacitor/share`, device-verified by `ChooserActivity` taking focus with the file attached. Its
filename also used `toISOString()`, so a 03:50 IST export was stamped with the previous day.

---

## Uncommitted Session Work (Wound down due to token limit)

In the session following the above handoff, a massive amount of new functionality was built and remains uncommitted in the working tree. The primary additions are:

1. **Monetization / Quota Upgrade:** The free tier AI lookup allowance (definitions, asks, concept maps) was changed from a lifetime cap to a recurring monthly allowance (`FREE_LOOKUPS_PER_MONTH`). `prisma/schema.prisma` was updated with `lookupsResetAt` and the enforcement logic was moved to a new `freeQuota.ts` system.
2. **Local Study Reminders:** Added `@capacitor/local-notifications` to schedule on-device push notifications for study reminders. This includes `ReminderScheduler.tsx`, `StudyReminderSettings.tsx`, and `notifications.ts`.
3. **Android Configuration:** Updated `AndroidManifest.xml` and Capacitor gradle settings to support the new local notifications.

**Next Steps for New Session:**
1. Read the uncommitted changes in the working tree to familiarize yourself with the exact implementation details of the new Free Quota and Local Notifications systems.
2. Run any necessary tests (`vitest` or testing library tests added today).
3. If the features are complete, commit them to git and push them.
4. Continue with the next phase of the Flowrecall masterplan.
