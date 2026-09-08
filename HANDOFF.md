# FlowRecall — Handoff

**Written 2026-09-08, end of day.** This file is the current status. Older history lived in previous `HANDOFF.md` revisions (`git log --follow -- HANDOFF.md`).

---

## 0. Read this first

The **product work for today is done and committed** (`3984e67` on `main`): mobile PDF/text readers can **drag-select a full phrase** and Highlight/Define, not a single word. Android **1.3** is `versionCode` **4**.

The **Play distribution work is in flight**, not finished:

| Channel | Version | Status at wrap | Counts toward Google’s 14-day production gate? |
|---|---|---|---|
| **Closed testing – Alpha** | **4 (1.3)** | **In review** (Submission **2**, submitted 8 Sept 2026 ~21:57) | **Yes** — this is the track that matters |
| Closed testing – Alpha (live until review lands) | **2 (1.1)** | Still what closed testers download until 1.3 is **Published** | Yes, but it is the **old** binary |
| **Internal testing** | **4 (1.3)** | Rolled out 8 Sept ~21:20; does **not** replace Closed testing | **No** |
| **Internal app sharing** | **1.3** uploaded (new unique link); **1.2** still has ~7 testers | Sharing-only | **No** |
| Website / Vercel | Whatever is on `origin/main` | Commit exists; confirm deploy after push | N/A |
| Sideload APK | `public/flowrecall-release.apk` = 1.3 | Same upload key as local release | **No**; also **cannot** upgrade to Play in place |

Dashboard **Installed audience was 0**. App-sharing installs **do not** appear there and **do not** run the 14-day clock.

There is **no version 1.4**. Testers should be told **1.3**.

---

## 1. What we accomplished today

### 1.1 Native multi-word highlight on phone (PDF / pasted text)

**Problem.** Touch selection was locked to a word, or blocked entirely in the Capacitor shell.

**What shipped in code**

- `src/components/reader/useNativeSelection.ts` — PDF and raw-text views listen to native `selectionchange` on coarse pointers too. The long-press-to-define `useEffect` for those views was removed. Desktop mousedown-to-dismiss and `clearSelection` still skip `removeAllRanges()` on coarse pointers.
- `src/app/globals.css`
  - `.native-app` still sets `user-select: none` on chrome.
  - Reader prose is opted back in: `.native-app .reader-longpress-text` (and children), plus the existing `.textLayer` / form-field exceptions. **This was the on-device bug:** PDFs in this app are **extracted text** via `TextReaderCore` (class `reader-longpress-text`), not pdf.js `.textLayer`. Opting in only `.textLayer` left native WebView selection disabled.
  - `@media (pointer: coarse)` now **only** hides `.reader-page-turn` overlays so they do not sit on the outer fifth of the page and swallow drags. Touch paging stays on `TextReaderCore`’s `touchend` zones.
- `src/components/reader/selection.ts`, `EpubReaderView.tsx`, `UnifiedDropzone.tsx` were in the same commit. EPUB still uses **iframe long-press-to-define** and injects `user-select: none` into chapter documents (`ensureNoNativeSelection`). Do not assume EPUB drag-to-select matches PDF/text.

**On-device check (developer phone, CPH2001)**

- Play-installed app **could not** be upgraded with our APK (`INSTALL_FAILED_UPDATE_INCOMPATIBLE`: Play App Signing vs upload key `e1f4352f…bc09`). Uninstalled Play copy (library wiped), installed signed release, later reinstalled 1.3.
- First 1.3 without the `.reader-longpress-text` opt-in: long-press did nothing.
- After the CSS opt-in: programmatic multi-word selection opened **Define / Highlight / Copy**; Highlight wrote a `<mark>`. Native handles were visible for a multi-word range.
- Shippable artifacts were rebuilt with `webContentsDebuggingEnabled: false`.

### 1.2 Android 1.3 artifacts

