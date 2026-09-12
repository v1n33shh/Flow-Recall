# FlowRecall — handoff, 12 September 2026

## The one thing that matters

**Nothing here has reached a single user, and now there are eleven commits in the way.**

The previous handoff said eight. This session committed the work that had been sitting loose
in the working tree, which removes one of the two blockers and leaves the other exactly where
it was: **`git push` has never been run.**

```
git log --oneline origin/main..HEAD
e3c88a0  feat: park the continue-reading home at /flow instead of shipping it
22b33dd  feat: give the library and the tab bar one glass material
5ce8d1c  feat: rebuild the home page as a stack of glass slabs on pitch black
43edb69  Put the introduction back, on the app and the website alike
e44818a  Home, attempt five: lead with a sentence, and fix the number that lied
079ce77  Give the app a face, and stop shouting with font-weight
7609522  Lead the native home with a number instead of a headline
ad55989  Stop selling what doesn't exist, and put the science where students are
5d075bf  Give a new student something to open, and the long waits something to read
22dc8de  Cut the home page down to something people will actually read
919b103  Rebuild the home page around the curve the scheduler actually draws
```

Play still serves **`versionCode 4` / 1.3**, and `public/flowrecall-release.apk` on the
website is still the **8 September** build. The Streak Freezes removal in `ad55989` — a
feature the site is still advertising and charging ₹299/month for — is in that list.

**`! git push origin main`.** It will ask for your username and a personal access token;
that is why this has to be you and not me.

---

## What this session did

The working tree held a finished redesign and no commits. It now holds neither — three
commits, and a tree that matches its own documentation.

### 1 · The redesign is committed, in three pieces

`5ce8d1c` is the home page: seven glass slabs on pitch black, overlapping by margin and
z-index with one upward shadow at each seam, no scroll listener, and no `backdrop-filter`
on the slabs themselves. Instrument Serif carries the headline's second clause and the
brain-fact slab. **Every word of the copy survived** — this is the same argument re-set,
which is what the six rejections before it were asking for.

`22b33dd` is the app shell: `src/lib/spatial.ts`, one material at two thicknesses, no
accent colour, and **no CSS custom properties** — that last one is the whole point of the
file, and the docblock explains the invisible-FAB bug that earned it. Five tabs, Account
among them.

`e3c88a0` parks the two alternative native home screens at `/flow` and nowhere,
deliberately: `/` is one introduction to FlowRecall on the website and in the APK alike,
and swapping the screen students land on is your decision rather than a styling one.

### 2 · About 2,000 lines of unreachable code are gone

An entire earlier generation was sitting untracked in `src/` with nothing importing it and
no route reaching it: `MidnightHero`, `MidnightFeatures`, `AmbientOrb`, `HeroPremium`,
`Screenshot`, `lib/midnightGallery`, `lib/motion`, plus `spatial.ts`'s `GLASS_EDITORIAL`,
`HOVER_LIFT` and `SERIF`, which only that landing page used. Deleted rather than committed.

**`public/screens/` was kept and is committed**, and you should know it is currently
unreferenced: three real product screenshots, 44 KB, shot on the emulator against the
**starter deck** so nothing personal is baked into a public asset. `Screenshot.tsx` was the
only thing that rendered them. They survive because re-shooting costs an emulator session
and the slab page may yet want them; if it never does, they are three files to delete.

### 3 · DESIGN.md described a build that did not exist

It is rewritten from the code rather than from the intentions. It had claimed `page.tsx`
hands native over to a shell (it only adjusts spacing), that the marketing page was a
241-word glass bento (it is the full restored copy in seven slabs), and that navigation was
four tabs with Account as a header avatar (five tabs, Account among them). All three were
the *previous* revision's truth, which is exactly how design docs go bad.

It now also carries a **"Built, and not reachable"** section, because unreachable code that
looks finished is the most expensive kind to inherit.

### 4 · One stale comment, fixed

`BrainFactSection`'s docblock said "the fourteen unattributed lines in brainFacts.ts" twice.
There are **24**. That file's own rule is that every claim in it can be checked, and a
comment about it should hold to the same standard.

---

## State of the tree

Re-measured after the last change, not carried forward from the previous handoff.

| | |
|---|---|
| `tsc --noEmit` | clean |
| `eslint .` | **0 errors / 43 warnings** — two better than the 45 baseline, because the deleted files took their own with them |
| `vitest run` | **746 passing**, 50 test files |
| `npm run build` | clean; `/` prerenders **static** (`○`) at **83,055 bytes** |
| Prerendered HTML | both JSON-LD blobs present, all **seven** FAQ answers in the markup |

