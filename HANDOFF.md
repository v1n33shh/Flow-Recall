# FlowRecall — Handoff

**Read the first section only, then stop.** Everything after it is a reverse-chronological log: each `START HERE`
block was the current state on its own date and is now history, kept for the reasoning and the measurements, not
as instructions. The first block is the only one describing the repo as it stands.

## 🎯 The direction — make the flashcard section the reason students stay

The objective is for FlowRecall to be the **#1 educational app**, by taking the flashcard section to a
premium, 9.5/10 level that surpasses Anki: not swiping with a nicer skin, but features that make a student
understand the concept. The five-move plan is `~/.claude/plans/goofy-moseying-heron.md`; the current build's
plan, sequenced out of it and approved 2026-09-02, is `~/.claude/plans/twinkly-shimmying-hennessy.md` -
durability, then the concept map, then teach-it-back. Read the state block below for how far through it the
repo actually is.

**CRITICAL RULE: do not touch the reader.** It is finished and correct as it stands. Call its extraction
library; never edit it. This upgrade is the flashcard section only.

Before the next tranche of code the plan calls for a **Plan Mode pass**: analyse the flashcard
implementation as it now stands, name what is still missing against the best app in the market, propose the
premium-tier architecture for the rest - features that build understanding, not more deck-answering - and
present it for approval before writing any of it. Code is pushed in one batch at the end of the build.

State at **end of session, 2026-09-02 (sync live, export fixed, concept map device-verified)**: phase-3
Postgres sync is **committed** as `9d8a88a` - `recallSync.ts` and its 17 tests, `SyncEngine` mounted in the
root layout, `/api/sync`, `/api/export` and the account screen's export control.

**Everything through the concept map is pushed and deployed.** `/api/sync`, `/api/export` and
`/api/concept-map` all answer an unauthenticated call with 401 in production rather than 404 - and
`/api/concept-map` answers with this repo's own copy (*"You must be signed in to map a deck."*), so it is
this code and not a generic gate. Note for next time: this environment cannot push (HTTPS remote, no
credential helper, no `gh`), so **the push is always a `git push` by hand**.

**The migration IS applied to production.** `20260902000000_add_recall_sync_tables`, via
`prisma migrate deploy` on 2026-09-02 against the live Supabase instance - there is no staging database.
Verified afterwards: all four tables exist and `Deck.conceptMap` is queryable, and the phone has since
written real rows into three of them. The `conceptMap` column is unused until the concept map ships; it rode
along because after this migration the same column would have cost a second one.

On the flashcard plan itself, **Move 2 is complete and device-verified**: the session builder (`f8056db`),
its UI - the *"Got 20 minutes?"* home block, `/study`'s session mode, the cross-deck handoff (`2f08c0b`) -
and the three bugs the device pass found (`0a336bd`). Shipped before it, in plan order: A1 the revision sheet (`/revise`, `0d874ab`), A2 ask-this-card (`1ff2bc2`), and
Move 4's generation fields - `misconception` (`8dccdbf`), `whyItMatters` / `sourceQuote` (`2afdb16`).
**273 tests pass**, `tsc --noEmit` clean, lint **0 errors / 45 warnings**, both `npm run build` and
`npm run build:apk` succeed. All 45 warnings pre-date this work; the two the export control cleared
(`useDataExport` and `Capacitor` both unused) are gone because it now calls them.

**What is next**, per `twinkly-shimmying-hennessy.md`: Phase 1 (durability) and Phase 2 (**A4 the concept
map**) are both **done and device-verified** - `ded772c` plus the label fix in the commit below it. Phase 3 is
**A3 teach-it-back**, not started. Move 3's extra formats and Move 5 come after both. The
one non-code item is still the **$25 Play registration**, below.

### The concept map, as built (`ded772c`)