- `android/app/build.gradle`: `versionCode 4`, `versionName "1.3"` (Play already had 1 / 1.0, 2 / 1.1, 3 / 1.2).
- AAB: `android/app/build/outputs/bundle/release/app-release.aab`
- APK: `android/app/build/outputs/apk/release/app-release.apk` and `public/flowrecall-release.apk`
- Baked config: `android/app/src/main/assets/capacitor.config.json` must read `webContentsDebuggingEnabled: false` and `loggingBehavior: "debug"` before any Play upload. A `DEVTOOLS=1 npm run build:apk` **bakes true into that JSON** and `bundleRelease` will ship it if you forget to rebuild **without** `DEVTOOLS`.

### 1.3 Git

- Commit: `3984e67` — *Enable native drag-to-highlight on mobile and ship 1.3*
- Files: `android/app/build.gradle`, `public/flowrecall-release.apk`, `src/app/globals.css`, `src/components/reader/EpubReaderView.tsx`, `UnifiedDropzone.tsx`, `selection.ts`, `useNativeSelection.ts`
- Confirm `git status` vs `origin/main`. If the commit is not on GitHub, **push** so Vercel can deploy the site + download APK. Play testers do **not** need GitHub; they need the Closed testing join link after 1.3 is **Published** on that track.

### 1.4 Play Console work (same evening)

Done:

- Internal testing release **4 (1.3)** created and rolled out (replaced internal **1.0**).
- Internal app sharing: new upload **version name 1.3** (unique new link). Decision: **do not** ping the ~7 people still on sharing **1.2**; optional highlight-only testers. New sharing users may get the 1.3 sharing URL. **This does not count for 14 days.**
- Closed testing: started from Internal testing **Promote** / create closed release with bundle **4 (1.3)**. **Save** put the change in **Publishing overview**. Quick checks ran. **Submit 1 change for review** was clicked. **Submission 2** = Closed testing – Alpha, **In review** (8 Sept 2026, 9:57 pm). Submission **1** (6 Sept) is **Published** (that was 1.1 + listing/content).

Not done: wait for Submission **2** → **Published**; then treat Closed testing 1.3 as live; send **Closed testing** join links for the 14-day gate.

---

## 2. Current state of the app

### Product

- **PDF / TXT reader (native app):** native drag-to-select + definition popover + Highlight. Page-turn overlays hidden on coarse pointers.
- **EPUB:** still a separate iframe path (long-press / no native selection in the chapter document). Not the same interaction as PDF.
- **Website reader:** same JS/CSS once Vercel has `3984e67`.
- **API / auth / ingest / study:** unchanged today. Capacitor still calls the live API (`NEXT_PUBLIC_API_URL` / flowrecall.app).

### Versioning (do not invent 1.4)

| versionName | versionCode | Where |
|---|---|---|
| 1.0 | 1 | Replaced on internal testing; inactive bundle |
| 1.1 | 2 | Was live Closed testing – Alpha until 1.3 review completes |
| 1.2 | 3 | Play store / old app-sharing row; some testers still on sharing 1.2 |
| **1.3** | **4** | Code, AAB, APK, internal testing, app-sharing 1.3, closed testing **in review** |

### Certificates (recurring trap)

Play App Signing ≠ upload key. Sideload APK / USB install of our release **cannot** update to a Play (closed/internal/app-sharing) install in place, and the reverse is also true. Uninstall wipes IndexedDB library; sync restores only if they signed in first. Say this wherever the APK is offered (`AGENTS.md`).

Developer phone tonight: Play copy uninstalled, then upload-key 1.3 installed. To use Closed testing on that phone later: uninstall sideload 1.3, join Closed testing, install from Play.

### Google 14-day / production eligibility

Personal accounts need **Closed testing** testers who **opt in** and stay active for **14 consecutive days** (Google’s own tester-count rules apply; do not treat “7 app-sharing testers” as that number).

**Internal testing** and **Internal app sharing do not start or continue that clock.**

Until Closed testing 1.3 is **Published** and people **join Closed testing** and **install from Play**, **Installed audience 0** is expected if the only installs were app sharing.

