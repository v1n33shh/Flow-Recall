# Device scripts

Playwright-over-CDP helpers for driving FlowRecall on a real Android phone: store
screenshots, verifying a reader change against the user's own books, and checking
layout on the 360x768 viewport the app actually ships to.

Nothing here is part of the app. None of it runs in CI, and none of it is imported by
`src/`.

## Connecting

The WebView only accepts a debugger when the build was made with devtools on, which is
env-gated in `capacitor.config.ts`:

```bash
DEVTOOLS=1 npm run build:apk && (cd android && ./gradlew assembleRelease)
adb install -r android/app/build/outputs/apk/release/app-release.apk
adb shell am start -n app.flowrecall.android/.MainActivity
adb forward tcp:9222 localabstract:$(adb shell cat /proc/net/unix | grep -o 'webview_devtools_remote_[0-9]*' | head -1)
```

That build is **release-signed with the same key** as the shipping APK, so `adb install -r`
is an in-place upgrade and the on-device library survives. A *debug* build is signed with a
different key and would force an uninstall, destroying the user's books. Always check
`apksigner verify --print-certs` on both APKs before installing.

The socket number changes on every launch, so re-run the `adb forward` line after any
restart. `pgrep -f "next dev"` and similar will match your own shell command — check the
port, not the process list.

## The scripts

| | |
|---|---|
| `census.mjs` | Dump books, highlights and reading positions from IndexedDB. **Run before and after anything destructive** and diff it. |
| `survey-storage.mjs` | Dump `localStorage` and the session. |
| `reading-position.mjs` | Read, or write, the stored reading position for the PDF book. |
| `reader-prefs.mjs` / `restore-reader-state.mjs` | Save and restore reader preferences, and put the position back. |
| `open-pdf-with-prose.mjs` | Open the PDF at a paragraph and replace the text with the fictional prose in `prose.js`. |
| `goto-tab.mjs` | Navigate to a tab. Routes via home first, because `MobileTabBar` returns `null` on `/reader` and `/study`. |
| `frame-element.mjs` | Scroll the app's own overflow pane so an element sits at a chosen y. |
| `measure.mjs` / `find-word.mjs` | Element geometry in device pixels; locate a word's centre for a long-press. |
| `define-selection.mjs` | Tap Define on the current selection and wait for the lookup (~7.5s). |
| `eye-filter.mjs` | Open the Aa menu and set warmth and dim. |
| `fill-ingest.mjs` | Fill the ingest form with fictional lecture notes. |
| `mask-account-pii.mjs` | Replace the account name with "Unknown" and remove the email before a capture. |
| `shot.sh` | `shot.sh <name> <y>` — screencap, crop to exactly 1080x2160, assert the top rows. `SHOT_DIR` and `ADB` are overridable. |

## Things that cost a session to learn

- **Never photograph real content.** Store assets must not show the user's books, name or
  email. Swap prose in with `open-pdf-with-prose.mjs`, mask the account with
  `mask-account-pii.mjs`, and assert `document.body.innerText` no longer contains either
  string before the shutter.
- **Swap reader text length-preservingly.** `TextReaderCore` translates the column
  container by `currentPage * (containerWidth + gap)`. Shorter replacement paragraphs
  shrink `scrollWidth`, so a `currentPage` deep into the window points past the end and the
  page paints **blank** under a live "Page N of M" header.
- **The status bar is exactly 96 device px** (2400 screen − 2304 WebView). `shot.sh`
  collapses the notification shade first; a crop alone will not remove a pulled-down shade.
- **Playwright cannot click a reader `<mark>`**: paging moves columns with `transform`, so
  it reports "outside of the viewport" and retries for the full timeout. Dispatch the click
  in-page instead. Same for `a[href="/reader"]`, which matches three elements, two of them
  the hidden desktop nav — filter by rendered box.
- **A modal must outrank `z-50`.** `MobileTabBar` is `fixed bottom-0 z-50` and renders late
  in DOM order, so an equal-z overlay is painted over and its buttons become untappable.
  This is invisible on a browser viewport, where the bar is `sm:hidden`. Check with
  `document.elementFromPoint` at each button's centre and assert it returns that button.
- **`librarySort` defaults to "recent"**, so opening a book moves it to grid slot 0. Select
  library cards by badge text, never by index.
- **A full document load lands on the marketing home page** whatever the URL says: the
  export writes `reader.html`, not `reader/index.html`, so the Capacitor server falls back
  to `index.html`. Navigate in-app from a fresh launch.
- Steppers do not batch — three `click()` calls in one `evaluate` advance one step. Space
  them ~700ms.