Three relation types and no more, each earning one row on the revision sheet: **prerequisite** (*Build on
first*), **explains** (*This explains*), **contrast** (*Don't confuse*). Direction matters for the first two
and not the third, and the same edge deliberately reads differently from each end - "build on first" looking
one way, "this explains" looking the other. Getting that backwards would teach a deck in reverse, which is
why the prompt spends most of its length on direction with worked examples, the way the ingest prompt had to.

`src/lib/conceptGraph.ts` is the pure half: `validateEdges` (the model emits LABELS, everything stored is by
ID, and this is the only place that crossing happens - it drops any edge whose end is not in the deck, names
a label two cards share, points at itself, invents a relation, or repeats one already kept),
`groupForConcept`, and `learningPath` - Kahn over prerequisite edges only, **stable** (deck order breaks
every tie, so the path does not reshuffle between visits) and **total** (a model-asserted cycle is broken at
the earliest remaining concept rather than losing concepts). 22 tests; the suite is at **273**.

`relation` is a loose string in the zod response schema rather than an enum, deliberately: an enum fails the
whole response over one invented `related_to`, and a partial map beats no map.

**Checked against the real Groq model**, on a neurotransmission deck chosen specifically because it shares
nothing with the prompt's own worked examples: 6 edges returned, **all 6 kept**, every direction right - the
sodium-potassium pump *explains* the resting potential, threshold *precedes* the action potential, and the
absolute and relative refractory periods came back as the *contrast*, which is the pair students actually
trip on. It also stayed restrained: 6 edges for 6 concepts, not 30. That check lived in a throwaway
`__livecheck.test.ts` and was deleted - the committed suite stays offline. Re-run it the same way
(`import "dotenv/config"`, `buildConceptMapPrompt` and the schema are exported for exactly this) if the
pinned model ever changes.

`Deck.conceptMap` rides the sync that shipped in Phase 1, whose migration already carried the column, and a
tombstone now strips the map along with the concepts.

### What the concept-map device pass settled, 2026-09-02

Driven over CDP on the phone against the **real deck**, not a fixture: *Cardiac cycle - lecture 4*, 3
concepts, at the 360x768 viewport the app actually ships to.

**It found a defect no test would have, and the defect was a lie rather than a crash.** Asked to map the
deck, the model returned exactly one edge - *Frank-Starling Mechanism* **explains** *Stroke Volume
Calculation*, which is correct, and correctly restrained for a 3-concept deck. It spelled the label
**"Franks-Starling Mechanism"**. `validateEdges` dropped the edge, stored an empty map, and the sheet then
told the student *"We looked, and this deck's ideas do not lean on each other in a way worth drawing."*
One stray letter turned a right answer into a confident falsehood, and because `[]` is stored rather than
`undefined`, the sheet read as authoritatively mapped.

Root cause: `normalizeForCompare` splits on **whitespace**, so it strips a plural "s" from the end of a
whitespace-delimited word only - and this "s" sat inside a hyphenated one. Fixed with `normalizeLabel` in
`conceptGraph.ts`, which treats a hyphen, dash or slash as the word boundary it actually is before handing
off. Both spellings then normalise to `frank starling mechanism` and match at distance zero. **Deliberately
not fixed inside `normalizeForCompare`**: cloze grading compares a student's typed answer with that
function, and loosening it there would change what counts as correct recall.

**A bounded edit-distance fallback was written and then cut**, and the reasoning is in the file so it does
not get re-added: no string metric distinguishes "the model misspelt a label it was shown" from "the model
named a neighbouring concept this deck lacks". At two edits, *ADP Yield* resolves to *ATP Yield* and *Type I
Error* to *Type II Error*. A missing edge costs a student one connection they can still see for themselves;
an invented one teaches them something false and is indistinguishable from a real one. The test that pins
this is `"drops a near label rather than guessing, because ATP and ADP are not each other"`.

What the pass proved on the device, all at 360dp:

- **The whole loop works from the phone.** Cross-origin call with the session cookie through CapacitorHttp,
  200 in ~5.5s, edges saved to the deck row. Note for driving it again: Playwright's network events never
  see these calls - CapacitorHttp patches `window.fetch` to go through native OkHttp, so record the call by
  patching `fetch` in-page instead.
- **Every edge names a concept in the deck.** Both ends resolved to real concept ids, nothing unresolved.
- **The learning path is stable and total.** With a temporary prerequisite chain injected, the numbered grid
  came out `01 Heart Sound Origin / 02 Frank-Starling Mechanism / 03 Stroke Volume Calculation` -
  topological order with deck order breaking the tie - and was **byte-identical across three separate
  visits**, every concept exactly once, no loop. Injected into `localStorage` only and **not** through
  `saveConceptMap`, so `updatedAt` never moved and nothing fabricated could sync; restored byte-exactly
  afterwards, verified by string equality.
- **All three relation rows render as real bordered chips**, 120-159px wide, none overflowing 360dp, at
  opacity 1 with a 1px border - no hover anywhere. Tapping a chip scrolled the target card into view
  (`top -186` to `top 159`).
- **The map syncs.** The server, asked for a full pull through the app's own session, returns the deck with
  its `conceptMap` and a matching `updatedAt` - so mapping on the phone is already on the laptop.
- **Nothing was disturbed.** Census before and after: 3 units, 6 memory, 14 reviews, unchanged.

Two things this pass could **not** settle, both honest gaps:

1. **The map's quality on this deck is not evidence.** The prompt's own worked examples are built from
   *Preload*, *Frank-Starling Mechanism* and *Stroke Volume* - the same material as the only real deck on
   the phone. The uncontaminated quality check is the neurotransmission one above, on a deck sharing nothing
   with the prompt.
2. **A pass whose every edge is discarded still tells the student the deck has no structure.** The fix makes
   that rarer, not impossible. Telling the truth there needs a stored "we found edges and could not place
   them" distinct from "we found none" - a schema and sync change, deliberately not smuggled into this build.
   A 3-concept deck also never exercises batching; `MAP_BATCH_SIZE` is 40.

The phone ends on a **shipping build with devtools off**: `59aaf678b1e3c71629e019c8f6f66150`, byte-identical
to the committed `public/flowrecall-release.apk`, cert `e1f4352f...bc09` on both, zero devtools sockets and
zero `adb` forwards left behind.

Run `git status -sb` first and trust it over this line; it has gone stale mid-session before.

```
HEAD     Keep the edge the model got right, and say why nothing looser
266df2e  Record what the concept map is, and what it has not proved yet   <- origin/main
ded772c  Turn a deck into a subject, not a pile of facts
b8fb2b6  Deliver the export the way a phone can actually receive it
0f9671c  Refresh the download so it carries the sync client
9d8a88a  Keep the learning record somewhere other than one phone
```

### What the device pass settled, 2026-09-01

Two full engine-built sessions driven over CDP, one slide at a time. The format rotation is real: the
second session offered the complementary format of all three concepts without being told to. Three
bugs found, all UI, all invisible to the suite - the completion slide reporting **0 cleared / 0%
accuracy after a perfect session** (mastery needs both formats; a session asks one on purpose), a
requeued failure **dropping `unitId`** and so recording against `__session__::<conceptId>`, and the
hero **printing a blank reason line** for a session made entirely of held-but-not-solid cards, which
is the state the home screen is in right after any session. All three are fixed in `0a336bd`.

Engine store afterwards, checked with `scripts/device/recall-census.mjs`: 3 units, **6 memories**
(both paths on all three concepts now), **14 reviews**, and no `__session__` anywhere. That history
is fabricated - it is the fictional *Cardiac cycle - lecture 4* deck - and was **deliberately left in
place**, because it is the only data the home block has to schedule against. Clear it whenever the
demo value runs out.

**Not verified on device:** the *"Nothing needs you tonight"* / resting state. Reaching it needs every
concept solid and inside target, which the fixture cannot be without writing fake review history -
the one thing this pass would not do. The `resting` count itself is covered in `sessionBuilder.test.ts`.

The phone ends on a **clean shipping build**, md5 `425f9337146952afc2bc9fd8e035ebc9`, no devtools
socket, adb forwards cleared. That build was newer than the committed `public/flowrecall-release.apk`,
which predated Move 2; **the download has since been refreshed** - next section.

### What the device pass settled, 2026-09-02

Driven on the phone over CDP after installing a devtools build. Three things came out of it that no test
would have.

**Sync works end to end.** With `/api/sync` deployed, the launch sync fired and succeeded on its own:
`flowrecall:syncCursor:<userId>` appeared in localStorage (the cursor only advances on success), and
Postgres then held **1 deck, 3 units, 14 reviews, 4 asks** for that account - matching the device census
exactly, 3 units and 14 reviews on both sides. The 6 memory records are deliberately absent server-side;
they are recomputed by `rebuildMemory`. The learning record is now recoverable from the server, which it
has never been before.

**The export button was a dead button that looked like it worked, and is fixed.** `/api/export` from
inside the WebView returns **200, application/json, 16,600 bytes** - the route was never the problem. The
`<a download>` + blob URL delivery is **silently dropped by the Android WebView** (Chrome 150): nothing
in `/sdcard/Download`, nothing in the app's own dirs, no `DownloadManager` entry in logcat, and a minimal
blob probe failed identically - so it is the mechanism, not the payload. The label returned to normal with
no error, because only a failed *fetch* was ever surfaced. On native it now writes the file with
`@capacitor/filesystem` to `Directory.Cache` and hands it to the share sheet via `@capacitor/share`
(two new deps, `cap sync` reports 6 plugins). Verified: `ChooserActivity` takes focus with
`flowrecall-export-2026-09-02.json` attached, and dismissing the sheet reports no false failure. The web
path is untouched.

**The export filename was a day behind.** `toISOString().slice(0, 10)` is UTC, so exporting at 03:50 IST
produced a file stamped with the previous day. It builds the stamp from local getters now, and the device
confirmed `2026-09-02` against `adb shell date`.

**Also confirmed on the real 360x800dp screen:** the Move 2 home block reads *"Got 20 minutes?"* with the
10m/20m/40m chips, *"3 slipping - 3 nearly gone"* and *"Start 3 cards - ~1 min"*; the Account screen shows
**Download My Data** under Manage Subscription, a 56px row.

**The library grew and survived.** Census after the upgrade: **4 books** - the two Osho titles plus an ACT
textbook and *Principles of Neural Science*, both added by the user since the last handoff - and **3
highlights**, up from 1. Engine store unchanged at 3 units / 14 reviews / 6 memories. Every install this
session was `adb install -r` on the same key, so all of it was an in-place upgrade.

`npm audit` reports 24 pre-existing vulnerabilities (4 critical, mostly `@auth/core`). **Neither new
plugin contributed any of them** - checked before and after. Not addressed here; a NextAuth beta bump is
its own piece of work.

### The download APK, refreshed 2026-09-02

`public/flowrecall-release.apk` is md5 `75d5af6e0ed258bd6048fa53f99ee0f3`, and **this is also what the phone
is running** - the first time the download and the device have matched since Move 2. It carries Move 2 and
everything before it, the sync client, and the export control with its native share-sheet delivery. Recipe:
`npm run build:apk && (cd android && ./gradlew assembleRelease)` with **no** `DEVTOOLS=1`, then copy
`android/app/build/outputs/apk/release/app-release.apk` into `/public`. Superseded builds from this session,
none of them worth going back to: `326f53cb…` (no export control), `8dc2e4df…` (export control, broken
delivery), `8acba78d…` / `939a68db…` / the devtools rebuilds.

Checked rather than assumed: `webContentsDebuggingEnabled: false` in the packaged `capacitor.config.json`;
signer SHA-256 `e1f4352f…bc09`, the same key as every prior build, so it installs in place and the library
survives; the build script's guard fired (`Excluded flowrecall-release.apk (6.0 MB)`), so this APK does not
contain its own ancestor; the Move 2 home block is in the bundle - `"Nothing needs you tonight"` and
`"minutes?"` are both there; and so is the export control (`"Download My Data"`, `"/api/export"`). Note that
grepping the bundle for the whole phrase *"Got 20 minutes"* finds nothing and proves nothing: the string is
`Got ${budget} minutes?`, a template.

**Device-verified**, unlike every APK before it this session - see the device pass above. Installed with
`adb install -r`, cert `e1f4352f…bc09` on both sides, so the library came through untouched.

`versionCode` is still **1**, deliberately: nothing has been uploaded to Play, so 1 is still the right number
for the first upload. A same-`versionCode` APK installs over the old one as a reinstall, so the download
works today regardless.

## ✅ Nothing is half-done. One thing is left, and it is not code.

**Pay the $25 Google Play developer registration.** It has been blocked on the user's card for over a week and it
is now the *only* thing standing between this repo and a submission. Everything it gates:

1. Create the app in Play Console and upload **`android/app/build/outputs/bundle/release/app-release.aab`**
   (gitignored - rebuild it if this is a fresh clone, recipe below).
2. Attach the eight screenshots in `play-store-assets/screenshots/` - current as of `880c8b3`, all 1080x2160.
3. Work through `play-store-assets/store-listing-and-data-safety.md`. It now covers **every** Console form, not
   just Data Safety: the deletion URL to give, **App access** (the app is login-gated, so review credentials are
   mandatory - and note the warning there about a reviewer pressing Delete Account and destroying them), the
   content rating questionnaire, target audience, and the ads/news/COVID/financial/government declarations. Every
   answer was read off the actual code.
   **Still to do by hand: create the review account** (e.g. `review@flowrecall.app`), ideally granted `plan: "PRO"`
   so a reviewer never hits the FREE one-deck lifetime cap.
4. Console then issues **Play App Signing's own SHA-256**, which is the second fingerprint
   `public/.well-known/assetlinks.json` is missing. It degrades rather than breaks until then.

`versionCode` is **1**: correct for a first upload, and it must be bumped for every upload after it.

### Optional work, offered and never built

- **Eye Filter auto-schedule** (warm after sunset). The better of the two.
- **Light-mode verification** of the blue annotation family and the filter. The user has said three times that
  light mode is not a priority.
- `PDF_EXTRACT_VERSION` is still **2**. Recommendation on file for two sessions now: **leave it.** The bump's only
  justification was 1809 ciphered paragraphs in a chess book that the user has since deleted.

### The keystore is safe - do not re-raise this as a risk

Confirmed 2026-08-30 by looking at the actual Drive folder. `My Drive > Info` holds **both**
`flowrecall-release.jks` (3 KB, i.e. the real 2,800 bytes rounded) **and**
`FlowRecall-release-keystore-credentials.txt` (2 KB), both dated 21 Aug - the day the key was created. The
credentials are also in the user's WhatsApp self-chat. The credentials were verified read-only against the real
keystore: store password and alias open it, and the key password unlocks the private key via `-certreq`, so the
backup can genuinely **sign**, not merely list. Cert `e1f4352f…bc09`, alias `flowrecall-release`, valid to 2054.

Never commit either file - `android/.gitignore:56,58` ignores them and they have never been in history. Never run
`keytool -keypasswd` to test a password: it rewrites the keystore in place. Use `-list` and `-certreq`.

The only check never performed is a byte compare of the restored copy against
`md5 2ca8def45112850e11946d2897543d46`.

### The user's phone, as left

On the **clean shipping build** left by the 2026-09-02 pass, md5 `75d5af6e0ed258bd6048fa53f99ee0f3`, which
is **byte-identical to the committed `public/flowrecall-release.apk`**. (It held `425f9337…` at the start of
that session, verified over adb; that build predated the sync client.)
The phone itself, read over adb rather than remembered: **OPPO CPH2001, Android 11 (SDK 30)**, 1080x2400 at
480dpi - so a **360 x 800 dp** viewport, which is the budget every layout decision has to fit - and 7.8 GB
RAM. Installed `app.flowrecall.android` is `versionCode 1` / `versionName 1.0`, minSdk 24, targetSdk 36,
first installed 2026-08-23, last updated 2026-09-01 03:42. Not debuggable, `ALLOW_BACKUP` on. It asks for
**INTERNET and VIBRATE only** - worth keeping that lean for the Play listing. The APK is 6.35 MB: 6.96 MB of
`classes.dex` and 6.66 MB of `assets/public` before compression.

USB debugging was off at the start of the session and the device dropped off the bus twice mid-inspection, so
expect to re-authorise it. `webContentsDebuggingEnabled: false`, **zero devtools sockets**, adb forwards
cleared. So there is **no WebView access until a devtools build is flashed again** -
`DEVTOOLS=1 npm run build:apk && cd android && ./gradlew assembleRelease`, then `adb install -r`. Same signing
key either way, so it is always an in-place upgrade and the library survives.

Library at hand-off (census taken immediately before the final swap): `11da49a7` The Book of Wisdom (Osho, pdf) at
`{"paragraphIndex":400}`, progress `0.9052`, holding the only highlight `0a4000f3`, phrase `"have"`,
`{paragraphIndex:104, start:1389, end:1393}`, `note: null`; and `aa230a39` Awareness (Osho, epub) at progress 0.
Also on the account: a deck **"Cardiac cycle - lecture 4"** (3 concepts) that this work created to photograph the
study feed. Fictional content, delete it freely.

---

## 🟡 START HERE — 2026-08-31 (recall engine, phases 1-2): live on the device, committed as `7d1c469`

**This block described the work while it was still uncommitted; it is committed now** (`7d1c469`), along with
three follow-up commits on top of it. Everything below remains an accurate description of what the engine does and
why. Run `git status -sb` before anything else.
Three new files plus a two-line change to the account screen. All of it is additive: the study feed, the reader,
ingest and every route are untouched, and the app behaves exactly as it did before.

### Why this, and why first

The study feed had no tomorrow. `saveProgress` snapshots a session so it can resume, and that is the end of it -
no interval, no review history, no row anywhere that says a concept was retrieved and should come back Thursday.
So there was nothing for the app to manage on the student's behalf, which is the actual reason the flashcard
experience felt thin. Phase 1 is the substrate for that; the session builder and the new question formats sit on
top of it and are the next two pieces.

Deliberately on-device only. Everything runs client-side, which is what lets it work inside the Capacitor shell
(a static export with no server behind it) and offline. Syncing to Postgres for durability and cross-device is
phase 3 - **until then this is device-local, exactly as the deck list already was, so do not claim cross-device.**

### What landed

| | |
|---|---|
| `src/lib/fsrs.ts` | FSRS-6, ported not invented. Curve, interval, initial state, difficulty update, recall/lapse/same-day stability, all 21 published weights. Plus two FlowRecall extensions, both clearly marked: cross-path stability coupling, and `desiredRetentionFor` deriving retention from importance + exam proximity instead of a slider |
| `src/lib/recallModel.ts` | Types and every pure derivation: `RetrievalPath`, `KnowledgeUnit`, `MemoryRecord`, `ReviewRecord`, `unitsFromDeck`, `pathsFor`, `gradeFor` (incl. the lucky-guess check), `masteryFor` (the five-condition bar), `dueFirst` / `isDue` |
| `src/lib/recallStorage.ts` | IndexedDB `flowrecall-recall` v1 - `units`, `memory`, `reviews`. `recordReview` is the one write path. Idempotent `importDeck`, non-destructive `migrateSavedDecks`, `deleteAllRecallData`, `useRecallMemories` |
| `src/app/account/page.tsx` | One import plus one `await deleteAllRecallData()` in the local-wipe block, so deleting an account clears the new stores too |
| `src/components/StudyFeed.tsx` | The wiring. Latency clock per slide, `recordReview` on every resolve, `importDeck` + one-time `migrateSavedDecks` on session open, mastery now requiring BOTH lanes, and every failure requeued instead of level-1 failures vanishing |
| `src/components/CompletionSlide.tsx` | "Your memory of this deck" - solid / fading / still building, plus the resting line. The visible payoff |
| `src/lib/types.ts` | `StudyProgress.correctLaneKeys?`, optional in the same way `resolvedKeys?` is |

### The decisions worth knowing before touching it again

- **FSRS was ported, not designed.** Cross-checked against two sources before writing (the awesome-fsrs wiki and
  expertium.github.io/Algorithm.html) because a scheduler that is subtly wrong stays invisible until months of
  review history are built on it. The two 90%-anchor invariants — `R(S,S) = 0.9` and `interval(S, 0.9) = S` — are
  asserted across four decay values, so if `factor` is ever derived wrong the tests catch it immediately.
- **Coupling constants are unfitted guesses.** `COUPLING_ON_SUCCESS = 0.35`, `COUPLING_ON_LAPSE = 0.6`. No
  literature exists — FSRS has no notion of sibling formats. Failures couple harder than successes on purpose
  (forgetting generalises; a recognition success does not). Both are stamped onto **every review row** so they can
  be refitted later against real data instead of argued about.
- **A suspiciously fast correct answer is recorded but not credited.** `gradeFor` compares latency against a
  percentile of *this student's own* history on *that* format, so a fast reader is not punished and a slow guesser
  is not waved through. Under ten prior answers it credits everything — erring toward crediting is right at cold
  start. This is the direct fix for a two-option swipe being winnable by luck half the time.
- **Mastery needs three of five conditions today, and can only get stricter.** Three successes across two formats,
  one after a 7-day gap, one on a production path. The other two from the design (no active misconception, no
  recent overconfident failure) are not evaluated because nothing records misconceptions or confidence yet — they
  tighten the bar later, never loosen it. The delay is measured **per format**: a fortnight-old cloze warmed up by
  a swipe an hour earlier is not delayed evidence.
- **`met` / `familiar` / `holding` / `solid` / `fading`.** `familiar` is what the feed currently calls *mastered*.
  Naming it separately was most of the fix; the label was doing the misleading, not the threshold.
- **Due-ness is a shortfall against each unit's own target**, not a wall-clock date. That is what lets the engine
  answer "don't study this tonight" for something Anki would have shown.
- **`Memory` is derived; `Review` is the asset.** Memory can always be rebuilt by replaying reviews, which turns a
  scheduler bug into a recomputation rather than a data-loss incident. Keep that property.
- **Migration is non-destructive.** `flowrecall:savedDecks` is left exactly where it is, so the feed keeps working
  off it and a bad migration is a no-op to recover from. `flowrecall:recall-migrated` only skips the work —
  `importDeck` is idempotent, so clearing the flag re-runs it harmlessly. Dropping the localStorage copy is a
  separate decision for a later release.
- **`deleteAllRecallData` clears the stores rather than deleting the database.** `deleteDatabase` blocks
  indefinitely while another tab holds a connection, which would hang the deletion flow at the worst moment.
- Unit ids are `${deckId}::${conceptId}` and every record carries `userId`, so a re-import updates in place and two
  accounts on one device can never merge histories — the wart `readerStorage.ts` has, avoided here from day one.

### Verified, by measurement

- **153 tests pass, up from 90** — 35 new in `fsrs.test.ts`, 28 in `recallModel.test.ts`. `tsc --noEmit` clean.
  Lint still **46 warnings, 0 errors** — the same count as before, i.e. zero warnings added.
- Both `npm run build` and `npm run build:apk` succeed, `cap sync` completes, and `src/app/api` is restored.
- The staged APK assets do contain the new module: `flowrecall-recall` and `recall-engine-update` are both present
  in `android/app/src/main/assets/public/_next/static/chunks/`.
- **But the scheduler itself is tree-shaken out, correctly.** `36500`, `suspect-guess` and the w0-w3 weights appear
  in **zero** chunks, because the only thing importing the module today is `deleteAllRecallData` on the account
  screen. The math ships the moment the feed calls `recordReview` — which is the next commit, not a bug in this one.

### Phase 2: the feed wiring, and two bugs it closed

- **Latency is measured from viewport entry, not mount.** The feed renders every slide up front, so mount time
  would report how long the student had been in the session. First entry only, so scrolling back to a card does
  not restart its clock and turn a long deliberation into a suspiciously fast answer.
- **Mastery needs both lanes.** `masteredIds` used to be set by one correct answer, and lane 1 is a two-option
  true/false, so the progress bar was half guesswork. It now needs the swipe AND the cloze.
- **Every failure comes back.** `nextEasierLevel(1)` returns null, so a failed level-1 swipe used to be requeued
  nowhere at all - failing the easiest card had no consequence, while a failed cloze fell back to a swipe that
  could then be guessed. A lane with no easier level left is now retried at its own level,
  `MAX_ATTEMPTS_PER_LANE = 3` so nothing runs forever. This also had to be fixed for mastery-needs-both-lanes to
  be reachable at all: without it a failed swipe was a dead end and the bar could never fill.
- **A skip is logged but never credited.** Scrolling past a card is evidence of nothing; letting it decay a memory
  would let thumb movement write the model. It still requeues exactly as before.

**The one real bug this introduced, found on the device and fixed:** `correctLaneKeys` started as a ref, and a
correct answer on a concept's FIRST lane changes neither `masteredIds` nor `queue` - so the save effect never
re-fired and the answer was silently lost on resume. It is state now, and a dep of that effect. The device census
showed `resolved: 0` with a review already written, which is what exposed it; nothing in the test suite would have.

### Verified on the real device, not just in tests

Built `DEVTOOLS=1`, release-signed, `adb install -r`. Cert `e1f4352f…bc09` on both the new APK and the committed
one, checked with `apksigner` before installing, so it was an in-place upgrade. **Library survived**: both Osho
books at their original positions (PDF 0.9052, EPUB 0.0226), 3 highlights, 2 files.

Drove a full 3-concept session over CDP (walking one slide at a time - jumping ahead fires `onViewportLeave` on
every slide passed over, which resolves them as skipped and shifts every index underneath you):

- 3 units imported, 6 memory rows (3 concepts x 2 paths), 6 credited reviews, migration flag set.
- Latencies genuinely captured: 3999-7099ms, per card.
- Every first review wrote `stabilityAfter = 2.307`, i.e. `w2` exactly - the published initial stability for a
  Good first answer. `desiredRetention` 0.905 = `0.86 + 0.09 x 0.5`.
- `correctLaneKeys` persisted all 6 lane keys; `masteredIds` filled only after both lanes of each concept passed.
- **Coupling measured exactly.** A same-day repeat correctly buys nothing (FSRS's short-term formula yields
  SInc < 1 at S~2.3 and the floor clamps it back), so a concept was back-dated 10 days to create a real interval.
  Reviewed path S 2.3065 -> 25.1088; sibling path 2.3065 -> 10.2873. **Observed ratio 0.3500 against the intended
  0.35**, sibling `reps` unchanged, sibling clock HELD, difficulty untouched.
- Completion slide renders on-device: `0 SOLID / 0 FADING / 3 STILL BUILDING` plus the explainer line, since two
  formats in one sitting is `holding` and solid needs the 7-day gap. Screenshotted via `adb exec-out screencap` -
  Playwright's own `page.screenshot()` returns pure black against this WebView.

**All engine test data was then cleared from the device** (including the fabricated 10-day gap - test data must not
masquerade as a learning history). The deck and reader library are untouched, so the next real session starts clean.

### The installed build has devtools ON

`webContentsDebuggingEnabled: true`, which is NOT the shipping posture. Fine while iterating; run
`npm run build:apk && (cd android && ./gradlew assembleRelease)` **without** `DEVTOOLS=1` and reinstall before any
Play upload, and re-verify the flag in `android/app/src/main/assets/capacitor.config.json`.

### Not done, and not claimed

Still device-local - no Postgres sync, so no cross-device and no durability beyond this phone. `importance` is a
flat 0.5 for every unit because nothing measures it yet; a fabricated ranking would be worse than an honest
constant. No Hard button, so `gradeFor` never returns HARD. Coupling does not fire on a path's FIRST review (there
is no `stabilityBefore` to derive a delta from) even when a sibling already has state - defensible, but a known
limitation. The home screen is still a deck list; nothing yet asks "got 20 minutes?".

Also worth noting from the device run: the test deck's Stroke Volume cloze reads *"end-diastolic volume minus
_____"* with `answer` = *"EDV minus ESV"*, which does not substitute grammatically. The ingest prompt already
demands substitutability in prose; it needs to become a mechanical assertion in the quality gate.

### Next, in order

1. The session builder - value/cost ranking against a time budget - and the home screen becoming *"Got 20
   minutes?"* instead of a deck list. This is the change students actually feel.
2. MCQ (4-option, from the existing `answer`/`distractor` plus distractors borrowed across the deck) and
   reverse-recall. Both free from data already generated, and MCQ drops the guess rate from 50% to 25%.
3. Postgres sync for durability and cross-device.



---

## 🔴 START HERE - 2026-08-30 (account deletion): the last pre-submission blocker is closed

Play Console requires self-serve account deletion and the app had none - no handler in `src/`, no route, nothing
on the account screen. That was the only item left that needed code; everything else is blocked on the $25
developer account. Built, tested, shipped and **verified live**: `DELETE /api/account` answers 401 on
`https://www.flowrecall.app`, and `Danger Zone`, `Delete Account`, `Delete forever` and the `z-[60]` fix are all
present in the deployed chunks.

### What it does

`DELETE /api/account` (new), reached from **Account > Danger Zone > Delete Account** on the native screen and a
`Delete account` link on the web card. Confirmed by **typing the account's own email** - not a two-tap, because
this is unrecoverable. Order is deliberate and load-bearing:

