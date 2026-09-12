# FlowRecall — handoff, 12 September 2026 (evening)

## Read this first: there is uncommitted work in the tree that is not mine

`src/app/page.tsx` has hand edits I did not make and did not revert. They are small in diff
and large in effect:

```
git diff src/app/page.tsx        # 2 insertions, 7 deletions
```

- `CurveCell` and `StatementCell` widened to `lg:col-span-12`, and the statement is centred.
- **Four cells removed from the render:** `<GapsCell />`, `<ReaderCell />`,
  `<MechanismsCell />`, `<ShowingUpCell />`.

**What that costs, measured against the built HTML.** Sixteen strings of product copy are no
longer on the page:

> The gap it chose between reviews · Spaced retrieval · A date per memory, not a daily pile ·
> Relational encoding · See what holds the deck up · Encoding in context · Read it where it
> came from · Any word defined in place · Production, not recognition · Explain it back in
> your own words · Your shelf · Every deck, still findable in March · Showing up · The part no
> scheduler can do · Ten, twenty or forty minutes · afferent

That is the whole product section apart from its heading. The FAQ, the curve, the hero, the
loop, the pull-quote, the four steps and the close are untouched, and all seven FAQ answers
plus both JSON-LD blobs still ship.

**Three consequences worth deciding on rather than inheriting:**

1. **One sentence on the page is now false.** `StatementCell` still reads *"The mechanism each
   surface is built on is named on the card."* There are no longer any cards naming
   mechanisms. Either the sentence goes or the cells come back.
2. **Four components are now dead code**, and `eslint` reports them: `GapsCell`, `ReaderCell`,
   `MechanismsCell`, `ShowingUpCell` are defined and never used. That is what moved the lint
   baseline from 43 warnings to 47.
3. `SOFTWARE_APP_JSONLD`'s `featureList` still advertises the reader, the mindmap and the
   library to crawlers. Not wrong — those features exist — but the page no longer mentions
   them, which was the reason that list was brought up to date in `ad55989`.

The tree still builds: `tsc` clean, `npm run build` clean, `/` prerendered static at 67,283
bytes. Nothing is broken; it is a content decision sitting uncommitted.

---

## The one thing that matters

**Nothing has reached a user, and there are now eighteen commits in the way.**

```
git rev-list --count origin/main..HEAD   # 18
```

Play still serves **`versionCode 4` / 1.3**, and `public/flowrecall-release.apk` on the website
is still the **8 September** build. `ad55989` — which removes the Streak Freezes feature your
site is still advertising and charging ₹299/month for — has been in that queue for two days.

**`! git push origin main`.** It asks for your username and a personal access token, which is
why it has to be you.

---

## What this session did

Ten commits, all on the home page and the shell around it. No copy was cut in any of them.

| | |
|---|---|
| `5ce8d1c` | Home rebuilt as overlapping glass slabs, with every word of the restored copy |
| `22b33dd` | `src/lib/spatial.ts` — one glass material for the library, tab bar and sheet |
| `e3c88a0` | `ReaderHome` and `FlowStateHub` parked rather than wired |
| `11827dd` | DESIGN.md rewritten from the code after it had drifted two revisions |
| `ab4d7a2` | Slabs → one asymmetric twelve-column bento |
| `4f0d35d` | Cut the furniture, not the words; the serif became a rule |
| `63dfac6` | Hero → four slabs, Instrument Serif → Newsreader, grain to 20% |
| `6c073ba` | Tab bar spacer stopped double-counting the safe area |
| `9e0ef9a` | FAB moved to the corner — 307px of screen back, on every route |
| `9b5322e` | One primary action, grain to 0.02, breathing room |

**The three that will matter most to whoever picks this up:**

**`9e0ef9a` is the big one.** Page content stopped at y=1473 of 2400 device pixels — 61% of
the display — because the centred FAB's 76dp zone was reserved as empty space on every screen,
plus a safe area the spacer counted twice. Content reaches y=1780 now, 74%. The FAB sits at
the pill's right end and the spacer reserves only the pill (`--tabbar-pill`, published beside
the unchanged `--tabbar-h` so `DeckUndoBar`, `FlowStateHub` and `ReaderHome` keep the variable
they position against).

**`9b5322e` gave the home screen one primary action.** When `TodaySession` renders, the two CTA
pills demote to `text-white/40` links beneath it. The switch is CSS
(`group-has-[#tonight-heading]`), not state, because whether that card renders depends on four
things it resolves asynchronously and privately — a user id, a deck, a finished plan, and
something actually being due. Guessing from `decks.length` would demote the pills on a screen
where the card then declines to appear, leaving no primary action at all.

**The grain has been set three times: 0.20 → 0.08 → 0.02.** `FilmGrain.tsx` carries the whole
argument now rather than the current number. The decisive observation was on a device: over a
translucent tab bar that is blurring what is behind it, 20% fractal noise reads as a dirty
screen. The grain's actual job is to dither the backlight gradient, which spans about one
8-bit step and bands on cheap panels without it — a couple of percent, not twenty.