---

## 3. Exact next steps

### A. Tomorrow morning — Play review (first)

1. Play Console → FlowRecall → **Publishing overview → Submission activity**.
2. Submission **2** (Closed testing – Alpha, 8 Sept ~21:57):
   - Still **In review** → wait (often hours–2 days; can be up to ~7).
   - **Published** → Closed testers get **1.3**. Go to **B**.
   - **Rejected** → read the email / console reason; do not re-upload a new `versionCode` unless Play consumed 4 and you must bump to 5.

### B. When 1.3 is Published on Closed testing — share the link that **counts**

1. **Test and release → Testing → Closed testing** → **Manage track** on **Alpha**.
2. **Testers** tab.
3. Keep email list **FlowRecall Testers** (13 at wrap). Add any new Gmail before they join.
4. **How testers join your test**:
   - **Join on the web** — copy this for WhatsApp/email. Opens a Play testing page, then **Download on Google Play**. It is **not** a web app.
   - **Join on Android** — same test; slightly more direct on a phone.
5. Message to send (closed test only):

> Closed test (this is the one that counts):  
> **[Join on the web URL]**  
> Use the Google account I added. Become a tester, then install/update from Play.  
> Ignore the old internal app sharing link — that install does not count.

6. They must use **Play Store**, same account as the list. App-sharing-only users must **open this join link once** or they still do not count.

Optional: after Published, people already on Closed testing **1.1** should see an **Update** to 1.3 without a new join.

### C. Do **not** use for the 14-day clock

- Sidebar **Internal app sharing** (even the new 1.3 row).
- **Internal testing → Testers** join URL.
- Website `flowrecall-release.apk`.

Internal app sharing 1.3: only for **new** people you explicitly want on a quick sideload-from-Play-sharing build. Do **not** tell 1.2 sharing testers they must update (decision 8 Sept).

### D. GitHub / website

If `3984e67` is not on `origin/main`: `git push`. Confirm Vercel deployed. That updates the marketing site and the download APK. Unrelated to the 14-day Play testers.

### E. Next code change after 1.3 is on Play

Bump `versionCode` to **5** and `versionName` (e.g. 1.4) **before** the next AAB. Play rejects a reused code. Then `rm -rf .next/dev` (or `.next`) if `npm run build:apk` fails on missing `src/app/api` types, **without** `DEVTOOLS=1`, grep capacitor JSON, `bundleRelease`.

### F. This `HANDOFF.md`

Uncommitted until you commit it. Suggested: commit as docs-only so the next session starts here.

---

## 4. Traps (already bitten)

1. **`DEVTOOLS=1`** leaks `webContentsDebuggingEnabled: true` into `android/app/src/main/assets/capacitor.config.json`. Grep before every Play upload.
2. **`versionCode`** must increase every Play upload of a new binary.
3. **Play cert vs upload key** — uninstall required to switch; library wipe.
4. **App sharing ≠ Closed testing.** Unique link per sharing upload; old 1.2 link stays on 1.2.
5. **Publishing overview:** Closed testing 1.3 **Save** is not live; **Submit for review** is required. Managed publishing was **off**.
6. **Capacitor `next build`:** moving `src/app/api` aside can fail typecheck if `.next/dev/types` still lists those routes — delete `.next/dev` (or `.next`) and retry.

---

## 5. File paths

```
android/app/build/outputs/bundle/release/app-release.aab   # Play (all tracks)
android/app/build/outputs/apk/release/app-release.apk
public/flowrecall-release.apk                              # site download; not Play
android/app/build.gradle                                   # versionCode 4 / 1.3
android/app/src/main/assets/capacitor.config.json          # must not enable WebView debug
```

---

## 6. Intentionally not done today

- EPUB native sentence drag (still long-press in iframe).
- Forcing 1.2 app-sharing testers onto 1.3.
- Production / open testing rollout.
- Confirming Closed testing 1.3 **Published** (left **In review**).
- Unit sync, pendingChunks, etc. from older notes — unchanged.