1. **Cancel recurring billing first.** New `cancelRecurringBilling` in `src/lib/billing.ts` - the codebase's first
   real gateway call, `stripe.subscriptions.cancel`. A failed cancel returns **502 and deletes nothing**, so a
   deleted account can never be left billing a card. Stripe's `resource_missing` counts as success (already gone
   is the outcome we wanted). Razorpay is a no-op **on purpose**: that flow is a one-time order, not a
   subscription.
2. `prisma.user.delete` in a transaction with a `verificationToken.deleteMany` on the email - `VerificationToken`
   has no user FK, so the cascade does not reach it.
3. Client wipes local data **only after a 2xx**, then signs out. Wiping first would take the user's books for a
   deletion that a failed cancel prevented.

### The one thing to know before touching it again

**The on-device library is not scoped to an account.** `readerStorage.ts` opens `flowrecall-reader` with no user
id, and the localStorage decks are not keyed by account either. So `deleteAllBooks()` clears *the device*, not
*the signed-in user's* books, and **deleting any account on the user's phone destroys their Osho library** - a
throwaway account gives no protection whatsoever. That is why the e2e test below ran in a desktop browser. It is
correct behaviour for a single-user phone and a wart on a shared one; the user knows and chose to keep it.

### A real hole this closed on the way past

`src/auth.ts:79` keeps a JWT valid when the user row is gone ("stale token is still valid for auth"), and
`/api/ingest` and `/api/define` read `user?.decksGeneratedToday ?? 0` / `user?.definitionsUsed ?? 0`. A token held
across deletion therefore read as a **brand-new FREE user with zero usage**, cleared the quota gate, and spent AI
credits against a row that no longer existed. Both now carry the `if (!user) return 401` guard
`/api/study/track:22` already had.

### Verified, by measurement

- 90 tests pass (14 new: `deleteAccount.test.ts`, `storage.test.ts`, `billing.test.ts`), `tsc --noEmit` clean,
  lint 0 errors and **0 warnings in any file touched**, both `npm run build` and `npm run build:apk` succeed.
- **E2E in a fresh browser profile against a throwaway account.** Gate disabled before typing / with the wrong
  email / enabled with the right one uppercased. After deleting: IndexedDB books, files and highlights all 0;
  localStorage down to `flowrecall-theme` plus an unrelated control key, **both `flowrecall:progress:*` keys
  gone** (the case a fixed key list misses); signed out on `/`; DB row gone.
- **The cascade was checked separately** because the throwaway never exercised it - credentials login under JWT
  sessions means zero `Session`/`Account`/`StudyDay` rows, so the 200 proved nothing. Seeded one of each plus a
  `VerificationToken`, ran the route's exact transaction, all four went to 0 with the parent.
- Unauthenticated `DELETE` -> 401, `GET` -> 405, and `src/proxy.ts` already allowed `DELETE` for `/api/*`, so the
  native cross-origin call needed no CORS work.
- No test rows left behind - queried for `deletion-test+*` / `cascade-test+*`, empty.

**The on-device check found a bug the browser test could not.** The sheet's overlay was `z-50`, the same layer as
`MobileTabBar` (`fixed bottom-0 z-50`), which renders later in DOM order and therefore painted over it. Both sheet
buttons sit at y 704-748 with the tab bar starting at 683, so `elementFromPoint` on **"Keep my account" returned
the Ingest tab link** - on a phone neither button was tappable and the sheet was a trap. Invisible on the web,
where the bar is `sm:hidden`, which is exactly why the desktop e2e passed. Fixed by moving the overlay to
`z-[60]`; re-measured on the device, both taps now land on their own buttons, the gate still arms only on the
right address (padding and case forgiven), and `Keep my account` dismisses without leaving `/account`. Lesson: a
modal added to this app has to outrank `z-50`, and a viewport-dependent overlap needs the real device.

**Not** verified: actually pressing Delete on the phone (it would wipe the real library - see the scoping note
above), and the Stripe failure path beyond unit tests (the throwaway was FREE, so no gateway call fired).

### Environment traps learned this session

- **A local dev server cannot authenticate with the checked-in env.** `.env` sets
  `NEXT_PUBLIC_API_URL=https://www.flowrecall.app`, so the browser fetches
  `https://www.flowrecall.app/api/auth/session`, the app's own CSP blocks the cross-origin connect, `useSession()`
  throws `ClientFetchError` and every page reads as signed out. Run dev as
  `NEXT_PUBLIC_API_URL= AUTH_URL=http://localhost:PORT NEXTAUTH_URL=http://localhost:PORT npx next dev`.
- **`BUILD_TARGET=capacitor next build` fails by design** on `/api/cron/keep-alive` - `output: "export"` walks
  `src/app/api`, which is why `scripts/build-capacitor.mjs` moves that directory aside. Only ever use
  `npm run build:apk`.
- `pgrep -f "next dev"` matches the shell command containing that string, so it reports a server still running
  after it has stopped. Check the port instead.

### The device scripts are committed now

`scripts/device/` - the Playwright-over-CDP harness this and the screenshot session were
built on, moved out of the repo root and into the tree so it survives a clone. Read
`scripts/device/README.md` first: it carries the connection recipe, what each script does,
and the traps (length-preserving prose swap, the 96px status bar, the `z-50` modal rule,
`elementFromPoint` for tap targets, `librarySort` reordering the grid). The seven superseded
one-offs from the screenshot session were deleted rather than kept.

### Release artifacts: rebuilt, and current with this code

Both were rebuilt after the feature commit and check out:

| | |
|---|---|
| `public/flowrecall-release.apk` | md5 `dcb36846…`, 6,315,792 bytes, **committed**. Cert `e1f4352f…bc09`, devtools `false`, carries `Delete Account` and the `z-[60]` fix, no nested copy of itself |
| `android/app/build/outputs/bundle/release/app-release.aab` | 6,166,052 bytes, `jar verified`, same cert, devtools `false`, carries both. **Gitignored** - a local artifact, so it does not survive a fresh clone |

`versionCode` is still **1**. Fine for a first upload; every upload after it must bump or the Console rejects it.

Rebuild recipe, both tasks, since `assembleRelease` alone does **not** produce the bundle:
`npm run build:apk && cd android && ./gradlew assembleRelease bundleRelease` - then copy the APK into `public/`.
Run `build:apk` **without** `DEVTOOLS=1` or you ship a debuggable WebView.

The phone is deliberately **not** on this build: it still has the devtools-enabled release-signed APK from 19:41
(same cert, so `adb install -r` either way keeps the library). Swap it for this one when device work is done.

---

## 🔴 START HERE — 2026-08-30 (screenshots): the store set is current again

Yesterday's open item #2 is **done**. `play-store-assets/screenshots/` was three reader sessions stale (dated
Aug 22); all six slots are recaptured off the physical device and **two new slots added** for the features that
appeared in no asset at all, so the set is now **eight** at **1080x2160 exactly**, committed and pushed as
`880c8b3`. Play allows 8 phone screenshots, so the set is full. No code changed.

### The set, and what each one had to work around

| file | crop `y` | notes |
|---|---|---|
| `01-home-hero.png` | 216 | the one shot kept from the earlier attempt at 15:29; already clean |
| `02-ingest.png` | 231 | the fictional cardiac-cycle notes, deck title filled. `y` had to go *down* to 231: at 186 the dropzone's "Tap to upload a PDF" is cut mid-line |
| `03-reader.png` | 96 | the earlier attempt was **blank** - see the pagination trap below. Parked at paragraph 155 so the progress bar reads ~35% rather than a 2%-wide sliver |
| `04-pricing-pro.png` | 186 | Pro card framed by scrolling the app's own overflow pane, badge at CSS y=150. Better than the Aug 22 one: the CTA now clears the tab bar |
| `05-study-feed.png` | 168 | real generated cards, see the new deck below. The `✕` loses its top 24px: `✕`-to-CTA is 2184 rows and only 2160 fit |
| `06-account.png` | 186 | name **"Unknown"**, avatar **"U"**, email removed - the user asked for exactly this. `y=186` is the only offset where both the `Account` heading and the whole tab bar survive |
| `07-definition.png` | 240 | **new.** A real long-press lookup on the word *simplicity*, definition plus both examples plus `Save as Note`. `y=240` drops the reader header entirely: header-top to sheet-bottom is 2268 rows |
| `08-eye-filter.png` | 96 | **new.** The Aa menu open on the Eye Filter row, `Warm` selected, `Dim 10%`, page visibly warmed. The panel is translucent by design, so reader text shows through behind the labels - that is the app, not an artefact |

`_check.png` was deleted from that folder - the previous handoff already called it a stray, not an asset.

**2:1 is the binding constraint.** The Aug 22 set was 1080x2300 (2.13:1). Every screen whose content spans more
than 2160 device rows now forces a choice about what to sacrifice; the table says which choice was taken and why.
Nothing was faked to dodge it - no zoom changes, no hidden elements.

### Three traps worth not re-learning

- **Replacing reader paragraph text collapses the layout and paints a blank page.** `TextReaderCore` translates
  the column container by `currentPage * (containerWidth + gap)`; shortening the paragraphs shrinks
  `content.scrollWidth`, so a `currentPage` deep into the window points past the end. That is exactly why the
  15:35 attempt captured a black page under a live "Page 401 of 444" header. Swap **length-preservingly** - build
  each replacement by cycling the prose until it matches the original paragraph's character count.
- **A full document load lands on the marketing home page, whatever the URL says.** The export writes
  `reader.html`, not `reader/index.html`, so the Capacitor server falls back to `index.html` and the client router
  renders `/`. `page.reload()` and `page.goto("/reader")` both do this. Navigate **in-app** from a fresh launch.
- **The definition popover needs a real OS long-press**, `adb shell input swipe X Y X Y 800`, and
  `window.getSelection()` stays **empty** afterwards - the app runs its own selection, so assert on the action
  sheet's buttons (`✦ Define`, `▍ Highlight`, `Copy`) instead. To aim the press, put a `Range` around the word and
  convert: `deviceX = rectCenterX * 3`, `deviceY = rectCenterY * 3 + 96`. Only accept a hit whose rect is wholly
  inside the viewport; off-screen columns report boxes too. The lookup takes ~7.5s.
- **The Dim stepper does not batch.** Three `click()` calls in one `evaluate` advance it by one step; space them
  ~700ms apart. `Reset` in the same menu returns warmth `off` + dim `0`, which is the user's stored state - use it
  rather than writing `localStorage` back by hand.
- **`MobileTabBar` returns `null` on `/reader` and `/study`** (`src/components/MobileTabBar.tsx:200`), so there is
  no tab link to click from inside either. Leave via `button[aria-label="Back to library"]`; the reader chrome has
  proper aria-labels throughout (`Previous page`, `Next page`, `Book Contents`, `Display settings`).
- Also: `a[href="/reader"]` matches **three** elements, two of them the hidden desktop nav. Playwright's
  `click()` picks the first and times out. Filter by rendered box and click in-page.

### What this session changed outside the screenshots

- **A new deck exists: "Cardiac cycle - lecture 4", 3 concepts, saved to the library.** Generating it was the only
  way to photograph the study feed with real cards; the source notes are fictional, so nothing private is in it.
  Delete it if it is unwanted - it is the one piece of state this session added.
- The reader's stored position was moved to paragraph 6, then 155, then **restored to
  `{"paragraphIndex":400}`** with `progress` unchanged at `0.9051918735891648`. Verified by census afterwards.
- Reader preferences were changed for `08` and **restored byte-for-byte** - `eyeFilterWarmth:"off"`,
  `eyeFilterDim:0`, verified by string equality against the value read before touching anything.
- **The phone is running a devtools-enabled build**, not the release APK the previous block describes. That is how
  these captures were possible. Re-flash `public/flowrecall-release.apk` before shipping - and note that a
  different signing key would need an uninstall first, which **wipes the library**.

### Census, taken after all the writing was done

Two books, and the EPUB has changed identity again since the last block: `aae884e8` **How to Win Friends is gone**,
replaced by `aa230a39` **Awareness (Osho Insights for a New Way of Living)**, `progress 0`. The user tidying, as
before. `11da49a7` The Book of Wisdom holds the only highlight, `0a4000f3`, phrase `"have"`,
`{paragraphIndex:104, start:1389, end:1393}`, `note: null` - byte-identical to the previous block's record.
`pdfText.version` is still **2**.

### Still waiting on the user, unchanged

Items 1, 3, 4 and 5 from the block below all stand: `PDF_EXTRACT_VERSION` bump (recommendation: skip),
`assetlinks.json` missing Play App Signing's SHA-256, the $25 Play account still blocked on the card, and the two
unbuilt offers (Eye Filter auto-schedule, light-mode verification). Item 2 - the screenshots - is now closed.

---

## 🔴 START HERE — 2026-08-30 (last): where a new session picks up

Three pieces of reader work, all committed, pushed and verified live. Nothing is half-done. What is left is the
same short list of **out-of-codebase** Play Store steps as yesterday, plus two small judgement calls, all below.

### Where the artifacts are

| | |
|---|---|
| repo | last code commit `b9626df`, pushed; `origin/main` and local HEAD matched at end of session. A documentation-only commit for this section may sit unpushed on top |
| production web | deployed and verified by fetching it: all 15 chunks `/reader` references were pulled, and `Eye Filter`, `Save as Note` and `Add to Note` are all present in the live JS. `/flowrecall-release.apk` serves `content-length: 6311100`, byte-identical to the committed APK |
| the user's phone | release APK from 14:44, **md5 `5a693bcdcc5cc0e9bf4092791c226046`**, identical to `public/flowrecall-release.apk`. `webContentsDebuggingEnabled: false`, signed `CN=FlowRecall`, no devtools socket after launch, no nested APK. **Not** a devtools build - re-flash one to inspect again |
| Play Store artifact | **AAB rebuilt 14:58 today**: `android/app/build/outputs/bundle/release/app-release.aab`, 6,161,295 bytes, `jar verified`, `CN=FlowRecall`, devtools false, no nested APK, and confirmed to contain this session's code by grepping its own bundled chunks. Gitignored, so it is a local artifact - `assembleRelease` does **not** build it, see the note below. `versionCode 1` / `versionName "1.0"` |

### What shipped, in one line each (details in the two blocks below)

- `c212530` - a looked-up definition can now be saved and read again later, and the definition panel's hierarchy
  stopped being flat white.
- `b9626df` - the reader's Eye Filter: warmth in four steps plus a dim that goes below Android's own minimum.

### The user's library changed again, and it settles yesterday's open question

Yesterday's block asked the user to confirm whether their library going 7 -> 5 was them. It was: it is now **2
books**, and the missing ones went the same way. Census taken twice today over CDP:

- `11da49a7` The Book of Wisdom (Osho, pdf) - holds the only highlight, `0a4000f3`, phrase `"have"`,
  `{paragraphIndex:104, start:1389, end:1393}`, `note: null`
- `aae884e8` How to Win Friends (epub)

Gone since yesterday: `77e54bbc` Chess: 5334 Problems, `01f07e69` flowrecall-test-sample, `9409ceca` Osho (text).
Treat `deleteBooks` as exonerated - this is the user tidying with the feature built for it.

### Decisions waiting on the user, not on code

1. **`PDF_EXTRACT_VERSION` is still 2, and bumping it is now barely worth it.** Yesterday's case for the bump was
   1809 ciphered paragraphs in the chess book - **that book is gone**. What remains is the Osho book, whose text
   changes by *whitespace only*, plus an offset migration for the single `"have"` highlight. Recommendation on
   file: drop it unless the chess book is ever re-added.
2. **Screenshots must be recaptured before any Store upload.** `play-store-assets/screenshots/` is still dated
   **Aug 22** - now three reader sessions stale. `03-reader.png` predates the extraction rewrite entirely, and
   neither the definition panel nor the Eye Filter appears anywhere in the set. Earlier conventions to preserve if
   recapturing: status bar cropped, real book text replaced with fictional text, account name/avatar replaced with
   a placeholder "Alex"/"A". `_check.png` in that folder is a stray, not an asset.
3. **`assetlinks.json` has 1 of the 2 fingerprints it needs.** Play App Signing's SHA-256 only exists after the
   first Console upload. Degrades rather than breaks until then (`auth-callback` forwards to `flowrecall://`).
