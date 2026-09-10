# FlowRecall — Handoff

**Updated 2026-09-11, ~01:00 IST.** Start here. Older drafts: `git log --follow -- HANDOFF.md`.

Today was a feature and design session on the app itself. Nothing was committed and
nothing was shipped to Play — **all of today's work is uncommitted in the working tree.**

---

## Resume in 60 seconds

1. **The tree does not build.** `src/middleware.ts` (untracked, from a previous session)
   collides with `src/proxy.ts`; Next 16 throws `E900` and refuses. Delete it — its
   apex→www redirect is already live in `vercel.json`. Every build today needed it moved
   aside first. **This is step one tomorrow.**
2. **Nothing is committed.** 19 new files, 17 modified. `git status` is the inventory.
   Review, then commit in the slices listed under *Next steps*.
3. **What shipped into the app today:** a `/library` route (rename, search, undo-delete,
   rotating brain facts), a full design pass on it, and a new **`/map` Mindmap tab that
   replaced Pricing** in the mobile tab bar.
4. **Play:** untouched today. Still `versionCode 4` / 1.3 in Closed testing. The next
   binary needs **`versionCode 5`**.
5. **The emulator holds four fictional seeded decks.** Do not sign in on it until they
   are cleared, or `SyncEngine` pushes them to your production account.

---

## What was built today

### 1. `/library` — the deck shelf moved off Home

Home had become two pages wearing one route: an action centre and an archive. The archive
always won on height. The deck grid moved to its own route.

- **New:** `src/app/library/page.tsx` (667 lines). The handlers, the sessionStorage
  handoff and the continuation runner were **moved verbatim**, not rewritten — including
  the `countsFirstChunk: false` and `model: deck.model` comments, which are what stop a
  continuation re-charging a free user's allowance and silently downgrading a Pro deck.
- **Home** (`src/app/page.tsx`) lost 277 lines and now ends after `TodaySession` and
  `MemoryOverview`.
- **Hydration gate.** `useSavedDecks` is a `useSyncExternalStore` whose *server* snapshot
  is a stable empty array, so the first paint of any route has zero decks. On Home that
  was invisible; on a page whose subject is the library it would flash "Your library is
  empty" at every student who owns fifteen books. `useHydrated` (via
  `useSyncExternalStore`, **not** `useState`+effect — this repo's lint treats
  `react-hooks/set-state-in-effect` as an *error*) gates it, and a three-card skeleton
  holds the layout.
- **Links repointed:** `CompletionSlide` ("Library") and `/revise` ("Back to library")
  both pointed at `/`. Both would have landed on a shelf-less Home.
- `robots.ts` disallows `/library` for the reason `/study` and `/revise` are already
  there — it renders an empty shelf for anyone but its owner.

### 2. Rename, search, and undo-delete

- **Rename** (`src/components/DeckTitle.tsx` + 9 tests). Tap the title, it becomes an
  input. Enter or blur commits, Escape discards (a ref flag beats the blur that follows
  it). `normaliseDeckTitle` refuses to blank a title — an empty edit means *keep the old
  one* — and an unchanged title writes nothing, because a no-op write would stamp
  `updatedAt` and push a megabyte deck on the next sync.
- **Search** (`src/lib/deckSearch.ts` + 10 tests). Deck titles **and** card labels, so
  "which deck had the thing about myocardium?" works. Card *labels* only, never
  explanation prose — a paragraph would make "the" match everything. All query tokens
  must land in the same haystack, so a match is always explicable.
- **Undo-delete** (`src/components/DeckUndoBar.tsx` + 7 tests). `window.confirm` is gone.
  Delete lands immediately with a 6-second Undo bar and a draining timer. This is only
  safe because `deleteDeck` **tombstones rather than removes**; `restoreDeck` puts the
  deck and its session back with a newer `updatedAt`, so an undo out-stamps the tombstone
  even if a sync already carried it to another device. Verified end-to-end on the
  emulator by reading storage: `[cards=12]` → `[cards=0 TOMBSTONE]` → `[cards=12]`.
  - Two other files in this repo already refused `window.confirm` for the same reason —
    `ConceptEditor` ("a WebView dialog is jarring and can be suppressed outright") and the
    reader's `SelectionBar`. The library was the outlier.

### 3. The header, and the brain facts

- The aggregate **"N decks · N concepts" line is gone** — a scoreboard that discouraged
  exactly the student it was sized for. The "2 of 4 decks" line survives **only while
  searching**, where it is feedback rather than a total.
