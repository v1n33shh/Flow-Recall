# FlowRecall — Handoff

**Read this top section first.** It supersedes everything below it (including the "🔴 START HERE — 2026-08-22, later session" block immediately following, which was itself once this file's current-state summary and is now historical). Everything in this top section reflects the repo as of **2026-08-23**, committed through `0511e8e` and fully pushed to `origin/main` - confirm with `git status` before assuming otherwise, since that's changed mid-session before.

---

## 🔴 START HERE — 2026-08-29 (last): the cipher decoder no longer leaves paragraphs in cipher

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