4. **The Play Developer account ($25) is still blocked on the user's card.** Unchanged for over a week.
5. Two things offered and not built: an **auto-schedule** for the Eye Filter (warm after sunset), and **light-mode
   verification** of both this session's blue annotation family and the filter itself. `--reader-highlight`
   deliberately does not invert, so light mode gets the same blue on a near-white panel - untested. The user has
   twice said light mode is not a priority.

### Known limitations that will ship with it

Unchanged from yesterday's list, which is still accurate: two-column PDFs interleave their columns; figures,
tables and equations are dropped; no OCR for scans (honestly reported, not blank); non-English PDFs verified only
against synthetic text; pinch-zoom off app-wide; pdf.js `wasmUrl` not shipped; legacy `{"page":N,"scale":S}`
positions resume at the start. Add one: **Amber at full 50% dim puts body text at ~3.5:1, under WCAG AA** - a
disclosed, one-tap-reversible user choice, asserted by a test so it cannot drift unnoticed.

### Environment notes learned this session (additive to the older lists)

- **`assembleRelease` does not build the AAB.** The APK and the bundle are separate Gradle tasks, so the bundle
  goes stale silently while the APK is current - it sat a day behind today until the user asked. Run
  `./gradlew bundleRelease` too, and re-run `npm run build:apk` first so it cannot be built from stale synced
  assets. To prove a bundle carries your change:
  `unzip -p app-release.aab 'base/assets/public/_next/static/chunks/*.js' | grep -F "<your string>"`.
- **`npm run build` is not `npm run build:apk`.** Vercel runs the former; every APK check this project does uses
  the latter. Run `npm run build` before a deploy - it is the only thing that exercises what production will.
- **Playwright cannot click a reader highlight over CDP.** `elementHandle.click()` fails with "element is outside
  of the viewport" on a `<mark>` in any column other than the current page, because paging moves columns with
  `transform` - it retries for the full 30s timeout and throws. Dispatch it in-page instead:
  `page.evaluate(() => document.querySelector("mark").dispatchEvent(new MouseEvent("click", {bubbles: true})))`.
  Reserve real `adb shell input swipe x y x y 800` for long-press-to-define, which needs OS-level touch.
- **`librarySort` defaults to "recent", so opening a book moves it to grid slot 0.** Indexing library cards by
  position picks the wrong book on the second open - that cost a wasted EPUB check today. Select by badge text
  (`textContent.includes("EPUB")`), not by index.
- The Aa menu's own dismiss scrim (`div.fixed.inset-0.z-40.bg-transparent`) intercepts clicks on the trigger that
  opened it. Dismiss the menu by clicking the scrim, not the button.
- **rAF frame-interval sampling over CDP is inflated by idle gaps** - it only fires on paint, so spacing synthetic
  taps 420ms apart reports ~99ms "frames" that are not the real frame rate. Only A/B comparisons under identical
  harnesses mean anything; do not quote the absolute numbers.
- Splitting one file's changes across two commits without interactive staging: write the intermediate version of
  the file, `git add` it, commit, then restore the full version and commit the rest. Used today to keep each
  commit carrying only its own `globals.css` documentation.

### Verification standard this session held to, worth keeping

Every claim was measured in the real WebView on the physical device against the user's own books, reading from
their stored files. The one thing that had to be written - a highlight, to test note storage - was created and
then **removed via the real Remove button**, with a census before and after proving the user's own highlight
untouched (`note: null`, same offsets) and both books present. Where a claim was about contrast or colour, the
number was computed and asserted in a test rather than eyeballed. 76 tests pass (`npm test`), `tsc --noEmit` is
clean, lint is at 0 errors with 46 pre-existing warnings, and `npm run build` succeeds.

---

## 🔴 START HERE — 2026-08-30 (definitions): a definition you looked up had nowhere to go

User-reported: "we copy the definition after clicking the define button... and we store it as a note, it doesn't
store the definition when we come back to view it." Reproduced on the device before touching any code, and the
cause was not a storage bug - **there was no button that stored it.**

From a fresh long-press (the normal way to look a word up) the result panel offered exactly one action, "Copy
definition". `Save as Note` was gated on `isHighlighted`, so it only appeared for a phrase that already happened
to be highlighted and reopened by tapping its underline. And Copy sent `data.definition` alone, dropping both
examples. To store a definition at all you had to close the sheet, re-select, Highlight, tap the underline, and
spend a **second** AI lookup.

- A note still lives ON a highlight, because that underline is the only route back to it. So saving from a fresh
  selection now creates the highlight it hangs off - in all three views - rather than having nowhere to be written.
- `src/lib/definitionNote.ts` (new) backs both Copy and Save as Note from one formatter, so the clipboard and a
  stored note cannot disagree or hand over half of what is on screen. Saving onto an existing note **appends**;
  losing the reader's own words is the same class of failure as losing the definition.
- The panel's stage machine now owns the persisted note instead of re-reading the `note` prop. A note saved onto a
  brand-new highlight has no prop to come back through, and trusting a stale one is what would have made
  `Edit Note` open an empty textarea and overwrite what was just saved.
- **EPUB staleness bug fixed on the way past**: epub.js keeps an annotation's click handler for the life of the
  annotation, so a handler closing over its record kept serving the version from *before* a note was attached - a
  note saved in-session was invisible until the book was reopened. The closure carries only the id now.

### Then the aesthetics, asked for separately

The user asked whether Define should be blue. Answer given and implemented: **no.** In the reader, blue already
means "your mark on this book" (`--reader-highlight`, the underline sitting centimetres above the button), white
is the highest-contrast thing possible on `#050505`, and a mid-lightness blue would *demote* the primary action.

The real problem was that the panel's hierarchy was written in `--accent`, which **is** white - so `+ Note`,
`Edit Note`, the note card and the `EXAMPLES` label all collapsed into the same value as the primary button, and
the only genuine hue left was **red, on Remove**: the destructive action was the loudest element on screen.

- The annotation family (`Highlight`, `+ Note`/`Edit Note`, the note card) now carries `--reader-highlight`. Not a
  new exception - a note is stored on a highlight, so the button that makes a mark and the mark should not be
  different colours. `globals.css`'s token comment was updated to say so.
- `Remove` is an icon-only button on a neutral surface, red confined to the glyph. Kept rather than dropped, since
  removing a highlight also deletes its note. Measured 44x38, height matching `Edit Note` exactly.
- `Save as Note` keeps its white fill and takes a blue bloom via `box-shadow`, because a **filled**
  `--reader-highlight` carries 13px white label text at only **3.68:1**, under AA. The note card's label is
  full-strength blue for the same reason - at `/70` it measures **2.9:1**, at full strength **4.64:1**.
- `EXAMPLES` dropped from `text-accent/80` to muted, so the definition prose is the brightest thing in the body.

### Verified on the device

Saved a definition from a fresh long-press against the real Osho PDF; the IndexedDB record carried the definition
**and** both examples. Force-stopped, cold-relaunched, reopened the book: underline restored, tapping it opened
straight to note-view, `Edit Note` pre-filled with all 279 characters, `Cancel` discarding without wiping. Every
colour claim read back from `getComputedStyle`, not eyeballed - the blue measured `rgb(60, 131, 246)`, identical to
the token. Test highlight removed afterwards; the user's own highlight untouched throughout.

7 new tests in `definitionNote.test.ts`.

---

## 🔴 START HERE — 2026-08-30 (eye filter): warmth and a dim that beats the OS minimum

Requested for "heavy readers, or who read for hours". Two independent controls at the bottom of the `Aa` menu, on
every reader type: **Warmth** in four named steps (Off / Soft / Warm / Amber) and **Dim** in 5% steps to 50%.
Off by default - a filter that arrives uninvited reads as a broken screen, not a feature.

### Why one blend layer and not warm colour tokens

The three readers put text through three different renderers, and epub.js's is a **sandboxed iframe**. Measured on
the device: `--reader-highlight` reads back **empty** inside it, so it inherits none of the parent document's
custom properties. A token-based warm theme would have needed three implementations that drift and would still
have missed EPUB content entirely. A lens filters whatever is underneath it by construction.

`mix-blend-mode: multiply` specifically, because that is what a filter over a screen does: it scales each channel
down, so warm whites go cream and **blacks stay black**. A translucent amber `rgba` layer would instead *raise* the
black level and leave a near-black page milky grey. Dimming falls out of the same multiply for free, so one
element and one runtime-computed colour do both jobs, and nothing renders at all while the filter is off.

It deliberately covers the chrome and the definition sheet too (z-50, last child of `ReaderChrome`, above the
sheet's z-40). A filter that stopped at the prose would leave a bright white popover to stab someone an hour into
a night session - the exact moment the feature exists for.

### DIM_MAX is a measured floor

Body text is `#FAFAFA` on `#050505`, 19.6:1. Multiplied by 0.5 it lands at **5.0:1**, still past WCAG AA; 55%
gives 4.1:1 and 60% gives 3.4:1. So 50% is the last step at which the darkest non-amber setting clears AA.
**Amber at full dim lands ~3.5:1** - disclosed rather than prevented, and asserted by a test, so neither the cap
nor the exception can drift unnoticed. `clampDim` is applied where the colour is built, not just by the stepper,
so a hand-edited `localStorage` value cannot black the page out (also tested).

### Verified on the device, against both real books

Colour maths correct on hardware: Warm+25% -> `rgb(191, 159, 133)`, Amber+20% -> `rgb(204, 152, 112)`. The EPUB's
iframe content is filtered identically to the PDF's. The setting survives a cold relaunch and is applied on the
reader's **first paint** (no flash of an unfiltered page), and does **not** leak outside the reader - zero
overlay elements on the home page. `Reset` works and touched none of the user's other preferences.

**No page-turn cost.** Four alternating runs of eight real page turns: median frame interval 99ms with the filter
on, 99-115ms with it off; worst frame 198-297ms either way, no pattern. See the rAF caveat in the brief above -
the absolute numbers are an artifact of the harness, the A/B is what holds.

11 new tests in `eyeFilter.test.ts`, including the three contrast assertions above.

---

## 🔴 START HERE — 2026-08-29 (superseded): the state at the end of that session

Everything built this session is committed, pushed and live. Nothing is half-done and nothing is broken. What is
left is a small number of **decisions** and **out-of-codebase steps**, all listed below with the data needed to
act on them.

### Where the artifacts are

| | |
|---|---|
| repo | last code commit `d19bbbb`, pushed; a documentation-only commit for this section may sit unpushed on top |
| production web | deployed and verified: the reader chunk carries `inset-x-0 bottom-0 z-30` / `calc(8rem` / `This can't be undone`, `https://www.flowrecall.app/pdfExtract.worker.js` is **md5-identical** to `public/pdfExtract.worker.js`, and `/flowrecall-release.apk` serves 6,309,672 bytes. `flowrecall.app` 308-redirects to `www.` |
| the user's phone | release APK from 19:19, `webContentsDebuggingEnabled: false`, signed `CN=FlowRecall`, 6.3 MB. **Not** a devtools build - re-flash one to inspect again (see below) |
| Play Store artifact | **fresh AAB built 19:28**: `android/app/build/outputs/bundle/release/app-release.aab`, 6,159,908 bytes, `jar verified`, `CN=FlowRecall`, devtools false, no nested APK. A build output, not committed. `versionCode 1` / `versionName "1.0"` - must increment on every upload after the first |

### What shipped, in one line each (details in the blocks below)

- `03c0053` - PDF extraction moved into a real worker; blank paragraphs dropped; window slides stopped skipping
  text; "Page X of Y" derived from the PDF's own page map; guard rails for scans, locked and near-textless PDFs;
  and the cipher decoder stopped leaving paragraphs in cipher.
- `0c401dd` - the reader library can be tidied: selection-mode multi-delete and Recent/Title/Progress sorting.
- `f6cc11f` - that selection bar anchored to the viewport instead of `main`'s content box.
- `d19bbbb` - the release APK stopped bundling a copy of itself (23.7 MB → 6.3 MB).

### Decisions waiting on the user, not on code

1. **`PDF_EXTRACT_VERSION` is still 2, so books already cached keep their old text.** A *fresh* extraction now
   rescues **1809 paragraphs** of the chess book from cipher, its table of contents included. Bumping to 3 would
   fix existing copies in one open (~16 s for the Osho book, longer for chess) but must carry the single existing
   highlight: `{paragraphIndex: 104, start: 1389, end: 1393}`, phrase `"have"`, on book
   `11da49a7-0c9f-4ac5-8513-40aafc673ef6`. The Osho book's text changes by **whitespace only** (23412 characters
   of intra-paragraph runs collapse), so a two-pointer walk from old text to new maps those offsets exactly.
   Paragraph *counts* are unchanged in both books (443/443, 9006/9006), so saved reading positions need nothing,
   and the chess book's 1809 changed paragraphs carry no highlights at all.
2. **Screenshots must be recaptured before any Store upload.** `play-store-assets/screenshots/` is dated
   **Aug 22** - before the Aug 23 redesign and two reader sessions out of date. `_check.png` in that folder is a
   stray, not an asset. The user was offered a recapture and the session ended before answering.
3. **`assetlinks.json` needs Play App Signing's SHA-256**, obtainable only after the first Console upload. Until
   then the App Link for `/auth-callback` will not verify on Play-installed builds; it degrades rather than
   breaks, because `src/app/auth-callback/page.tsx` forwards to the `flowrecall://` scheme.
4. **The Play Developer account ($25) is still blocked on the user's card.** Unchanged for a week.

### Known limitations that will ship with it

None are rejection risks, and payment-policy compliance was verified in the 2026-08-23 session (no in-app
purchase flow exists on Android at all). But be honest about these if asked "is it ready":

- **Two-column PDFs interleave their columns** - the chess book's move columns merge into single lines.
- Figures, tables and equations are dropped from extraction entirely.
- No OCR for scanned PDFs. Now *honestly reported* ("No text in this PDF") rather than a blank reader.
- **Non-English PDFs are verified only against synthetic text** - eight languages, a mixed-language document and
  English edge cases all pass `pdfLanguageSafety.test.ts`, and the guard that protects them is real, but no
  actual non-English book has ever been through the pipeline.
- Pinch-zoom is off app-wide (`userScalable: false`), a deliberate trade for the swipe feed, with a real
  accessibility cost.
- pdf.js wants a `wasmUrl` that is not shipped - blocks JBIG2/JPX image decoding, harmless while the reader is
  text-only.
- Legacy `{"page":N,"scale":S}` reading positions resume at the start. Only affects records on the user's own
  device.

### One thing to check with the user

**Their library went from 7 books to 5 during the session: two of the three duplicate Osho PDF copies are gone.**
That was not this session's scripts - the only deletion performed here was of two disposable books injected over
CDP for exactly that purpose (verified 9 → 7 with a census before and after, all seven real books present). The
most likely explanation is that the user cleared the duplicates themselves while testing the new feature, which
is also how they noticed the bar geometry bug. The surviving Osho PDF is `11da49a7…`, which holds the only
highlight, and that highlight is intact; cached texts went 5 → 3 with the deleted copies. **If the user says it
was not them, treat it as a real defect in `deleteBooks` and investigate before shipping.**

Current library, for reference: `01f07e69` flowrecall-test-sample (pdf), `11da49a7` The Book of Wisdom (pdf, has
the highlight), `77e54bbc` Chess: 5334 Problems (pdf), `9409ceca` Osho (text), `aae884e8` How to Win Friends
(epub). Cached extractions exist for the three PDFs.

### Environment notes learned this session (additive to the older lists further down)

- **`out/` is written only by `npm run build:apk`, never by `npm run build`**, and stale chunks from earlier
  exports survive in it. A headless check against `out/` after `npm run build` measures *old code* - that cost a
  wrong measurement here. `build-capacitor.mjs` now clears `out/` first; still worth confirming the chunk
  `out/reader.html` actually references contains your change.
- To check layout across device sizes: `(cd out && python3 -m http.server 8899)` and load
  **`http://localhost:8899/reader.html`** - this export writes `reader.html`, not `reader/index.html`, so
  `/reader/` serves a directory listing. Direct navigation to `/reader` inside the app also falls back to the
  home page; get there by clicking `a[href="/reader"]` instead.
- **Inspecting a release build on-device**: `DEVTOOLS=1 npm run build:apk` → `cd android && ./gradlew
  assembleRelease` → `adb install -r` → find the socket (`adb shell cat /proc/net/unix | grep
  webview_devtools_remote`, the PID changes on every launch) → `adb forward tcp:9222 localabstract:<socket>` →
  `chromium.connectOverCDP`. Always rebuild *without* `DEVTOOLS` afterwards and reinstall, so the phone is left
  on a shippable build.
