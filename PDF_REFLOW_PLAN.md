# NEXT SESSION: PDF Reflow Mode — paste this whole file as your opening prompt

> Read this entire file, then execute it. Use `EnterPlanMode` first if anything below is ambiguous once you've read the actual current code — the architecture below was researched carefully but the codebase may have moved since. Do not skip straight to coding without re-confirming the specific line numbers cited here still match reality.

---

## The prompt (paste this to Claude Code to kick off the session)

> FlowRecall's PDF reader (`src/components/reader/PdfReaderView.tsx`) only supports zoom — it's missing font-family/size controls and a scrolling-vs-page-turn toggle, both of which EPUB and the plain-text reader already have. Read `/home/dizzyeyes/Desktop/Flowrecall/PDF_REFLOW_PLAN.md` in full — it contains the researched architecture, the reason a naive font-control add-on doesn't work for PDF, and the recommended unified solution ("Reflow Mode"). Implement it. Use "The Book of Wisdom" by Osho (the user's real saved PDF, already in their library) for all on-device verification — never generate synthetic test PDFs for this. Enter plan mode first, confirm the file/line references in this doc still match current source, and flag anything that's drifted before writing code.

---

## Context: why this is its own session

This was scoped and deliberately deferred from a 2026-08-23 session (see `HANDOFF.md`'s top section) due to remaining weekly budget. In that session:

- A `+`/`−` zoom stepper was shipped for PDF (already done, don't redo it).
- A real Paginated ↔ Scrolling toggle was shipped for the **plain-text (pasted notes) reader** (`TextReaderView.tsx`) — CSS multi-column pagination, anchor-based resume position, edge-tap page-turn zones mirroring EPUB's existing pattern. **This is the pattern to reuse for PDF's Reflow mode below — most of the hard problems (pagination mechanics, resume-position anchoring, mode-toggle UX) are already solved and battle-tested in that file.**
- Research (two Explore agents, full findings preserved below) established PDF's font problem is not a preference gap, it's architectural: pdf.js renders each page as a **rasterized canvas bitmap** with a separate **invisible** text layer used only for selection. No CSS `font-family` can visibly change baked-in pixels. A literal "font family switcher" for the existing PDF view would compile and run and do *nothing visible* — confirmed by direct code trace, not assumption.

## The key insight that makes this tractable in one session

Don't try to retrofit font control onto the existing canvas view (impossible) or bolt continuous-scroll onto it (a separate, large, virtualized-rendering rewrite with its own risks). Instead: **build a second, alternate rendering mode for PDF — "Reflow"** — that extracts the PDF's actual text and displays it exactly like the plain-text reader does. This one feature gets you both asks at once:

- **Real font control**, because Reflow mode renders genuine styled HTML text, not a raster image.
- **A real scrolling-vs-page-turn toggle**, because Reflow mode reuses `TextReaderView.tsx`'s already-built CSS-column pagination mechanism verbatim (same technique, same code shape — copy the pattern, don't reinvent it).
- The existing zoom+canvas view (call it "Original Layout") stays exactly as-is, untouched, for when exact visual fidelity matters (diagrams, scanned pages, unusual layouts) — Reflow is an *additional* choice, not a replacement. This mirrors how Kindle/Apple Books/Adobe Reader all offer "reflow text" as an alternative to "original page view" for fixed-layout documents — it's the industry-standard pattern for exactly this problem, not a novel approach.

A toggle between "Original Layout" and "Reflow" lives in the same `DisplaySettingsMenu` popover (a third `LayoutControl`-style mode selector, or extend the existing one — see Open Questions below).

## Researched architecture (from the 2026-08-23 session's Explore agents — verify these line numbers before trusting them, source may have moved)

### PDF's current rendering (`PdfReaderView.tsx`)
- Single canvas (`canvasRef`) + single invisible text layer (`textLayerRef`) per page, re-rendered in place on every `pageNumber` change. No multi-page/virtualized rendering exists at all.
- `page.render({ canvas, viewport, ... })` (around line 291) rasterizes to the canvas — this is genuinely pixel data, pdf.js's own internal font rendering, with zero relationship to CSS.
- The text layer (`new pdfjsModule.TextLayer({ textContentSource: page.streamTextContent(), container, viewport })`, around line 305) exists ONLY for selection/find-in-page hit-testing; its text is invisible (styled transparent by `pdfjs-dist/web/pdf_viewer.css`).
- Persisted highlights: `HighlightPosition = { page: number; unitRects: UnitRect[] }` where `unitRects` are 0-1 fractions of the page box (`PdfReaderView.tsx` around lines 56-57, 147-157). **This format is Original-Layout-specific** — it has no meaning in a reflowed-text coordinate space (see Open Questions).
- Zoom bounds: `MIN_SCALE = 0.5`, `MAX_SCALE = 3`, `ZOOM_STEP_PERCENT = 15` (already shipped, unrelated to Reflow).

### Text extraction for Reflow
- pdf.js exposes `page.getTextContent()` (or the streaming `page.streamTextContent()` already imported in this file) returning an array of text items, each with a `str` and a `transform` (position matrix) — but **no semantic paragraph/line structure**. PDFs have no paragraph markup; text position is purely coordinate-based.
- **The real technical risk of this whole feature** is reconstructing readable paragraphs from flat positioned text items. A pragmatic v1 heuristic (standard in PDF-to-reflow tooling): group text items into lines by Y-coordinate proximity (items within ~1px of the same baseline), then join consecutive lines into one paragraph unless the vertical gap between them exceeds roughly 1.5× the median line-height (signals a paragraph break) or a new page starts. This won't be perfect for every PDF (multi-column layouts, tables, footnotes will misbehave) — ship it as a best-effort heuristic, not a guarantee, and say so in any user-facing copy ("Reflow view works best on plain-text PDFs").
- Extraction needs to run across **all pages** up front (or lazily per-chunk if the PDF is very large — "The Book of Wisdom" is 444 pages, a good real stress test) since Reflow mode needs the whole document's text to paginate/scroll through, unlike Original Layout's one-page-at-a-time model.

### Reuse from `TextReaderView.tsx` (built 2026-08-23, verify it's still there and matches)
- The CSS multi-column pagination technique: outer container `overflow-hidden`, inner content `columnWidth: <measured container width>px; columnGap: 0`, navigated via `scrollBy({ left: ±containerWidth, behavior: "smooth" })` — not native scroll-snap (deliberately, for exact page-width increments).
- The anchor-based resume-position pattern: `findTopVisibleAnchor()` / `locateAnchorPage()` — locates whichever paragraph sits at the reading edge and re-derives its page index after any reflow (font change, resize, mode toggle), rather than persisting a raw page index that would drift when font size changes. **Reflow mode should use paragraph-index anchoring the same way**, since PDF-extracted "paragraphs" (from the heuristic above) play the same role `TextReaderView`'s `\n{2,}`-split paragraphs do.
- The edge-tap-zone + chrome prev/next button pattern (mirrors `EpubReaderView.tsx` originally, now also in `TextReaderView.tsx`) — reuse the same JSX/classNames a third time for visual consistency across all three readers.
- `DisplaySettingsMenu.tsx`'s `layout` prop (`LayoutControl` type, "Paginated"/"Scrolling" labels) is already fully generic — no changes needed there to wire up Reflow's own scrolling/paginated toggle.

## Open questions to resolve with the user before/during implementation (don't guess silently)

1. **Do highlights need to be unified across Original Layout and Reflow, or can they be two independent sets?** Unifying requires mapping extracted-text paragraph/offset positions back to original-page unit-rects (doable via pdf.js's per-text-item transform data, but real added complexity). Keeping them independent (a highlight made in Reflow only shows in Reflow, and vice versa) is much simpler and is the recommended v1 — but confirm this trade-off with the user rather than assuming.
2. **Where does the mode toggle live?** Simplest: extend `DisplaySettingsMenu` with a three-way layout control ("Original" / "Reflow: Paginated" / "Reflow: Scrolling"), or keep Original/Reflow as its own separate top-level toggle in the chrome, with the existing `layout` control only appearing once Reflow is selected. Pick whichever reads cleaner once you see it built — don't over-plan the exact UI shape here, prototype it.
3. **Where's the line on "good enough" paragraph reconstruction?** Test against "The Book of Wisdom" specifically (real 444-page book, real user content per the testing-preference memory) and eyeball whether the heuristic produces readable paragraphs. If it's bad on this specific book, that's the signal to tune the heuristic, not to add a second heuristic mode.
4. **Extraction performance for a 444-page book**: streaming/extracting all pages' text up front may take a noticeable moment on first open. Decide whether to show a loading state, extract lazily in chunks, or cache the extracted+reconstructed text (e.g. in IndexedDB via `readerStorage.ts`, keyed by bookId) so it's instant on reopen. Caching is almost certainly worth it — extraction only needs to happen once per PDF ever, not once per session.

## Verification plan for that session

- `npx tsc --noEmit`, `npm run lint`, `npm test -- --run` all clean (23 existing tests must still pass unmodified unless this feature specifically requires new ones for the paragraph-reconstruction heuristic — that heuristic is a good candidate for its own unit test, e.g. feeding it synthetic text-item arrays with known expected paragraph breaks, following the pattern in `src/lib/studyQueue.test.ts`).
- Rebuild release APK (`npm run build:apk` → `cd android && ./gradlew assembleRelease`), install in-place on the same device (`adb install -r`, preserves the user's real data — never uninstall first).
- **Open "The Book of Wisdom" by Osho specifically** (not a synthetic test file — see the standing feedback memory on this) and exercise: toggling into Reflow mode, font family/size changes, the scrolling/paginated toggle within Reflow, page-turn buttons and edge taps, making a highlight in Reflow mode, closing and reopening the book to confirm resume position.
- Confirm Original Layout mode is completely unaffected (same zoom behavior, same highlights, same everything) — this is a pure addition, not a modification to existing PDF behavior.