**Still dirty, on purpose:** `src/app/icon.tsx` and `apple-icon.tsx` are deleted locally but
still in HEAD, and `icon.png` / `apple-icon.png` are untracked. **This is the fourth session
they have sat like that.** The previous handoff excluded them from every commit because the
icon question was yours, and that was respected again here — but the tree cannot stay
half-swapped forever. Either commit the PNGs and the deletions together, or restore the
`.tsx` routes.

---

## What I verified, and what I did not

**Verified:** everything in the table above, by running it.

**Not verified, and this is the real gap in this session:** *nothing was rendered.* No
emulator, no browser, no APK build. The design in those three commits was judged by reading
it and by the build succeeding, not by looking at it. The previous session did put it on
`fr36play` at 360dp, so it is not unseen — but nothing after that point is, including the
slab radius decision and the native hero's switched-off decorations.

**`npm run build:apk` was not run this session.** It was clean at the end of the last one.

### One diagnosis from the previous session that I think is wrong

The session notes flagged *"Account page skeleton doesn't resolve — tri-state
`useIsNative<boolean | null>(null)` never resolves"* at `src/app/account/page.tsx:45`.
I do not think that is real. `useIsNative`'s effect always sets a concrete boolean one
microtask after mount, and the `null` start is load-bearing: the comment above it explains
that defaulting to `false` let `WebAccountCard`'s own `router.replace("/")` fire on native
cold launch and bounce the tab to home. No code path leaves it stuck on the skeleton.

If you *saw* a stuck skeleton on the device, the cause is something else and a repro is worth
more than the code reading. I did not change anything there.

---

## Exact next steps

1. **Push.** `! git push origin main`. Eleven commits, including the Streak Freezes removal
   that your live site contradicts right now.
2. **Set the launch-offer date.** `LAUNCH_OFFER_ENDS` in `src/lib/launchOffer.ts:20` is
   **31 October 2026** and is still a placeholder. Make it real or remove the offer — it is
   built so the honest outcome is the default, and the strikethrough removes itself when the
   date passes.
3. **Look at the thing before you ship it.** The emulator, at 360dp, on the slab page. See
   the operational notes below.
4. **Cut a mobile release.** Bump `versionCode` to **5** in `android/app/build.gradle:25`
   (Play rejects a code it has seen, and the rejection arrives *after* the build), then
   `npm run build:apk` and `(cd android && ./gradlew bundleRelease)` for the Play AAB.
   Refresh `public/flowrecall-release.apk` too — it is a month stale.

   Remember Play App Signing re-signs the app, so a student who sideloaded the direct APK
   cannot upgrade to the Play build in place. Say so wherever the APK is offered.

### Open questions, unchanged or newly raised

- **The icon files.** Fourth session. See State of the tree.
- **`SNAP`, `page.tsx:42`** — stiffness 700 / damping 18 drives every hero entrance, and the
  constant's own comment says it makes things *"snap aggressively into place."* A calmer
  200/26 was built and measured in an earlier revision and did not survive the restoration.
  One number, if the entrances read as twitchy rather than crisp.
- **Pacifico is down to one call site** — the footer wordmark, `page.tsx:932`. It is the
  least Linear-like element in a system that names Linear as its target. Brand identity, so
  your call.
- **`ReaderHome` is built and unwired.** Continue-reading card, progress track, Resume pill,
  account avatar in its header. Two lines in `page.tsx` whenever you want it to be the
  native home.
- **`SITE_URL` points at the wrong origin.** `page.tsx:45` defaults the JSON-LD to the apex
  `https://flowrecall.app`; `layout.tsx` defaults `metadataBase` to
  `https://www.flowrecall.app`; `next.config.ts` permanently redirects apex → www; and no
  `NEXT_PUBLIC_SITE_URL` is set in any `.env`. The structured data advertises URLs that 308
  away. Small, real, and still untouched after three sessions.
- **The 10/20/40 session chips** on the home page. Still open from `43edb69`.

### Three operational things that will bite you

**The emulator only starts with a window if you force software rendering.** It exits with
code 1 on the default GPU path, logging *"Guest Angle is still unstable for API > 35."*

```
~/Android/Sdk/emulator/emulator -avd fr36play -gpu swiftshader_indirect
```

**An interrupted `build:apk` leaves the app broken until you fix it by hand.**
`scripts/build-capacitor.mjs` moves `src/app/api` to `.capacitor-api-backup` for the export
and restores it in a `finally`; killed mid-build, that restore never runs and all 22 API
routes are stranded. The script then refuses to run again until it is resolved. The fix is
what the script does: `mv .capacitor-api-backup src/app/api`.

**The Library projection is computed asynchronously**, so it is absent for the first several
seconds after launch. Wait ~10s before judging that screen — a blank gap there has already
been "fixed" once when nothing was wrong.

**`location.href = '/…'` cold-loads the Capacitor shell** at its start URL and desynchronises
Next's router. On the emulator, navigate by clicking.