- **`src/lib/brainFacts.ts`** — 14 short, true statements about memory and the brain,
  **none attributed to anybody** (a misattributed quotation is worse than none; a test
  fails if any line acquires a name or a quotation mark). A different one **every visit**,
  walked in order via a cursor at `flowrecall:factCursor`, so a student meets all
  fourteen before meeting any twice. Verified on device: six consecutive visits, six
  distinct facts, cursor 1→6.
- The two numeric claims were **verified against sources, not recalled**: brain ≈2% of
  body weight / ≈20% of resting oxygen and ≈20 W (NCBI Basic Neurochemistry,
  BrainFacts.org); working memory ≈4 chunks (Cowan — estimates still range 4–7, which is
  why the copy says "about four").

### 4. Design pass on `/library` (all measured on the device)

| | Before | After |
|---|---|---|
| Header height | 226px | **101px** |
| First card at | y=377 | **y=227** |
| Cards fully visible | **1** of 3 | **2** of 3 |
| Card title | clipped (`scrollW 234 / clientW 208`) | full, two-line clamp |

Six changes: the eyebrow pill cut (it repeated the heading below it); the glass panel
gated to `md:` and up (on a phone it was a bordered box inside a bordered box, with the
blur already gated at `md:` anyway); "New deck" hidden below `sm:` (the Ingest tab does
the same job from the thumb zone); the date demoted off the title line; two-line clamp;
and a lighter action row (primary sized to its words, "Read" as a text button, both
keeping a 44px target via `min-h-11`).

Two defects the screenshots caught that the code did not: moving the title to the top put
the **delete × next to the rename pencil** (destructive control beside a harmless one), so
the pencil moved inside the title text; then the inline pencil **orphaned onto its own
line** when a title wrapped, fixed by binding the last word and the icon into a
`whitespace-nowrap` span.

### 5. The colour emoji are gone

`📚` on `/reader` and `📄` on `/ingest` replaced with monochrome stroke marks
(`BookMark`, `DocumentMark`). An emoji is drawn by the platform's colour font, so it
ignored `globals.css`'s "NO color anywhere", ignored the theme, and rendered differently
on every Android version. The reader's mark is `ReaderIcon`'s geometry, so the dropzone
and the tab below it are now the same shape.

### 6. The Mindmap tab — `/map`

**Pricing left the mobile tab bar.** On native `/pricing` *cannot transact*: it branches
on `isNative` and renders a flat "Free plan" line instead of a purchase control, and
deliberately never loads the Razorpay SDK. It was a sixth of the thumb zone pointing at a
page that could only say "you can't buy here". The route stays reachable from the home
hero's **View Pro Plans** (verified on device) and from the desktop navbar, which is
web-only and where payment actually works.

**The map draws a graph the app was already generating.** `/api/concept-map` has been
producing `prerequisite` / `explains` / `contrast` edges over finished decks all along;
`validateEdges` resolves them to ids and refuses anything it cannot vouch for;
`learningPath` orders them; the result syncs on the deck row. It was rendered only as a
numbered list at the bottom of the revision sheet. **No new AI spend:** mapping still
costs one lookup exactly as before, and looking at the result costs nothing.

- **`src/lib/mapLayout.ts`** (+13 tests) — layered layout. Rank = longest path over
  prerequisite edges, computed by walking in `learningPath` order, which is what makes it
  terminate and stay deterministic **even on a model-asserted cycle**: `learningPath` is
  already total and stable, so the layout inherits both properties instead of re-solving
  them. Falls back to a grid when a deck has no prerequisite edges. A 400-node chain lays
  out in under a second (tested).
- **`keystone()`** in `conceptGraph.ts` (+9 tests) — the concept that is weak *and* holds
  up the most, counted **transitively** (out-degree would rank a fan-out of two above a
  chain of nine). Renders as one line: *"X needs work, and 4 concepts here build on it."*
- **`prerequisiteChain()`** (+9 tests) — what to understand first, breadth-first upward so
  the *nearest* prerequisites survive a cap of four.
- **`ConceptMapView.tsx`** — inline SVG, no dependency. Pan writes a transform straight to
  a ref'd `<g>`; no React state changes while a finger is down. Relations told apart by
  **stroke, never hue** (solid / thin / dashed), per this design system's own rule.
- **`MapNodeSheet.tsx`** — the comprehension panel (see below).

### 7. Making the map teach (the last change of the day)

The map was "tricky to understand" for a measurable reason: **the sheet showed one line
and threw away everything else.** `buildConceptsPrompt` explicitly demands a "rich 3-4
sentence paragraph" for `explanation`, plus `misconception`, `whyItMatters` and
`sourceQuote` — all four exist on every deck, and the map rendered none of them.