- **`apksigner` cannot verify an AAB** ("Missing AndroidManifest.xml"). Use `jarsigner -verify -verbose:summary
  -certs` for bundles and `apksigner` for APKs. The bundle's "invalid certificate chain" warning is normal for a
  self-signed upload key.
- Seeding or reading library data over CDP: wait until the app itself has created the database, then
  `indexedDB.open("flowrecall-reader")` with **no version number**, `put` records, and dispatch
  `new Event("reader-library-update")` - `useBooks` listens for exactly that. Deleting through the UI afterwards
  leaves no trace.
- Measuring the reader during a route transition reads a **doubled DOM** (both the old and new route are briefly
  mounted). Wait for `document.querySelectorAll("div.grid").length === 1` before believing any count.
- Bash's cwd resets to `$HOME` after a call that ends with `cd android` - use absolute paths for anything that
  follows. `adb` is at `~/Android/Sdk/platform-tools/adb`, `apksigner` at `~/Android/Sdk/build-tools/35.0.0/`.
- The first `adb exec-out screencap` after a launch is black; poll until the PNG exceeds ~120 KB.

### Verification standard this session held to, worth keeping

Nothing was called done on unit tests alone. Every reader claim was measured in the real WebView on the physical
device against the user's own books, reading from their stored files and **writing nothing back**; the only
deletions were of books injected for the purpose and removed again. 58 tests pass (`npm test`), `tsc --noEmit` is
clean, and lint is at 0 errors with 46 pre-existing warnings.

---

## 🔴 START HERE — 2026-08-29 (build): the release APK was shipping copies of itself

Found while checking what a `git push` would carry: `public/flowrecall-release.apk` had grown **6MB -> 12MB ->
17MB -> 23.7MB** across four builds, each one carrying its ancestors.

The cause is a loop nobody noticed. The APK lives in `/public` so the website can offer it as a direct download.
`/public` is copied wholesale into the static export, and **the export is what gets bundled into the APK** - so
every build packed the previous APK inside the new one, and the next build packed that.

`scripts/build-capacitor.mjs` now deletes `out/flowrecall-release.apk` after the export and before `cap sync`,
printing what it excluded, and clears `out/` before the export (next build does not, so chunks from earlier
builds were surviving in it - that also produced a wrong measurement earlier this session). The web deploy still
serves the download from `/public`; only the phone has no use for a copy of the app inside the app.

**Result: 23.7 MB -> 6.3 MB**, Android assets 25 MB -> 7.5 MB, and `unzip -l` finds zero copies of the APK inside
itself. Installed and launched on the device. Worth re-checking after any change to what lives in `/public`.

---

## 🔴 START HERE — 2026-08-29 (bar geometry): the selection bar was 64px off the bottom of the screen

User-reported, on their own phone: the delete panel "exceeds the screen". It did, and the cause is worth
remembering because nothing about it is visible in a browser at desktop size.

`SelectionBar` was `sticky bottom-0`. **A sticky element cannot leave its containing block**, and its containing
block here is this page's `<main>`, which carries `py-10 sm:py-16`. So the bar came to rest at the bottom of
main's *content box* - measured on the device at 360x768, its bottom edge was at y=704 with **64px of library
still showing underneath it**. It looked like a panel floating in the wrong place. In a tall headless window it
looked perfect, because there the content was long enough that main's box extended past the viewport and sticky
had somewhere to stick.

- Now `fixed inset-x-0 bottom-0 z-30`, positioned against the viewport, so content height is irrelevant.
- Its contents sit in the same `mx-auto max-w-2xl` column as the grid, so on a tablet the controls stay with the
  books instead of drifting to the window edges.
- A fixed bar covers the last row of books *permanently* - no amount of scrolling gets past it - so `<main>` gets
  `paddingBottom: calc(8rem + env(safe-area-inset-bottom))` while selecting. 8rem clears the tallest the bar can
  get (89px, when the confirm sentence wraps to three lines at 280px wide).
- Bottom padding is `calc(env(safe-area-inset-bottom) + 1rem)`, matching `MobileTabBar`. The constant is doing the
  real work: this WebView is not drawing edge-to-edge, so it reports an inset of **0** while Android still draws
  its gesture pill in that strip.

### Verified at five viewport sizes, then on the device

Headless sweep against the real static export (`out/reader.html`, served over http) at 280x520, 320x568, 360x640,
393x873, 412x915 and 768x1024, in both the selecting and confirming states, with 12 books selected so the
sentence is as long as it gets: bar flush to the bottom (`innerHeight - bar.bottom === 0`) at every size, every
button inside the bar, no horizontal overflow anywhere, smallest touch target 44px, and the last card clears the
bar by 39-43px when scrolled to the end. On the device: bar bottom **768 of 768** (was 704), last card fully
visible, no overflow.

⚠️ **`out/` is only written by `npm run build:apk`, not `npm run build`** - and stale chunks from a previous
export survive in it. A headless check against `out/` right after `npm run build` measures the *old* code; that
cost a wrong measurement this session. Rebuild with `build:apk` and confirm the chunk `reader.html` references
actually contains your change.

---

## 🔴 START HERE — 2026-08-29 (library): delete and sort

The user could not delete a book from the reader library on their own device, and the reason was not a missing
feature. `BookCard` had a remove button all along - `opacity-0 ... group-hover:opacity-100`. A phone has no
hover, so it was **unreachable on the only platform this app ships on**, which is why three copies of the same
Osho PDF had been sitting in the grid for weeks. Worth remembering as a class of bug: a hover-revealed control is
invisible on touch, and nothing in typecheck, lint or a desktop browser will ever say so.

Replaced with two things the user chose from options:

- **Selection mode.** "Edit" turns every cover into a checkbox (`aria-pressed`, dim scrim, filled tick when on),
  a sticky bar counts what is picked, and deleting is two taps: `Delete (2)` then `Delete 2 books? This can't be
  undone.` It is an in-page bar rather than `window.confirm`, which on Android renders a system dialog titled
  with the app's own `localhost` origin. `deleteBooks(ids)` (new, in `readerStorage.ts`) removes the books, their
  files, cached PDF text and highlights in **one** transaction and fires one library-update event, so a
  multi-delete is all-or-nothing and repaints once. `deleteBook` now delegates to it.
- **Sort presets** - Recent / Title / Progress, in `librarySort.ts`, persisted as `librarySort` in reader
  preferences. This also fixes something nobody had named: the grid was showing IndexedDB's own key order, which
  for `crypto.randomUUID()` keys is *random*. "Recent" (last opened, else added) is the new default and Title is
  what makes duplicates findable - it puts them adjacent, oldest copy first, so deleting the extras does not move
  the one being read. Every order ends in an id tiebreak, so no re-render can reshuffle equal keys while
  someone is ticking boxes.

The delete affordance is now only in selection mode - there is deliberately no always-visible per-card ×, which
would be one mis-tap from removing a book.

### Verified on the device

Release APK, installed over the existing app. Sorting checked against the real 7-book library (Title groups the
three Osho copies adjacently; Progress puts the 88%-read Osho first and the untouched EPUB last; the choice
survives a relaunch). The delete path was exercised end-to-end on **two disposable books injected over CDP**, not
on the user's own: 9 books -> 7, 9 files -> 7, cached texts unchanged at 5, **the real highlight still there**,
selection mode exited on its own. Screenshots confirm the tick and the bar render correctly, and the bar carries
`env(safe-area-inset-bottom)` so Delete does not sit under Android's gesture bar.

58 tests pass (8 new in `librarySort.test.ts`), `tsc` clean, lint unchanged. `public/flowrecall-release.apk` is
this build, `webContentsDebuggingEnabled: false`, no devtools socket after launch.

---

## 🔴 START HERE — 2026-08-29 (decoder): no paragraphs left in cipher

The session below wrote `pdfLanguageSafety.test.ts` to find out whether the Type3 cipher decoder corrupts
non-English books. Answer: **it does not** - all eight languages (German, Spanish, French, Italian, Portuguese,
Dutch, Polish, Turkish), a mixed-language document, and English headings/number tables/formulas all come back
untouched. The `judgeShift` vowel gate written that session is what holds that line, and it still does.

What the sweep did catch was two bugs in the other direction - a *ciphered* paragraph left un-rescued among
legible ones, which on a real book reads as a page of garbage mid-chapter. Both are fixed, and the sweep now
recovers the plaintext at **all 40 shifts** (it was 38, and before these fixes, 25).

### 1. A letter was destroyed before the decoder could see it (`pageParagraphs`)

`current.join(" ").replace(/\s+/g, " ")` ran *before* decoding, and JavaScript's `\s` includes Unicode spaces.
A cipher shift can land a letter exactly on one: at shift 39 every `y` becomes U+00A0, so `only` collapsed to
`onl `, irreversibly, and the paragraph came out as neither plaintext nor cipher - the one outcome the test calls
"a third thing". Pre-decode normalization is now ASCII blanks only (`collapseAsciiBlanks`); everything else is
collapsed by `finishParagraph` after the shift is resolved, so legible text with a non-breaking space still ends
up exactly as it did before.

### 2. A rejected guess ended the matter (`decodeBatch`)

When `detectCipherShift` guessed wrong, `judgeShift` rejected the guess and the paragraph was returned raw - even
in a book whose real shift was already known by majority vote. At shift 16 that left paragraphs 0 and 2 of the
sweep sitting in cipher. A rejected own-shift now falls through to the document's voted shift, which has to earn
the paragraph on its own evidence, so a genuinely legible paragraph (the other reason a shift gets rejected)
still stays untouched.

Two evidence problems had to be solved for that fall-through to work at all, and they are the interesting part:

- **The vowel test can be satisfied by accident.** At shift 16 the English vowels map onto `u` and `y`, which
  `VOWEL` counts as vowels - so ciphered prose scored *more* legible than its own plaintext. Control characters
  settle it instead: `decryptText` strips them, no legible text in any language contains them, and a Type3 cipher
  produces them the moment a shift pushes a letter past 127. `CONTROL_CHARS` in the raw now means "nothing
  legible here to protect", whatever the vowel ratio says.
- **At small shifts there are no control characters either.** Shift-1 English (`"uif nbtufs tbje"`) keeps a vowel
  in nearly every word, so the vowel test reads it as fine prose. `letterProfileScore` decides those: mean letter
  frequency against a Latin-script table, which a shift wrecks by construction (every `e` becomes an `f`).
  Undoing a real shift gains 1.5-3 points; shifting legible prose loses ground. This is leaned on **only** when
  `state.carried` is non-zero - i.e. a majority of paragraphs were already demonstrably rescued by that shift,
  which a legible book of any language never manages, so it cannot become a back door into the language guard.

### Verified

- **50 tests pass** (12 in `pdfLanguageSafety.test.ts`, 15 in `pdfTextExtract.test.ts`). `tsc --noEmit` clean,
  lint unchanged at 0 errors / 46 pre-existing warnings.
- **A real 476-page book off disk** (`~/Downloads/The 48 Laws Of Power`, normal fonts): 1867 paragraphs,
  1373391 characters, 26.8% common English words, zero control characters - and **identical** before and after
  both fixes, which is the point. Nothing in a normal PDF's path changed.
- `public/pdfExtract.worker.js` rebuilt from the changed source (it is a build output - see the note below).

### Verified on the device, against the user's own books

Rebuilt as a **release** APK (`DEVTOOLS=1` for the measurements, then again without it), installed over the
existing app - library intact afterwards at 7 books, 1 highlight, 5 cached texts. Every number below is from the
real WebView on the OPPO CPH2001 over CDP, extracting through the app's own worker from the books' own stored
File blobs, writing nothing to the user's data.

