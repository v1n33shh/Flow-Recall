# FlowRecall — Handoff

**Updated 2026-09-08, ~22:47 IST.** Start here. Older drafts: `git log --follow -- HANDOFF.md`.

---

## Resume in 60 seconds

1. **Share only Closed testing → Testers → Join on the web** (`play.google.com/apps/testing/...`). Never **Join on Android** in WhatsApp — that is why a friend saw **Item not found**. Your **spare phone** installed fine because that Gmail was already a tester; Play showed **store listing screenshots** (the sideload/sharing APK did not).
2. Add the friend’s **exact Play Store Gmail** to **FlowRecall Testers**, Save, then she opens the **web** join link in **Chrome** (not WhatsApp’s in-app browser) → Become a tester → Download.
3. Check **Publishing overview → Submission activity**: Submission **2** (Closed testing 1.3, submitted ~21:57). If still **In review**, wait; spare-phone success with listing art strongly suggests the track is installable for opted-in accounts. Confirm the row says **Published**.
4. **Git:** `main` has `3984e67` (reader 1.3) and `4cc06a9` (Google OAuth / www). `origin/main` was in sync at this write. Next Android binary needs **`versionCode` 5**.
5. **Google sign-up** was broken (PKCE `invalid_grant`); **fixed and live** on `https://www.flowrecall.app`. Retry Google on **www**, or email+password.

There is **no 1.4**. Testers get **1.3** (`versionCode` **4**).

---

## What is live

| Channel | Version | Counts for 14-day production gate? |
|---|---|---|
| **Closed testing – Alpha** | **4 (1.3)** — submitted for review 8 Sept ~21:57 (Submission **2**). Spare device **did install from Play** with listing images. | **Yes** |
| Internal testing | 4 (1.3) rolled out ~21:20 | **No** |
| Internal app sharing | 1.3 = new unique link; **1.2** still ~7 testers (leave them) | **No** |
| Website | Vercel production aliased to **www.flowrecall.app** (OAuth fix deployed same night; `4cc06a9` on GitHub) | N/A |
| Sideload `public/flowrecall-release.apk` | 1.3, upload key `e1f4352f…bc09` | **No**; cannot upgrade to Play in place |

**Installed audience** on All apps was **0** earlier; Play stats lag **24–48h**. App-sharing installs never appear there.

**14-day clock** = people who **join Closed testing** and **install from Play**, stay opted in. Internal testing / app sharing do not count.

---

## Product (1.3)

- **PDF / pasted text:** native drag-to-select + Define / Highlight. `.native-app .reader-longpress-text` must stay `user-select: text` (extracted PDF is **not** `.textLayer`). Coarse pointers hide `.reader-page-turn`.
- **EPUB:** still iframe long-press / `user-select: none` in the chapter document.
- **Google OAuth:** apex `flowrecall.app` **308 → www**. Vercel env `AUTH_URL=https://www.flowrecall.app`, `AUTH_TRUST_HOST=true`. `trustHost: true` in `src/auth.ts`. Root cause: `CallbackRouteError` / `invalid_grant: Invalid code verifier` (PKCE cookie host mismatch). Not Supabase.

---

## Play: how to share (do not regress)

**Closed testing → Manage track (Alpha) → Testers**

- Email list: **FlowRecall Testers** (13 at last look). Add new Gmails **before** they tap the link; then they must open the link **again**.
- **Join on the web** — this is what you send. Opt-in page, then Play.
- **Join on Android** — store listing jump. **Item not found** if they are not a tester yet. Spare phone worked because **you** already were.

Tell friends: Chrome, Play profile Gmail must match the list, Become a tester **then** Download. Wait a few hours after adding a new email if Play still 404s.

### Monitor installs

- **Testers** tab → who **opted in** (not the same as installed).
- App **Statistics** (date range 7 days; filter Closed testing if present) → users / installs (laggy).
- All apps **Installed audience**; **Latest releases** → Closed testing **Install base**.

---

## Next session — exact clicks

1. Submission **2** still **In review**? Wait. **Published**? Closed testers get 1.3 (or already did on the spare phone).
2. Resend **Join on the web** to anyone who only got the Android link.
3. Confirm friend’s Play Gmail is on **FlowRecall Testers**.
4. Tomorrow: Statistics for the spare-phone install.
5. Next app binary: bump `versionCode` to **5** in `android/app/build.gradle` **before** `bundleRelease`. `DEVTOOLS=1` must not leak into `capacitor.config.json` (`webContentsDebuggingEnabled: false`).
6. If `npm run build:apk` typecheck-fails on missing `src/app/api`, `rm -rf .next/dev`.

---

## Traps

- **Join on Android** in chat → Item not found for new testers.
- App sharing ≠ Closed testing.
- Play cert vs sideload cert → uninstall to switch; library wipe unless signed in.
- `DEVTOOLS=1` bakes WebView debug into the AAB.
- Publishing overview: Save ≠ live; **Submit for review** (already done for 1.3).
- Google sign-in: use **www**; Brave cookies on apex used to break PKCE.

---

## Paths

```
android/app/build/outputs/bundle/release/app-release.aab
android/app/build.gradle          # 4 / 1.3 until next bump
src/auth.ts                       # trustHost: true
vercel.json / next.config.ts      # apex → www
```

---

## Intentionally leftover

- EPUB sentence-drag like PDF.
- Nudging 1.2 app-sharing testers.
- Production / open testing.
- Friend install until she uses **Join on the web**.