The panel now reads in the order understanding is built: the fact → **the paragraph** →
**Understand these first** (tappable, moves the map's focus) → why it matters → **The
trap** (the misconception, in amber, directly above the "don't confuse" row it explains) →
relations → the source sentence → **Ask about this** (`ConceptAsk` verbatim: collapsed,
null when signed out, spends a lookup only on an explicit tap) → Read this concept.

The map itself gained **edge words** on the focused node only — *needs*, *explains*, *vs*,
so it reads as sentences — and a **key for the line styles**, drawn rather than described.

Two device-caught fixes: the chain first rendered `Preload → Afterload → Contractility`
**with arrows, asserting an order that does not exist** (those three are siblings) — the
arrows are gone, which is the same class of invented relationship `validateEdges` exists
to prevent; and `NEEDS`/`VS` printed on top of each other where two nodes carry both a
directed and a contrast edge, so contrast labels now sit a third of the way along.
Verified by geometry on device: 7 words, **zero overlapping pairs**.

---

## Current state

| Check | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npx eslint .` | **0 errors, 45 warnings** — unchanged from this morning's baseline |
| `npx vitest run` | **675 passed, 43 files** (was 583 / 36 this morning) |
| `npm run build` | green, `/library` and `/map` both prerender static — **only with `src/middleware.ts` moved aside** |
| Android | release APK builds and installs; `versionCode 4` / `1.3`, unchanged |
| `capacitor.config.json` | reset to `webContentsDebuggingEnabled: false` |

**+92 tests today.** New pure modules: `deckSearch`, `deckTitle`, `brainFacts`,
`mapLayout`, plus `keystone` and `prerequisiteChain` in `conceptGraph`. New component
tests: `DeckTitle`, `DeckUndoBar`.

**Not verified, and cannot be without a signed-in account:** the keystone line and the
mastery colours on the map. Both need review history in IndexedDB; on the emulator every
node renders "Not yet" and the keystone line is correctly hidden. They are covered by
unit tests only.

---

## Next steps, in order

1. **Delete `src/middleware.ts`.** It is the build blocker. `vercel.json` already does the
   apex→www 308 at the edge, and `src/proxy.ts` is the Next 16 convention. Then run
   `npm run build` once with no workaround to confirm the tree is clean.
2. **Commit today's work.** Suggested slices, each independently reviewable:
   - `src/app/library/`, `src/components/{DeckTitle,DeckUndoBar,FilmGrain}*`,
     `src/lib/{deckSearch,deckTitle}*`, `storage.ts` (rename/restore), `page.tsx`,
     `CompletionSlide`, `revise/page.tsx`, `robots.ts`
   - `src/lib/brainFacts*` + the library header
   - the six design changes to `library/page.tsx` + `DeckTitle.tsx`
   - the two dropzone glyphs
   - `src/app/map/`, `src/components/map/`, `src/lib/mapLayout*`, `conceptGraph.ts`,
     `MobileTabBar`, `Navbar`, `DeckLearningPath`, `RevisionSheet`
3. **Decide on the icon PNGs.** `src/app/icon.png` and `apple-icon.png` (untracked, from a
   previous session) are byte-identical 512×512 **white marks on a fully transparent
   background**. They replace `icon.tsx`, which deliberately drew an opaque `#050505`
   tile — its own comment says the tile existed so the mark would not "disappear against
   a same-toned browser chrome". As they stand they are invisible in a light tab strip.
   Either restore the tile or accept it deliberately.
4. **Verify the map with a real account.** Sign in on the *web* (not the seeded emulator),
   study a mapped deck until something is fading, and confirm the keystone line names it
   and the node colours resolve.
5. **Clear the emulator's seeded decks** before ever signing in there. Four fictional
   decks plus a tombstone sit in its localStorage; an authenticated sync would push them
   to production.
6. **Before any Play upload:** bump `versionCode` to **5** in `android/app/build.gradle`,
   and rebuild without `DEVTOOLS=1`.

### Still open from before today

- **`prisma/dev.db` is committed to a public repo** (github.com/v1n33shh/Flow-Recall,
  confirmed public) and contains 4 real Gmail addresses with bcrypt hashes, in since the
  initial commit. `git rm` will not remove it from history.
- **`handoff.md`** (lowercase, tracked, superseded) is publicly readable business detail —
  proprietorship, IEC application, the Stripe conversation. The two files also collide on
  a case-insensitive filesystem.
- **`/api/auth/register`** has no rate limit, no captcha, no email verification, and a
  distinct 409 that enumerates accounts.
- **README drift** — it advertises Claude 3.5 Sonnet, Playwright, and a 1-deck free tier.
- **`ANTHROPIC_API_KEY` doesn't go to Anthropic** — `ai.ts` routes `claude-haiku-latest`
  through `api.aicredits.in`. Legitimate workaround, misleading variable name; check the
  privacy policy names the real processor.
- **Decks live in `localStorage`** with a ~5MB origin cap. `DeckStorageFullError` handles
  exhaustion well, but IndexedDB is the obvious next move — the app already runs two.

---

## The emulator (used all day)

```bash
setsid env DISPLAY=:0 XAUTHORITY=$HOME/.Xauthority \
  ~/Android/Sdk/emulator/emulator -avd fr36play -gpu host -feature -Vulkan \
  -port 5556 -no-boot-anim &
```

`-feature -Vulkan` is **not optional** — plain `-gpu host` segfaults silently on this
machine. It shut itself down once mid-session; relaunching is harmless.

**Install:** always `assembleRelease`, never `assembleDebug` — the emulator carries a
release-signed build and a debug APK cannot upgrade it in place
(`INSTALL_FAILED_UPDATE_INCOMPATIBLE`). `adb install -r` preserves its data.

**CDP** (needs `DEVTOOLS=1` at build time):

```bash
SOCK=$(adb -s emulator-5556 shell cat /proc/net/unix | grep -o 'webview_devtools_remote_[0-9]*' | head -1)
adb -s emulator-5556 forward tcp:9333 localabstract:$SOCK
# python websocket-client, suppress_origin=True — the handshake is 403 otherwise
```

**Status bar is exactly 96 device px** (2400 screen − 2304 WebView), so a tap computed
from `getBoundingClientRect()` needs `+96` on y. Driving the UI by querying the page for
element centres and tapping those beats guessing coordinates from screenshots.

**Escape clears an `<input type="search">`** in Chrome — use `keyevent 4` (the IME
consumes it) to dismiss the keyboard instead.

---

## Play Store state — carried forward, NOT re-verified today

Nothing below was checked today; it is as of 2026-09-08.

| Channel | Version | Counts for the 14-day production gate? |
|---|---|---|
| **Closed testing – Alpha** | 4 (1.3), submitted 8 Sept ~21:57 (Submission 2) | **Yes** |
| Internal testing | 4 (1.3) | No |
| Internal app sharing | 1.3 new link; 1.2 still ~7 testers | No |
| Website | Vercel production aliased to **www.flowrecall.app** | N/A |
| Sideload `public/flowrecall-release.apk` | 1.3, upload key `e1f4352f…bc09` | No |

- Share **only** "Closed testing → Testers → **Join on the web**". "Join on Android" shows
  **Item not found** to anyone not already a tester.
- Add a tester's **exact Play Store Gmail** to **FlowRecall Testers** *before* they tap,
  and have them open it in Chrome, not an in-app browser.
- **Play App Signing re-signs the app**, so a student who sideloaded the direct APK cannot
  upgrade to the Play build in place. Uninstalling wipes their on-device library unless
  they signed in first — say so wherever the APK is offered.

---

## Traps

- **`src/middleware.ts` + `src/proxy.ts` cannot coexist** — Next 16 `E900`, hard failure.
- **`DEVTOOLS=1` bakes WebView debugging into `capacitor.config.json`.** Re-run
  `npx cap sync android` without it before any release build. (Currently reset.)
- **`react-hooks/set-state-in-effect` is an error here.** Reach for
  `useSyncExternalStore`, or write in an effect and read in a `useMemo`.
- **`window.confirm` is banned by precedent** in three files now.
- The repo's node tests **hit remote Postgres** (`freeQuotaDb`, `clozeGradeRateLimit`) —
  `npm test` takes ~2.5 minutes and writes to the live DB host.
- `npm run build:apk` moves `src/app/api` aside and restores it; an interrupted run leaves
  `.capacitor-api-backup` and the next run refuses until it is resolved.

---

## Paths

```
src/app/library/page.tsx            # the shelf: rename, search, undo, brain fact
src/app/map/page.tsx                # the Mindmap tab: picker + map + keystone
src/components/map/                 # ConceptMapView (SVG), MapNodeSheet (the panel)
src/lib/mapLayout.ts                # layered layout, derived from learningPath
src/lib/conceptGraph.ts             # + keystone(), prerequisiteChain()
src/lib/brainFacts.ts               # 14 facts, unattributed, one per visit
src/lib/storage.ts                  # + renameDeck, restoreDeck, fact cursor, revise focus
src/middleware.ts                   # DELETE THIS — build blocker
android/app/build.gradle            # versionCode 4 / 1.3 until the next bump
```