| book | result |
|---|---|
| Osho, 444pp | 443 paragraphs, 0 blanks, cold extract 16.2s (first batch 1.2s). Text **identical** to the pre-fix cache once whitespace is normalized - letters and digits byte-for-byte, 0 of 443 prose paragraphs changed |
| Chess, 1180pp | 9006 paragraphs both. **1809 paragraphs newly rescued from cipher**, including the table of contents: `JIO@ION` -> `Contents`, `(<O@ DI /RJ` -> `2 Mate in Two 62`, and page after page of move notation (`` `vQI ON iO `` -> `BXc3+ 10 Kf1 Bf6`). Of 98 paragraphs that already read as prose, 91 are untouched and the other 7 were cipher that merely *looked* like prose to the check - all 7 improved |
| reader, warm open | Osho: 633ms tap to text, resumes at "Page 392 of 444"; 8 real `adb` taps advance 392 -> 393 -> 394, total constant. Chess: opens at "Page 83 of 1180" with a legible running header |

The Osho book shed 23412 characters of *intra-paragraph whitespace* (runs like `wisdom             OSHO`),
because `finishParagraph` now collapses after decoding what `decryptText` turns into spaces. No words changed.

`public/flowrecall-release.apk` is now this build - `webContentsDebuggingEnabled: false` confirmed inside the
APK, signed `CN=FlowRecall`, no `DEBUGGABLE` flag, and no devtools socket on the device after launch.

### The one thing this does NOT reach: caches that already exist

A cached record is only re-extracted when `PDF_EXTRACT_VERSION` changes, and it is still **2**. So the 1809
rescued chess paragraphs are what a *fresh* extraction produces - the user's own on-device copy keeps its
ciphered TOC until the book is re-added or the version is bumped. Bumping to 3 would fix it in one open (~16s
Osho, longer for chess) but has to carry the one existing highlight with it: it stores
`{paragraphIndex:104, start:1389, end:1393}` with phrase `"have"`, and collapsing whitespace earlier in that
paragraph moves those offsets. Since the change there is purely whitespace, a two-pointer walk from old text to
new maps the offsets exactly - the paragraph *count* is unchanged in both books, so saved reading positions need
nothing. Deliberately left undone pending that call.

---

## 🔴 START HERE — 2026-08-29 (guard rails): PDFs the reader can't read

Not new capability - the point is that a PDF the reader *can't* handle must never look like a broken app. Before
this, a scan opened as reader chrome with a blank page and no message, and a password-protected file was
reported as "corrupted", which sends someone off deleting a good book.

- `ReaderErrorState` (in `ReaderChrome.tsx`) is now a designed full-bleed state - `fixed inset-0` like the reader
  it replaces, since it used to strand itself mid-layout in the library page. Optional icon (three monochrome
  glyphs: `scan`/`lock`/`file`), a `context` line naming the book, a title, the explanation, and an optional
  secondary `action`. When there is no action, "Back to library" is the filled primary rather than a footnote.
  The other three callers (EPUB, text, missing-book) pass `message` only and inherit the new shell for free.
- `classifyPdfError` in `pdfTextExtract.ts` turns pdf.js's named exceptions into a `reason`
  (`password`/`invalid`/`unknown`) that survives the worker boundary, and `FAILURE_COPY` in `PdfReaderView` maps
  each to copy that says what happened and what to do about it.
- `assessPdfText` decides whether an extraction is worth reading: **none** (no paragraphs at all - a scan) or
  **sparse** (text exists but under `SPARSE_CHARS_PER_PAGE = 100` characters a page, over at least 5 pages).
  Sparse is a heuristic, so it is never a dead end: it offers **"Open anyway"**. The threshold has a wide margin
  - the sparsest real book on hand (the chess collection, nearly all move notation) runs at ~860 chars/page, 8.6x
  above the line. An empty extraction is still cached, so a 400-page scan reaches the verdict instantly on
  reopen instead of re-running a fruitless 15-second extraction.
- While verifying: `paragraphAtColumnPage` was naming the *last* paragraph starting on a column, so a screen
  showing several book pages at once reported the bottom one ("Page 6 of 6" on opening a 6-page document). It now
  takes the first paragraph that starts on the page, falling back to one spilling in from earlier. Reads
  "Page 1 of 6" now, and the Osho/chess counters are unchanged.

### Verified on the device, with fixtures built for it

`convert` (image-only, 6 pages) for a scan, `gs -sUserPassword=` for a locked PDF, and a 6-page Ghostscript text
PDF carrying one page number per page for the sparse case. Injected straight into IndexedDB over CDP (the native
file picker is not scriptable), then **deleted again** - library back to its original 7 books, 1 highlight, 5
cached texts.

| fixture | result |
|---|---|
| image-only PDF | "No text in this PDF", scan icon, book title above it, single primary action |
| password-protected | "This PDF is locked" + how to fix it - not "corrupted" |
| ~5 words over 6 pages | "Almost no readable text", **Open anyway** works and opens at "Page 1 of 6" |
| Osho (443pp) | unaffected: Page 393 of 444, bar 0.8849 = 392/443, no blanks |
| Chess (1180pp) | unaffected: Page 80 of 1180, bar 0.0670 = 79/1179 |

38 tests pass (15 in `pdfTextExtract.test.ts`, covering `assessPdfText` thresholds and `classifyPdfError`).

### What this does NOT fix - read before shipping

Still true, and all of it silent to the user: **two-column PDFs interleave their columns** (verified: the chess
book's `"1463 1...QXa2+1489 1.Re6"` is two separate columns merged), figures/tables/equations are dropped
entirely, and **non-English PDFs are an untested corruption risk** - `detectCipherShift` short-circuits on a high
letter ratio *plus* English function words, so a German or Hindi PDF falls through to trigram matching against
English targets and could apply a shift to text that was already fine. That is the one failure mode that makes
good input worse; it needs a real non-English PDF before anyone claims otherwise. Coverage so far is two real
books plus three fixtures, on one device (Android 11, WebView 150), one screen size.

---

## 🔴 START HERE — 2026-08-29 (later): the three post-extraction reader bugs, fixed and measured

Follows directly from the defect list in the session below. All three are fixed, plus two problems the fixes
themselves exposed. Every number here is from the physical device (OPPO CPH2001) against the user's own books.

### 1. Blank paragraphs are gone (`pdfTextExtract.ts`)

`extractPdfParagraphsStreaming` now drops paragraphs that are whitespace-only *after* decoding, and rebuilds
`pageToParagraphIndex` against the filtered array (a page whose own first paragraph was dropped points at the
next surviving one; a page that survived nothing gets no entry at all). The Osho book went **1328 paragraphs ->
443, 885 blanks -> 0**, with 8 unit tests in `pdfTextExtract.test.ts` covering the index arithmetic.

`PDF_EXTRACT_VERSION` is 2. A v1 record is **not** re-extracted: the surviving paragraphs are byte-identical, so
`PdfReaderView` filters the cached array in place, remaps `pageToParagraphIndex` and the TOC anchors through
`blankFilterRemap`, and moves the saved reading position and every highlight with it - then persists the moved
position, because nothing would remap it on a later open. Verified on the user's real highlight: paragraph
**312 -> 104**, character offsets untouched, same words. Cross-checked by then cold-extracting a different copy
of the same PDF: 443 paragraphs / 1254141 chars, **identical** to the upgraded record.

### 2. Window slides no longer skip text (`TextReaderCore.tsx`)

`goToNextPage`/`goToPrevPage` used to just move `activeFocusIndex` by 15, leaving the re-pagination effect to
fall back to the *old* window's page index - which is different content once `windowStart` has moved.
`shiftWindow` now captures the paragraph the reader is looking at, re-centres the window on it (so it is
guaranteed to still be rendered), and carries a `pendingPageDeltaRef` of +/-1 so the turn that caused the slide
advances exactly one page in the new window's coordinates. The slide also renumbers every column, so the
`transform` transition is dropped for that one frame (`instantJump`) - otherwise the reader whooshes through
dozens of pages. Measured across a slide: page 392 -> 393 with the same paragraph still at the top.

### 3. The page counter is the book's own, and the bar agrees (`TextReaderCore.tsx`, `textReaderUtils.tsx`)

- New optional `pageMap` / `pageCount` props (PDFs pass `pageToParagraphIndex` and the real page count, now
  stored on the cache record). A binary search over the page table turns the current paragraph into a real page
  number; `progressFor` derives the bar from that same page, so the two cannot disagree - measured exact at
  every sample, e.g. page 384/444 -> bar 0.8646 = 383/443.
- `getPageInfo` measures the **content element's** `scrollWidth`, not the scroll container's. Paging translates
  that element, and a transform shrinks the container's scrollable overflow - which is what made the total count
  *down* ("Page 1 of 34" ... "Page 18 of 18"). This fixes the plain-text reader's counter too, which had the
  same bug with no page map to lean on.
- `locateAnchorPage` is now layout-based (`offsetLeft`) rather than rect-based. Rects report wherever the 300ms
  page-turn animation currently is, so a read during a turn resolved to the page being left behind.
- Reporting is centralised in `reportPosition`, so the counter, the bar and the saved position all come from one
  paragraph index.

Measured: **"Page 384 of 444"**, constant total, monotonic across 34 consecutive turns and across a window
slide. Chess PDF: "Page 63 of 1180", also stable. A pasted note with a single paragraph has no paragraph-level
progress, so the bar falls back to the column fraction (0 -> 1 across its 3 pages).

### The regression fix 1 caused, and the window budget

Removing the blanks **tripled the text in every virtualization window** (they were two thirds of it), so CSS
multi-column had 154k characters and 227 columns to fragment: a **3.9 second** main-thread stall on warm open.
The window is now sized by characters, not paragraph count (`WINDOW_TARGET_CHARS = 45000`, capped at 50
paragraphs), because paragraph size varies ~50x between these two books:

| | window | stall on warm open |
|---|---|---|
| Osho, 50-paragraph window | 154k chars, 227 cols | 3863 ms |
| Osho, character-budgeted | 45.6k chars, 67 cols (15 paragraphs) | **378 ms** |
| Chess (unchanged by the budget) | 14.2k chars, 34 cols | 56 ms |

Warm open of the Osho book is **84-131 ms** tap to text (was 113 ms, on 3x less data). Cold extraction is
unchanged: first paragraphs 1.97 s, whole 444-page book ~15 s in the worker, worst stall 300 ms.

### Still open from the list below

Legacy `{"page":11,"scale":0.85}` positions from the old canvas reader (two Osho copies still resume at the
start), TOC coverage/garbled titles, the missing `wasmUrl`, and two-column PDFs interleaving. `public/flowrecall-release.apk` is still stale.

---

## 🔴 START HERE — 2026-08-29: PDF extraction moved off the UI thread, then measured on the real device

The three cheaper PDF performance fixes (IndexedDB text cache, deferred TOC, gating paginated paint on
`containerWidth > 0`) landed in `ecb246d`. This session closed the last one: **extraction no longer runs on the
UI thread at all.**

### What changed

- `src/workers/pdfExtract.worker.ts` (new) owns the whole document - `getDocument`, streaming extraction, then
  the TOC scan - and posts finished paragraphs back. `src/lib/pdfExtractClient.ts` (new) spawns it, adapts its
  messages to callbacks, and falls back to main-thread extraction if a module worker can't be created.
- `PdfReaderView.tsx` drives that client instead of pdf.js directly. Extraction heuristics
  (`detectCipherShift`, `pageParagraphs`, `decodeBatch`) are untouched - they just execute elsewhere.
- **Turbopack does not bundle workers.** `new Worker(new URL("./x.ts", import.meta.url))` is emitted as a raw
  `.ts` static asset, which the browser can't parse - it silently fell back to the main thread. So
  `scripts/copy-pdf-worker.mjs` now esbuild-bundles the worker to `public/pdfExtract.worker.js` (wired into
  `dev`, `build`, `build:apk`, `postinstall`; `esbuild` pinned in devDependencies). Treat that file as a build
  output.
- pdf.js, running inside our worker, cannot spawn its *own* nested worker ("Setting up fake worker") and also
  installs its own `self.onmessage` and greets the page in its own protocol. Hence `addEventListener` in the
  worker and "ignore unknown message types" in the client - without the latter, that stray message tore down
  extraction on page one.
- `capacitor.config.ts` gained `android.webContentsDebuggingEnabled: process.env.DEVTOOLS === '1'` (default
  **off**). `DEVTOOLS=1 npm run build:apk` makes a *release* build inspectable on-device, which is the only way
  to see console output or run timings in the real WebView without installing a debug build (that would wipe
  the user's library). Everything below was measured that way: `adb forward tcp:9222
  localabstract:webview_devtools_remote_<pid>` then Playwright's `chromium.connectOverCDP`.

### Measured on the physical device (OPPO CPH2001, Android 11, WebView 150)

| | before | now |
|---|---|---|
| warm open (cached text, 443pp) | - | **113 ms** touch → first paragraphs painted |
| cold open, first paragraphs | ~1 min blank | **1.9 s** (12-page first batch) |
| cold open, whole 444-page book | 60 s+, UI frozen | **~15 s**, in the worker |
| worst main-thread stall during extraction | seconds | **84 ms** |

`workers seen: ["https://localhost/pdfExtract.worker.js"]` - the worker path is real on-device, not the
fallback. Re-extracting the Osho book produced a cache record **identical** to the pre-worker one (1328
paragraphs, 1255026 chars, 443 pages), so relocating the pipeline changed no output.

### Extraction-quality defects found on the user's real books (NOT yet fixed)

These are the next thing to work on. All measured from the on-device cache, not inferred.

1. **66.6% of the Osho book's paragraphs are blank** - 885 of 1328 contain nothing but a single space, and they
   render as real `<p class="mb-6">` nodes (26 of 40 in the window, ~1430px of dead space). Root cause is
   visible in the console: dozens of `Type3 font resource "G4F" is not available` warnings. Those glyphs decode
   to nothing, and `decodeBatch` never drops a paragraph that is blank *after* decoding. Fix is a filter on
   decoded output - no change to `detectCipherShift` needed.
2. **Paragraph splitting under-detects on the same book** - the real paragraphs come out at 2600-3000 chars
   (one per page, 633px tall). `pageParagraphs` splits on a vertical gap > 1.5x line height, and with Type3
   metrics missing the heights are wrong, so a whole page merges. Combined with (1): 26 tap-to-turns advanced
   the reader from paragraph 0 to 19. The book is ~1700 taps long.
3. **"Page X of Y" is doubly wrong.** `getPageInfo()` measures `scrollWidth` of the ~50-paragraph virtual
   window, so the total is window-local; and because paging uses `transform: translate3d` (not `scrollLeft`),
   `scrollWidth` *shrinks* as you advance. Observed live: "Page 1 of 34" → "Page 3 of 33" → ... → "Page 18 of
   18", then "Page 18 of 37" when the window grew. The real page map (`pageToParagraphIndex`) is cached and
   used only for TOC anchors - invert it and derive a truthful page number from the paragraph index.
4. **TOC coverage is ~12%** - 4 entries for a 443-page book with 16+ chapters, and 2 of the 4 are body-text
   lines, not chapters ("part of the court mannerism, that ..."). The text scan's regex can't match ciphered
   lines because `decodeBatch`'s voted document shift is never shared with `extractPdfToc`; short bookmark
   titles fail `detectCipherShift` on their own (the chess book's TOC contains a literal `JIO@ION`).
5. **Two Osho copies carry legacy `{"page":11,"scale":0.85}` positions** from the old canvas reader.
   `parseTextReadingPosition` finds no `paragraphIndex`, `parseScrollFraction` gets NaN → 0, so those books
   silently resume at the start. `pageToParagraphIndex` could migrate them.
6. **pdf.js wants a `wasmUrl` we don't ship** - `#instantiateWasm: Ensure that the wasmUrl API parameter is
   provided` and `Failed to resolve module specifier 'nulljbig2_nowasm_fallback.js'`. Harmless for text today;
   it blocks JBIG2/JPX image decoding, which matters the moment figures get rendered. Copy `pdfjs-dist/wasm/`
   in the same script and pass `wasmUrl`.
7. **The chess book's diagrams are figurine-font text**, not images - paragraph 1 is
   `"rmblkans opopopop 0Z0Z0Z0Z ..."`. And its move columns interleave (`"1463 1...QXa2+1489 1.Re6"` is two
   separate columns) because `pageParagraphs` merges anything sharing a baseline within 2pt. Any 2-column PDF
   has this problem.

Verified working on-device this session: warm/cold open, tap-to-turn, TOC jump (`jumpToAnchor` lands exactly on
the entry's paragraph), long-press → selection → Define/Highlight/Copy popover.

`public/flowrecall-release.apk` is **stale** - it predates the worker work. Rebuild before any upload.

---

## 🔴 START HERE — 2026-08-23: Level 2 cloze rebuilt, full audit, Play Store release-ready

Long single session driven entirely by live user feedback on the Level 2 "fill in the blank" cloze challenge, each round found via the user actually using the feature and reporting what felt wrong - not pre-planned. Ended up touching grading correctness, a color-system gap, dead code, database migration history, and (for the first time) automated tests. Everything below was type-checked, linted, built, and verified live (on the physical Android device for anything UI-visible, against the real production database for anything DB-related) before committing.

### Level 2 cloze: from "bolted onto swipe" to a real independent question, then honestly graded

- **The whole feature was rebuilt from scratch this session** after the user tried a first version (cloze answer shown as a follow-up on the same swipe card) and correctly called it useless - the answer was already visible from the swipe side, so there was nothing to actually recall. Now: `ClozeChallenge.tsx` is a fully separate component, and `src/lib/studyQueue.ts`'s `buildConceptQueueItems` guarantees every concept gets **two independently-shuffled lanes** (one swipe, one cloze) that are never adjacent in the feed - built as two independent permutation "rounds," not a shuffle-then-patch (an earlier flat-shuffle approach failed a real 3-concept test case; see that function's doc comment and its test in `studyQueue.test.ts`).
- **Grading went through three real, user-driven iterations**:
  1. First cut: strict normalized-string match (case/whitespace only). User found it marked correct answers wrong over simple wording differences.
  2. Added `src/lib/clozeMatch.ts`'s `normalizeForCompare` (articles, trailing punctuation, per-word plural/verb-conjugation `s` - deliberately per-word, not end-of-string-only, since a verb mismatch can land anywhere in a multi-word answer) **plus** a self-report fallback ("did you get it right?" buttons) for anything the normalizer still missed.
  3. User's key objection, verbatim-in-spirit: a casual/dishonest tap on those buttons could mark a wrong answer "correct" with nothing checking it. **Final architecture**: `/api/cloze-grade` (new route) makes an AI call - fired the instant a non-exact answer is submitted, in parallel with the student choosing, never gated behind their tap - and its verdict is authoritative even if it contradicts what the student picked. Self-report only survives as a last-resort fallback if the AI call itself fails (network/parse error), and even then it's preceded by a short forced-then-removed pause (the user also asked to cut an anxiety-inducing artificial wait once the AI became the source of truth for the *common* path).
  4. The ingest prompt (`/api/ingest`) also needed a fix here: the AI was putting a full restated sentence in `answer` instead of the literal blank-filler, which is what made even the *correct* exact-match path fail on genuinely right answers.
- **Rate limiting** (`src/lib/clozeGradeRateLimit.ts`): this AI call fires automatically during normal study, not on a deliberate action, so it's an abuse ceiling (200/day/user, FREE and PRO alike, same free model either way) rather than a plan-gated feature limit like `decksGeneratedToday` - a hard low cap would break the honest-grading guarantee mid-session for a heavy studier. Integration-tested against the real database (disposable users, deleted after each test) rather than mocked, since the whole point is Postgres's atomic-increment/day-rollover semantics.

### Color tokens: found and fixed a real "Pure Monochrome" violation

`SwipeChallenge.tsx`/`ClozeChallenge.tsx` were already using hardcoded `emerald-*`/`rose-*`/`amber-*` Tailwind classes for correct/incorrect/pending feedback with zero representation in `globals.css`'s token system - an undocumented violation of the "Pure Monochrome" exception rule (see "Design philosophy to preserve" further down, already updated to reflect this), not something this session introduced. Formalized as `--success`/`--danger`/`--pending` (same `H S% L%` + `@theme inline` pattern as `--reader-highlight`/`--pulse-accent`), with real light-mode variants added (the old hardcoded classes had none - `text-emerald-400` etc. never adapted to light mode at all).

### Level 3 vestige removed

`ChallengeLevel` was typed `1 | 2 | 3` with no code path ever assigning `3` (`buildConceptQueueItems` only ever picks 1 or 2) - a leftover from an original 3-level design (`ChatChallenge`, free-text "teach it back" graded via LLM) documented in the "2026-08-22, earlier session" block further down, whose component never survived an earlier rewrite. Narrowed the type to `1 | 2` and deleted the orphaned `/api/grade` route (confirmed zero references anywhere first) that was its unused grading endpoint. If a real Level 3 ever gets built, it's a from-scratch feature, not a resurrection - nothing of the old design survives except that route's now-deleted Feynman-style grading prompt as a reference point.

### Database migration history was silently broken - now fixed, carefully

Investigating why `prisma migrate dev` reported drift (and offered a full schema reset — **did not run it**, see the environment-quirks note below) found that nearly this entire schema - every billing field, every gamification/limit counter, the whole `StudyDay` table - was added to production directly at some point (almost certainly `prisma db push`) without ever generating a migration file, and separately, the two migrations that *did* exist (`init`, `add_used_mobile_bridge_token`) were never marked applied in Prisma's own tracking table at all. Both fixed without touching any live data or running schema-modifying SQL against production:
- Hand-wrote (not tool-generated - `prisma migrate diff` renders this gap as an unsafe-to-replay DROP+CREATE because of a `plan` enum→text change) a purely additive gap-fill migration, **validated by actually running the full migration sequence via `prisma migrate deploy` against a genuinely fresh scratch schema** on the same Postgres server before touching production.
- Marked all new/previously-untracked migrations applied via `prisma migrate resolve --applied` against production (this only writes to Prisma's tracking table, never executes the migration's SQL).
- `prisma migrate status` now reports "Database schema is up to date" against production.

### First automated test suite (`npm test`, Vitest)

Every verification up to this point in the project's life has been manual/live-device or a disposable throwaway script. Added Vitest (`vitest.config.ts`, `@/*` alias wired) and pulled the three most regression-prone pieces into testable `src/lib` modules, each test file covering a bug that was actually found live this session (see each file's comments for the specific case): `clozeMatch.test.ts`, `studyQueue.test.ts` (200-trial randomized non-adjacency check), `clozeGradeRateLimit.test.ts` (real-DB integration test, disposable users). 23 tests, all passing.

### Full app audit (billing, reader, auth) - one real finding, fixed

Three parallel independent audits (each scoped to an area untouched by tonight's cloze work, so genuinely unchecked since an earlier session) came back clean except for one real, low-severity security gap:

- **Billing (Stripe + Razorpay)**: no issues. Signature verification is timing-safe (`crypto.timingSafeEqual` via a length-safe wrapper) on both gateways, user attribution can't be spoofed (always resolved server-side from `client_reference_id`/`order.notes.userId`, never from client-supplied data), no route trusts a stale JWT for a Pro gate (`resolveEffectivePlan()` always re-reads Postgres), cancellation and self-healing expiry both work. Two non-urgent notes: `planStatus` is written but never read anywhere (dead weight), and a failed Stripe payment can extend Pro access up to one billing cycle before self-healing catches it (likely an intentional grace period, not confirmed as a defect).
- **Reader (PDF/EPUB/text)**: no issues. Highlight positioning math, IndexedDB persistence, and `/api/define`'s rate limit all held up under a security-conscious read. One purely theoretical edge case (a zero-size PDF page box at selection time) isn't worth fixing - no realistic path reaches it.
- **Auth - one real finding, fixed** (`src/auth.ts`): the credentials `authorize()` function returned near-instantly (~5ms) for a nonexistent or Google-only email, but called `bcrypt.compare()` (~50-100ms) for any email with a password set, regardless of whether the password matched - a timing side-channel that lets an attacker enumerate which emails have password-based accounts. Fixed by running `bcrypt.compare()` against a precomputed dummy hash (`DUMMY_HASH`) on the no-password path too. Confirmed the gap dropped from ~55ms to ~6ms (noise-level) in a direct before/after timing comparison.

### Native hero background bug - two rounds, real lesson on verification

User-reported: the native app's home hero background "feels twisted/weird," later specifically "a visible grey box near Start ingesting notes... it would be better with pure black."

- **Round 1** (`ac603de`): root-caused via live Chrome DevTools inspection over the installed app's own devtools socket (`adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>`, found via `adb shell cat /proc/net/unix | grep devtools`, then `chromium.connectOverCDP()` from Playwright) - not guesswork. The hero's decorative "spotlight grid" has a radial-fade mask sized as a percentage of its own box; native's hero has no min-height (unlike web's `min-h-[88vh]`), so on that short box the fade compressed into a visibly gridded patch. Made the grid web-only. **Verified via a CDP screenshot showing the patch gone - and still wasn't the full fix.**
- **Round 2** (`0511e8e`, done via `EnterPlanMode` after the user asked for a properly-planned fix): the grid removal left the *other* decorative layer - three blurred glow orbs, tuned for web's tall hero - still rendering unconditionally on native. With the grid gone, the bottom-right orb (positioned right near the CTA buttons) stood out on its own as an isolated grey blob, which is what the user was actually seeing. Fixed by making native's hero flat pure black - no grid, no orbs at all - rather than continuing to fine-tune individual glow artifacts. Also closed ~160px of uncoordinated dead space between the hero and `FeaturesSection` ("Why FlowRecall") - two independent paddings (`pb-16` hero, `py-24`/`py-32` section) were stacking with no native-aware reduction on either side.
- **The methodology lesson, worth remembering**: a CDP/WebView screenshot is a faithful render of *what you checked* - Round 1's screenshot genuinely proved the grid was gone, but proved nothing about the orb, which nobody had hypothesized yet. **When a background/visual bug has multiple decorative layers, check that ALL of them are addressed, not just the one already-hypothesized to be at fault.** Round 2 also force-stopped the app before reinstalling (`adb shell am force-stop`, not just relaunching) and cross-checked a real `adb exec-out screencap` alongside the CDP screenshot, specifically to rule out a stale-process false-verification.

### Play Store release-readiness deep check

Went beyond "does the code work" to specifically check what could get the app **rejected or removed post-launch**, since that's a materially bigger deal than an ordinary bug:

- **Payment policy compliance (the one that actually mattered)**: Google Play requires apps selling digital subscriptions to use Google Play Billing for any purchase flow *initiated from within the app*, with limited exceptions. Verified `src/app/pricing/page.tsx` already handles this correctly - on native, the page shows "Upgrade at flowrecall.app on the web" instead of a buy button and never triggers Razorpay checkout; grepped for any client-side call to `/api/stripe/checkout` and found none anywhere - that route exists on the server but nothing in the UI calls it. No in-app purchase flow exists on Android at all, which is the compliant pattern (same reason Netflix/Spotify's Android apps don't let you subscribe in-app).
- `AndroidManifest.xml` declares only the `INTERNET` permission - nothing to raise review scrutiny.
- Privacy policy confirmed live (`curl` → HTTP 200) at `/privacy`, required for both the listing and Google OAuth verification.
- The release AAB/APK need rebuilding **every time shippable code changes** - this bit us mid-session (an AAB built hours earlier was missing the hero fix, rate limiting, auth fix, and migration work). Rebuilt and re-verified (`jarsigner -verify`, `jar verified.`) as the very last step before calling anything "ready."
- **Distinguishing a debug install from a release install on a real device**, since this came up directly: `adb shell dumpsys package <pkg> | grep pkgFlags` - a debug build shows `DEBUGGABLE` in the flags, a release build doesn't. For certainty, pull the installed APK (`adb pull $(adb shell pm path <pkg> | cut -d: -f2)`) and run `apksigner verify --print-certs` (at `$ANDROID_HOME/build-tools/<version>/apksigner`) - a debug build's cert `DN` literally reads `CN=Android Debug`; the release cert reads whatever your keystore's DN is (`CN=FlowRecall` here). `jarsigner`/`keytool -printcert -jarfile` do NOT work reliably on modern APKs signed with Signature Scheme v2+ (reports "Not a signed jar file" even on a validly-signed release build) - use `apksigner`, not `jarsigner`, for APK/AAB certificate inspection.
- **Data Safety form answers and the store listing description were drafted in an earlier session's conversation but never saved to a file - lost.** Rewritten from a direct read of the codebase (not guessed) and saved this time to `play-store-assets/store-listing-and-data-safety.md`, so this can't happen again. Notable finding while drafting it: decks and highlights live only in the browser/app's local storage (localStorage/IndexedDB) - **never in the Postgres database** - which means the app collects meaningfully less user content server-side than a skim of the feature set might suggest.
- Re-verified live (fresh test battery, not recalled from memory) that `/api/cloze-grade`'s "judge the core concept, ignore wording" behavior actually holds: 5 fresh cases with a student answering entirely in their own casual words all graded correctly, including correctly *rejecting* a confidently-worded but wrong mechanism - the system isn't just lenient across the board, it's actually judging meaning.
- **Bottom line as of this session: the app is genuinely code-ready to submit.** What's left is entirely outside the codebase: (1) the Google Play Developer account itself - $25 fee, blocked on the user getting their debit card; (2) recapturing `play-store-assets/screenshots/`, which predate this whole session's redesign (the study-feed one especially no longer matches); (3) adding Play App Signing's SHA-256 to `public/.well-known/assetlinks.json` - only possible *after* the first Console upload gives you that fingerprint, so it's sequenced, not skippable. A full upload walkthrough (account creation → required Console sections → listing assets → uploading `app-release.aab` → the post-upload assetlinks.json step → submitting for review) was given to the user in conversation but not saved to a file - if a future session needs to repeat it, it's a fairly standard Play Console flow, cross-reference against Play Console's own current UI rather than assuming these exact menu names/steps haven't shifted.

### Environment quirks specific to this session (additive to the lists further down)

- **Never run `prisma migrate dev` non-interactively against a database with any real drift.** It detects the mismatch and offers `migrate reset` (drops the entire schema) - the offer itself is harmless, but there's no way to safely decline an interactive prompt from a non-interactive shell, so the command just aborts. Use `prisma db execute --file` (raw SQL, no drift check) + `prisma migrate resolve --applied` instead for any hand-applied migration.
- `npx vercel --prod` can silently self-upgrade to a new CLI version mid-session and lose the project link (`.vercel/project.json` goes missing, deploys fail "Not authorized" even though `vercel whoami` looks fine). Fix: `vercel link --yes --project flow-recall --scope flow-recall`, then retry the deploy.
- `git push` needs the user's own interactive credentials - can't be done non-interactively from this shell. Surface a reminder rather than assuming it happened; check `git status`'s "ahead of origin" line, not just "committed."
- **This project's Vercel deployment auto-redeploys on every `git push` to `main`** (GitHub integration), *in addition to* any manual `vercel --prod` - don't assume a "52-second-old" production deployment you didn't just trigger is suspicious; check its `githubCommitSha` via the Vercel REST API (`api.vercel.com/v13/deployments/get?url=<url>`, `meta.githubCommitSha`) before wondering where it came from.
- A Postgres shadow database for `prisma migrate diff` doesn't need a separate DB instance - point `--shadow-database-url` at the same server with a different `?schema=` query param and Prisma manages it automatically. Useful for exactly the drift-investigation work above without provisioning anything new.
- `node script.mjs` resolves `node_modules` relative to the *script's own path*, not `cwd` - a script written to a scratch/tmp directory can't `import` project dependencies even when run from inside the project directory. Copy it into the project root first (and delete it after).
- Chrome DevTools Protocol works great for on-device debugging of a Capacitor debug build: find the socket via `adb shell cat /proc/net/unix | grep devtools` (name includes the WebView's PID, changes on every relaunch), `adb forward tcp:9222 localabstract:<that_socket_name>`, then `playwright`'s `chromium.connectOverCDP("http://localhost:9222")` gives a real `page` you can `.evaluate()`/`.screenshot()` against - far more reliable than guessing from compressed `adb screencap` output alone. Only works on a debug build (`debuggable` must be true); release builds don't expose this.

---

## 🔴 START HERE — 2026-08-22, later session: home hero redesign + two real bugs fixed

This session picked up right after the Play Store readiness + reader/home-page design pass documented in the "🔴 START HERE — 2026-08-22, earlier session" block below (now historical). That earlier pass shipped a home page redesign; this session was the user's live, iterative reaction to actually looking at that redesign on their phone - a long back-and-forth of "show me on-device → here's what's off → fix it → show me again," not one planned change. Everything below was typechecked, linted, and verified both cross-device (headless width sweep) and live on the user's physical Android device before being committed as `2044dad` and pushed to `origin/main` by the user.

### What changed in the hero (`src/app/page.tsx`)

- **Fixed the "dull at the end" headline.** The hero H1 and the closing CTA's H2 both used `bg-gradient-to-br from-foreground via-foreground/70 to-foreground/40 bg-clip-text text-transparent` - on a long wrapping headline, that diagonal fade meant the punchiest words landed at 40% opacity, which read as dull, not premium. Both are now solid, full-contrast `text-foreground`. No new color tokens - stays inside "Pure Monochrome."
- **Hero headline copy is now "Stop re-reading. Start recalling."** - moved up from the closing CTA (the user explicitly liked that line). The closing CTA needed genuinely different copy so the two sections don't just repeat each other with different words - it now leads with a research-backed problem statement instead of another imperative: **"You'll forget most of this by tomorrow."** / *"That's the forgetting curve talking, not a guess. FlowRecall's spaced repetition is built to beat it."*
- **Hero subheading tightened** to one line: *"Upload your first PDF and see your first flashcard feed in under a minute. No credit card required."* Per explicit user instruction: **no em dashes anywhere in visible copy on this page**, and no "free forever" framing (the product has a real Pro upsell to protect - "free forever" undersells it). ⚠️ The closing CTA's own paragraph still uses a plain hyphen ("...under a minute - no credit card required") and the FAQ/Features/HowItWorks sections still use dashes too - the user explicitly deferred that sweep ("just these two for now"), so it's still outstanding if raised again.
- **Stripped the desktop hero's decoration down to just grid + glow + film grain.** Cut the giant rotated marquee background text and the floating mouse-parallax mock cards (`MOCK_CARDS`/`ParallaxCard`) - four layered decorative devices plus a card cluster was competing with the headline for attention, the opposite of the "elite premium" look being chased. This was a deliberate, user-approved A/B: shown side-by-side screenshots of "with" vs "without," user picked "without." All now-dead code was fully deleted (not just commented out): `MarqueeBackground`, `MARQUEE_ROWS`, `MockCard` type, `MOCK_CARDS`, `ParallaxCard`, and the `useMotionValue`/`useSpring`/`useTransform` mouse-tilt plumbing (`mouseX`/`mouseY`/`smoothMouseX`/`smoothMouseY`/`handleMouseMove`/`handleMouseLeave`) that only existed to drive it.
- **Cut the mobile hero's card row entirely**, in two steps: first the boring mitochondria/photosynthesis example cards went (same "fill space with an example" instinct as the desktop marquee/cards), then the streak card went too (user: "keep the stop reading main headline on the centre, it would look much cleaner"). Removing the streak card's trigger also made `StreakModal` unreachable on this page (no other way to open it), so it - plus `useSession`/`session`/`status` and the now-orphaned `SwipeFooterIcons`/`FlameFooter` helpers - were removed too rather than left as dead weight. Mobile hero is now just badge, headline, subhead, and the two CTA buttons.
- **Fixed a real mobile overflow bug**, caught during on-device verification: the hero's content wrapper (`<div className="relative z-10 flex flex-col items-center">`) had no explicit width, so with the new (shorter) subheading text its fit-content auto-sizing computed itself ~45px *wider* than the phone viewport, clipping the paragraph on both left and right edges. Root-caused via `getBoundingClientRect()` probing in Playwright, not guessed - fixed by adding `w-full` to that wrapper (`w-full max-w-xl` was also added to the paragraph itself, belt-and-suspenders). Confirmed fixed both headlessly and on-device.
- **Verified cross-device before calling it safe**: swept hero layout at 320/360/375/393/412/480/600/800px CSS widths in headless Chromium - zero horizontal overflow at any width, headline holds a clean 2-line wrap even at the narrowest realistic Android width (320px). One caveat worth knowing: the headline/subhead use CSS `text-wrap: balance` (needs Chromium 114+ WebView) - on an old unupdated WebView it just falls back to normal wrapping, not a real risk.
- **Native-only hero spacing**: the badge stays anchored high near the top (`pt-6`, unchanged) per explicit user instruction ("keep that badge at the top where it is right now"); the H1 got its own `isNative ? "mt-12" : ""` margin so it sits in a calmer, more centered position *without* moving the badge. Tuning history, in case it comes up again: tried `pt-20` section-wide first - rejected, it moved the badge too; then tried headline-only `mt-16` - liked the direction but felt it plus the empty space below the CTAs was too much stacked whitespace; settled on `mt-12`.
- **One diagnosis was wrong and got walked back** - worth knowing so a future session doesn't repeat it: an earlier finding of "a big dead gap after the CTAs for new/signed-out users" was based on testing the *web* layout path (`justify-center`) by accident, since a plain browser never trips `Capacitor.isNativePlatform()`. On the actual native code path, `FeaturesSection`/`HowItWorksSection`/`FaqSection`/`FinalCtaSection`/`SiteFooter` all render unconditionally right after the hero (no `isNative` gate on any of them) - so there's no dead end, scrolling just continues into real content. No fix was applied for this.

### Bug fixed outside the hero: free-tier deck continuation

While answering an unrelated question about the reader's definition-lookup paywall, found and fixed a real bug in `/api/ingest`'s free-tier gate (`src/app/api/ingest/route.ts` + `src/app/page.tsx`'s `handleGenerateNextSection`): a free user's lifetime "1 deck" limit is only supposed to gate/increment on a request's *first* chunk (`isFirstChunk`, default `true`). The home page's "Generate Next Section" button (continuing a large deck's already-pending chunks) never sent that flag at all, so it defaulted to `true` - meaning a free user finishing their own already-started deck would get wrongly re-blocked by the same lifetime-limit check, and shown the raw internal string `"FREE_LIMIT_REACHED"` as if it were a real error message. Fixed by sending `isFirstChunk: false` from that continuation call. Product call (confirmed with the user before fixing, since it's a policy decision, not just a bug): finishing an already-started free deck should be free, not a second paywall moment.

### Confirmed-fine, not changed

- Reader's definition-lookup limit (`FREE_DEFINITION_LIMIT = 20`, lifetime, server-enforced in `src/app/api/define/route.ts`) - user considered raising it to 100, decided against it after discussion (100 would undercut the paywall almost entirely and reverses the same deliberate "1 deck for life" cost-conscious philosophy already established for ingest). Left at 20.
- Light mode was explicitly not checked this session - user's call ("people won't use light mode for sure, dark mode is more comfy"). Every color changed this session uses existing theme-aware tokens (`text-foreground`, etc.), so it should adapt automatically, but this has not been visually confirmed.

### Environment quirks specific to this session (additive to the list further down)

- **`adb` is not on `PATH` in this sandbox** - it exists at `~/Android/Sdk/platform-tools/adb` (also `~/Android/platform-tools/adb`). Either `export PATH="$HOME/Android/Sdk/platform-tools:$PATH"` or call it by full path every time.
- Device confirmed connected and used for on-device verification all session: a OnePlus/Oppo-branded device, model `CPH2001`, serial `W4O7RWNJSOAEJVU8`.
- After `adb install -r` + relaunching the app, the WebView needs a beat to finish loading - the first `screencap` immediately after launch reliably shows a black screen. Wait ~4-5s (or poll) before capturing.
- A `chromium.launch()` headless context can be made to think it's running inside the Capacitor native shell by setting `window.androidBridge = {}` via `page.addInitScript()` before `goto()` (Capacitor's `isNativePlatform()` just checks for `window.androidBridge`/a WebKit message handler). **Caveat, learned the hard way**: this makes *other* native-gated code paths think they have a real native bridge too (e.g. a splash/loading-state component), producing a stuck loading screen that looks like a bug but isn't - don't trust results from this trick without cross-checking against the actual DOM/render tree.
- **Never clear real app data/localStorage on the user's own physical device to test an empty state** - their account has real signed-in session state and a real saved deck. Test empty/fresh-install states in an isolated Playwright browser context instead (separate profile, zero risk to real device data).
- Headless Chromium against this `next dev` + Turbopack setup has a **first-load animation race**: `motion/react`'s `initial`/`animate` entrance animations sometimes don't finish before a fixed `waitForTimeout`, even at 1500ms, leaving elements stuck at `opacity: 0` and making a screenshot look like content is missing. Not a code bug - confirmed via `getComputedStyle` that a page *reload* (not fresh navigation) always settles correctly. Reliable fix: `page.waitForFunction(() => getComputedStyle(el).opacity === "1")` before screenshotting, not a fixed delay.
- A Playwright **`fullPage: true`** screenshot can look like it duplicates the navbar partway down the page and shows a huge false "empty gap" - this is a tiling/stitching artifact from how Chromium composites a full-page capture across multiple scrolled tiles, not real page content. Prefer a single tall non-scrolling viewport (`{ width, height: <tall enough> }`, no `fullPage`) to sidestep it entirely.

---

## 🔴 START HERE — 2026-08-22, earlier session

App is a Next.js 16 + Capacitor v8 Android app, Postgres/Supabase-backed, with real accounts (Google OAuth + credentials), Stripe + Razorpay billing, an AI flashcard pipeline (Groq/OpenAI/Anthropic), and a full EPUB/PDF/text reader. This session did two things: (1) closed out nearly everything needed to submit to the Google Play Store, and (2) did a significant design pass on the reader and home page. **Nothing is broken or half-done** — every change below was type-checked, linted, built, and verified live on the user's physical Android device before being committed.

### Play Store readiness — what's DONE

- **Privacy policy**: live at `/privacy` (`src/app/privacy/page.tsx`), linked from Account/login/register footers. Required for both the Play Store listing and Google OAuth verification.
- **Release signing**: `android/app/flowrecall-release.jks` + `android/keystore.properties` exist (both gitignored). `android/app/build.gradle` has a conditional `signingConfigs.release` sourced from `keystore.properties`. **The user has a plaintext backup at `~/Desktop/FlowRecall-release-keystore-credentials.txt`** — remind them to move it to a password manager and delete the file if that hasn't happened yet.
- **Mobile OAuth deep-link hardened, two layers**:
  1. Single-use bridge tokens — `UsedMobileBridgeToken` Prisma model, enforced in `src/app/api/auth/mobile-exchange/route.ts` (unique-constraint + P2002 catch).
  2. Verified Android App Link (not a bare custom scheme) — `public/.well-known/assetlinks.json`, `android:autoVerify="true"` in `AndroidManifest.xml` for `https://www.flowrecall.app/auth-callback`, config in `src/lib/mobileAuth.ts`. The old `flowrecall://` scheme is kept ONLY as a fallback (`src/app/auth-callback/page.tsx` forwards to it if the OS doesn't intercept the https link).
  3. ⚠️ **Follow-up once the app has its first Play Console upload**: add Google Play App Signing's own SHA-256 as a second entry in `assetlinks.json` (Play re-signs the APK with its own key, which won't match the upload-key fingerprint currently in that file).
- **Production outage prevented**: Supabase free-tier auto-pauses on inactivity — this caused a real outage earlier. Fixed with a Vercel Cron (`vercel.json` → `/api/cron/keep-alive`, daily) that pings the DB. **Confirmed actually firing** (user pasted real `vercel-cron/1.0` invocation logs showing `200`).
- **AI generation outage fixed**: Groq deprecated `llama-3.3-70b-versatile` mid-flight. Root-caused a second failure too (the replacement `openai/gpt-oss-120b`/`qwen/qwen3.6-27b` reasoning models silently burn the whole token budget on a hidden `<think>` block). Current `FREE_MODEL` in `src/lib/ai.ts` is `qwen/qwen3.6-27b` with `GROQ_PROVIDER_OPTIONS = { groq: { reasoningEffort: "none" } }` passed to every `generateText` call. Verified end-to-end with a live study session on-device.
- **Billing bug fixed**: Pro subscriptions never expired. `src/lib/billing.ts` now has `resolveEffectivePlan()` (checks `currentPeriodEnd`, self-heals via `revokePro`) wired into every route that gates on plan.
- **Auth hardening**: removed `allowDangerousEmailAccountLinking` from the Google provider in `src/auth.ts` (was an account-takeover-adjacent misconfiguration).
- **Google OAuth consent screen**: published to production by the user (confirmed).
- **Razorpay**: switched to live keys, redeployed, smoke-tested (confirmed working, real order created).
- **Play Store visual assets — all done and on disk**, `~/Desktop/Flowrecall/play-store-assets/`:
  - `icon.png` (512×512) and `feature-graphic.png` (1024×500) — the "sealed badge" design (Flag Mark logo in a raised rounded tile next to the wordmark). Editable source canvas: `https://claude.ai/code/artifact/09d014eb-e7c5-4be5-9c47-97727edc2660`.
  - `screenshots/01-home-hero.png` through `06-account.png` — captured on-device, cleaned up (status bar cropped out, the reader screenshot's real book content replaced with fictional text, the account screenshot's real name/avatar changed to a placeholder "Alex"/"A").
  - Store listing description and Data Safety form answers were drafted in conversation (not saved to a file — if lost, redo them, it's a quick pass).

### Play Store readiness — what's LEFT (all blocked on the user, not on code)

- Create the Google Play Developer account ($25 fee) — **blocked on the user's debit card arriving**.
- Once the account exists: paste the Data Safety answers into Play Console, upload the store listing description, upload the icon/feature-graphic/screenshots above, do the first APK/AAB upload.
- After the first Play Console upload: add Play App Signing's SHA-256 to `assetlinks.json` (see follow-up note above).
- Low priority / optional, deliberately deferred: rate limiting on `/api/auth/register` and credentials sign-in.

### Reader upgrades (commit `910d5d6`)

- **Reading highlights recolored blue.** New theme-aware-ish token system in `globals.css`: `--reader-highlight` (blue, `217 91% 60%`, same in both themes — used for the actual highlight marks/selection in `SelectionHighlight.tsx`, `EpubReaderView.tsx`, `PdfReaderView.tsx`, `TextReaderView.tsx`) and `--pulse-accent` (same blue in dark mode, but inverts to plain black in light mode — used for small "is this alive" status dots). These are the app's only two deliberate exceptions to its strict black/white "Pure Monochrome" system (documented at the top of `globals.css`).
- **Font size is now a +/- stepper**, not a slider (`DisplaySettingsMenu.tsx`). Bounds centralized as `FONT_PERCENT_MIN/MAX/STEP` in `src/lib/readerPreferences.ts`.
- **EPUB gained a Paginated/Scrolling toggle** (`epubScrollMode` preference). Switching forces a clean remount (epub.js can't safely hot-swap `flow` on a live rendition) via a `key` bump owned by `ReaderOpenDispatcher` in `src/app/reader/page.tsx`.
- **EPUB navigation fixed**: added an explicit prev/next pill (matching PDF's, which already had one) and a new "Chapters" jump list built from the TOC data that was already being parsed but never rendered. Also fixed the actual bug behind "tapping near the top of the screen flips the page" — the invisible edge tap-zones were `inset-y-0` (full screen height); now `top-[15%] bottom-[15%]`.

### Home page redesign (commits `bd61828`, `3bc78b7`, `fff44ea`)

The user's own words: home page "looks dull." Root causes, all fixed in `src/app/page.tsx`:
1. No closing CTA or footer anywhere — page just stopped after the FAQ. → Added `FinalCtaSection` + `SiteFooter`.
2. Decoration (glow orbs, film grain, floating cards) was gated `hidden md:block`/`lg:block` — **invisible on the user's actual device** (Capacitor/mobile), which was the single biggest reason it read as dull there. → Un-gated the cheap decoration, right-sized the expensive orbs to render smaller on mobile, added a mobile-only swipeable card carousel as a real touch equivalent of the desktop mouse-parallax cards.
3. Every section repeated the exact same centered-pill + centered-heading + centered-paragraph shape. → Added `HowItWorksSection`, the one deliberately left-aligned, no-pill, ghost-numeral section on the page.
4. Feature cards 2 and 3 looked unfinished next to card 1's glow+diagram. → Gave them small finished visuals (a streak-calendar strip, a before/after mock) instead of a bare repeated tag pill.
5. **Color discipline**: the mobile carousel briefly used the shared `<StreakCounter>` component for a real personalization touch — but that component's flame recolors by tier (blue → purple → amber → silver as a streak grows, see `StreakCounter.tsx`'s `getFlameTier`), which would have broken the home page's black/white/one-blue rule the moment a user's streak passed day 3. **Fixed**: that one card now uses a small inline pill hardcoded to the single blue, forever, regardless of streak length. Tapping it still opens the full-color `StreakModal` unchanged — that richer reward is fine on the deeper, opt-in surface, just not on the always-visible marketing page.
6. The gray/highlight scale had drifted into near-duplicate one-off values (3 different glow opacities, 6 different white-inset alpha values). Consolidated to one glow strength (two, for a deliberate near/far pair on one orb) and two highlight intensities (0.08 for monochrome glass surfaces, 0.18/0.22 resting/hover for accent buttons).
7. **Animation**: the user asked whether to cut all animation for max "clean" feel. Answer given and implemented: **no** — one-shot entrance/scroll-reveal/hover animations are what make Linear/Vercel/Stripe-style pages feel premium; cutting them would make it feel static and cheap. The ONE thing actually worth cutting was the background marquee text's perpetual infinite scroll (the only looping animation on the page) — it's now a static (but still visible, still dim/rotated) texture. Every other animation is untouched.

### Design philosophy to preserve in any future work on this app

- **"Pure Monochrome"**, documented at the top of `src/app/globals.css`: no color anywhere except contrast (white pops on black, black pops on white, fully inverting between themes via `[data-theme="light"]`).
- Two original deliberate hue exceptions, both blue, both explained by name in `globals.css`'s own comments: `--reader-highlight` (reading highlights, never inverts) and `--pulse-accent` (status dots, inverts to black in light mode).
- A third exception added 2026-08-23: `--success`/`--danger`/`--pending`, confined specifically to answer-correctness feedback (correct/incorrect/awaiting-verification) in the study feed - never structural or decorative chrome. Formalizes colors that were already in use as hardcoded, undocumented Tailwind classes before that session.
- A fourth, older, pre-existing exception: `StreakCounter`/`StreakModal`'s multi-color flame-tier system (blue/purple/amber/silver). This is confined to deep/opt-in surfaces (Account, Navbar, the streak modal) — **never reuse it on a page meant to hold strict monochrome discipline** (that was the exact mistake caught and fixed on the home page in the 2026-08-22 session below).
- Motion: keep one-shot and interaction-driven animation (entrance springs, `whileInView` scroll-reveal, hover transitions, cursor-parallax). Avoid perpetual/infinite looping motion in the background — it reads as attention-seeking, not premium.

### Environment quirks worth knowing (this sandbox specifically)

- **No GitHub push credentials.** Every session ends with local commits that the user has to `git push` themselves from their own terminal.
- Bash's cwd occasionally resets to `/home/dizzyeyes` between tool calls — `cd` explicitly or use absolute paths, don't chain `cd` across separate Bash calls.
- ADB device connection drops intermittently mid-session — just ask the user to check the USB cable and retry `adb devices -l`.
- Long sessions can leave a stale `next start`/`next dev` process squatting on a port from earlier testing. If a headless screenshot or curl check comes back unstyled/broken, check `lsof -ti:PORT` for a leftover process before assuming the code is broken — a stale server can serve HTML referencing CSS chunk hashes that no longer exist on disk after a rebuild, producing a 500 on the CSS file.
- Headless Chrome screenshots are unreliable for two things in this codebase: sections using `min-h-[88vh]` (scales with whatever `--window-size` height you pass, so there's no window size that gives correct proportions for both the hero and the rest of the page at once) and `motion/react`'s `whileInView` (IntersectionObserver often doesn't fire before a static screenshot is captured, even in a huge viewport). For both, either use `--print-to-pdf` (fixed page size, sidesteps the vh issue) or just trust on-device verification over fighting the headless tooling.
- Physical device: 1080×2400, but ADB screenshots are shown to Claude scaled down to 900×2000 — multiply the coordinates you see by 1.2 before calling `adb shell input tap/swipe`.
- Rebuilding the Android app after any web change: `npm run build:apk` (static-exports Next.js + `cap sync`) → `cd android && ./gradlew assembleDebug` → `adb install -r android/app/build/outputs/apk/debug/app-debug.apk`.

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
  copy-pdf-worker.mjs       postinstall/predev/prebuild: copies pdfjs-dist's worker build into public/, version-matched
                            automatically, and esbuild-bundles src/workers/pdfExtract.worker.ts to public/ as well
                            (Turbopack emits `new Worker(new URL("./x.ts", ...))` as a raw .ts asset, so Next can't
                            build that worker itself)

public/
  pdf.worker.min.mjs        vendored pdf.js worker (regenerated by the postinstall script, don't hand-edit; excluded
                            from eslint in eslint.config.mjs since it's a minified third-party file, not app code)
  pdfExtract.worker.js      our PDF text-extraction worker, built from src/workers/pdfExtract.worker.ts by the same
                            script - a build output, don't hand-edit
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