---

## State of the tree

Measured, not carried forward.

| | |
|---|---|
| `tsc --noEmit` | clean |
| `eslint .` | **0 errors / 47 warnings** — the four new ones are the dead cells above; the baseline before the hand edit was 43 |
| `vitest run` | **746 passing**, 50 files (last run before the hand edit) |
| `npm run build` | clean; `/` prerenders **static** at **67,283 bytes** |
| Prerendered HTML | both JSON-LD blobs, all **seven** FAQ answers |
| APK on `fr36play` | built and installed from `9b5322e`, still `versionCode 4` |

**Also uncommitted, and now the fifth session running:** `src/app/icon.tsx` and
`apple-icon.tsx` are deleted locally but still in HEAD, with `icon.png` / `apple-icon.png`
untracked. Commit the swap or restore the routes; it should not outlive another session.

---

## A claim I made that is wrong

`9b5322e`'s message says converting `TodaySession` off `motion/react` takes "the library off
the route entirely." **It does not.** `src/components/RetentionCurve.tsx:3` still imports
`motion` and `useReducedMotion`, and the curve renders on the home page, so the route still
loads the animation library. What is true is narrower: `page.tsx` and `TodaySession` no longer
import it. If taking it off the route is worth doing, `RetentionCurve` is the last consumer.

---

## Exact next steps

1. **Decide on the uncommitted page edit.** Four cells and sixteen strings of copy, plus a
   sentence that is now false. Commit it with the statement copy fixed and the dead components
   deleted, or `git checkout src/app/page.tsx` to restore them. Do not leave it.
2. **Push.** Eighteen commits, including the Streak Freezes removal your live site contradicts.
3. **Set the launch-offer date.** `LAUNCH_OFFER_ENDS` in `src/lib/launchOffer.ts:20` is still
   **31 October 2026** and still a placeholder.
4. **Cut a mobile release.** Bump `versionCode` to **5** in `android/app/build.gradle:25` —
   Play rejects a code it has seen, and the rejection arrives *after* the build — then
   `npm run build:apk` and `(cd android && ./gradlew bundleRelease)`. Refresh
   `public/flowrecall-release.apk`; it is a month stale. Play App Signing re-signs the app, so
   a student who sideloaded the direct APK cannot upgrade in place — say so wherever it is
   offered.

### Open questions

- **The icon files.** Fifth session.
- **The FAB still floats over scrolling content.** At the right edge it clips the end of a row
  rather than the middle, which is why the corner is where this control belongs — but it is
  still a floating element over live content. If it ever lands on something load-bearing, the
  durable fix is hide-on-scroll, which costs this route its "no scroll listener" property.
- **Grain at 0.02** may now read as flat rather than crisp. The honest range between invisible
  and dirty is about 0.04–0.06; one value in `FilmGrain.tsx`.
- **`ReaderHome` is built and still unwired** — continue-reading card, progress track, Resume
  pill. `FlowStateHub` sits at `/flow`. Both are candidate native homes; `/` is currently one
  introduction on both platforms.
- **`SITE_URL` points at the wrong origin.** `page.tsx` defaults the JSON-LD to the apex,
  `layout.tsx` defaults `metadataBase` to www, `next.config.ts` redirects apex → www, and no
  `NEXT_PUBLIC_SITE_URL` is set anywhere. The structured data advertises URLs that 308 away.
  Untouched for four sessions.
- **Pacifico is down to one call site** — the footer wordmark. Brand identity, so your call.

### Operational notes

**The emulator needs software rendering** or it exits with code 1 on the default GPU path:

```
~/Android/Sdk/emulator/emulator -avd fr36play -gpu swiftshader_indirect
```

**Delete `.next` before `npm run build:apk` if you have run `next dev` since the last build.**
The dev server writes `.next/dev/types/validator.ts`, which references the API routes that
`build:apk` temporarily moves aside — the type check then fails on 22 phantom missing modules.
This cost a build twice today.

**An interrupted `build:apk` strands the API routes.** `scripts/build-capacitor.mjs` moves
`src/app/api` to `.capacitor-api-backup` and restores it on exit; killed mid-build it does not,
and the script refuses to run again until you `mv .capacitor-api-backup src/app/api`.

**Frame timing from this emulator means nothing.** It runs `swiftshader_indirect`, and the app
renders through a WebView surface, so `dumpsys gfxinfo` reports zero frames. The 60fps
requirement on the glass and blur remains **unverified on real hardware** — the single biggest
untested claim in this work.

**Screenshot the emulator only after it settles.** A capture taken mid-fling or mid-entrance
shows unpainted black regions and elements at `opacity: 0`; that misread cost three false-alarm
investigations today. Use `adb shell "input swipe …; sleep 3"` before `screencap`.
