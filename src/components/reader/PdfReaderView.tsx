"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import {
  addHighlight,
  deleteHighlight,
  getBookFile,
  getBookMeta,
  getPdfText,
  listHighlights,
  savePdfText,
  updateHighlightNote,
  updateReadingPosition,
} from "@/lib/readerStorage";
import type { HighlightRecord } from "@/lib/types";
import { anchorFromRect, type SelectionAnchor } from "./selection";
import { useNativeSelection } from "./useNativeSelection";
import DefinitionPopover from "./DefinitionPopover";
import SelectionHighlight from "./SelectionHighlight";
import ReaderChrome, { ReaderErrorState } from "./ReaderChrome";
import DisplaySettingsMenu from "./DisplaySettingsMenu";
import {
  type TextReadingAnchor,
  parseTextReadingPosition,
  deriveTextPosition,
} from "@/lib/textReaderUtils";
import {
  FONT_PERCENT_MAX,
  FONT_PERCENT_MIN,
  FONT_PERCENT_STEP,
  getReaderPreferences,
  setReaderPreferences,
  type FontFamilyId,
  type TextLayoutMode,
} from "@/lib/readerPreferences";
import { TextReaderCore, type TextReaderCoreRef } from "./TextReaderCore";
import {
  extractPdfParagraphsStreaming,
  extractPdfToc,
  PDF_EXTRACT_VERSION,
  type PdfTocEntry,
} from "@/lib/pdfTextExtract";
import type { PDFDocumentLoadingTask } from "pdfjs-dist";

type LoadState = "loading" | "ready" | "error";

function PdfChaptersMenu({
  items,
  onSelectEntry,
}: {
  items: PdfTocEntry[];
  onSelectEntry: (entry: PdfTocEntry) => void;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(e: PointerEvent) {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  if (items.length <= 1) return null;

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-label="Book Contents"
        onClick={() => setOpen((v) => !v)}
        className={`flex h-8 w-8 items-center justify-center rounded-full text-foreground transition-colors active:scale-90 ${
          open ? "bg-foreground/15" : "hover:bg-foreground/10"
        }`}
      >
        <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden="true">
          <path
            d="M4 6h16M4 12h16M4 18h10"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-40 bg-transparent"
            onClick={() => setOpen(false)}
          />
          <div
            ref={panelRef}
            className="absolute right-0 top-[calc(100%+0.5rem)] z-50 max-h-80 w-72 overflow-y-auto rounded-2xl border border-border bg-surface/90 p-2 text-left shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_20px_60px_-12px_rgba(0,0,0,0.8)] backdrop-blur-xl"
          >
            <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground border-b border-border/50 mb-1">
              Book Contents & Index
            </div>
            {items.map((item) => {
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    onSelectEntry(item);
                    setOpen(false);
                  }}
                  className="w-full rounded-xl px-3 py-2 text-left text-xs font-medium text-foreground transition-colors hover:bg-foreground/10"
                  style={{ paddingLeft: `${0.75 + item.level * 0.75}rem` }}
                >
                  <div className="truncate">{item.title}</div>
                  <div className="text-[10px] text-muted-foreground">
                    Page {item.pageNum}
                  </div>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

export default function PdfReaderView({ bookId, onExit }: { bookId: string; onExit: () => void }) {
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [errorMessage, setErrorMessage] = useState("");
  const [title, setTitle] = useState("");
  
  const [paragraphs, setParagraphs] = useState<string[]>([]);
  const [tocItems, setTocItems] = useState<PdfTocEntry[]>([]);

  const [highlights, setHighlights] = useState<HighlightRecord[]>([]);
  const [localProgress, setLocalProgress] = useState(0);

  const [fontPercent, setFontPercent] = useState(() => getReaderPreferences().fontPercent);
  const [fontFamily, setFontFamily] = useState<FontFamilyId>(() => getReaderPreferences().fontFamily);
  const [layoutMode, setLayoutMode] = useState<TextLayoutMode>(() => getReaderPreferences().textLayoutMode);
  
  const [currentPage, setCurrentPage] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [tappedHighlight, setTappedHighlight] = useState<{ record: HighlightRecord; anchor: SelectionAnchor } | null>(null);

  const [initialAnchor, setInitialAnchor] = useState<TextReadingAnchor | null>(null);
  const [initialFraction, setInitialFraction] = useState(0);
  // Non-null only while a first-ever extraction is still running in the
  // background behind an already-readable book.
  const [extractProgress, setExtractProgress] = useState<{ pagesDone: number; totalPages: number } | null>(null);

  const coreRef = useRef<TextReaderCoreRef>(null);

  const [scrollContainer, setScrollContainer] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (loadState === "ready" && coreRef.current) {
      const el = coreRef.current.getScrollContainer();
      if (el) setScrollContainer(el);
    }
  }, [loadState, layoutMode]);

  const { selection, clearSelection } = useNativeSelection(scrollContainer, deriveTextPosition);
  const activeTappedHighlight = selection ? null : tappedHighlight;

  // Initial load. Three-tier, in order of how fast the reader sees words:
  //
  //   1. Cached text  -> instant, no pdf.js work at all.
  //   2. First batch  -> ~12 pages, a second or two, enough to start reading.
  //   3. Background   -> the rest of the book, appended as it arrives.
  //
  // Tier 1 is what makes this feel finished: extraction is a pure function of
  // the file and PDF_EXTRACT_VERSION, so it only ever has to happen once per
  // book. Before this, a 444-page PDF re-read every page on every single open -
  // over a minute of blank spinner, every time.
  useEffect(() => {
    let cancelled = false;
    let loadingTask: PDFDocumentLoadingTask | null = null;

    async function setup() {
      const [file, meta, savedHighlights] = await Promise.all([
        getBookFile(bookId),
        getBookMeta(bookId),
        listHighlights(bookId),
      ]);
      if (cancelled) return;
      if (!file) {
        setErrorMessage("This document is missing from your library - it may have been removed.");
        setLoadState("error");
        return;
      }

      try {
        setTitle(meta?.title ?? "Untitled Document");
        setHighlights(savedHighlights);

        // Parse the saved position first: it decides how much of the book has
        // to exist before opening is useful (see resumeParagraphIndex below).
        let resumeParagraphIndex = 0;
        if (meta?.lastPosition) {
          try {
            const parsed = JSON.parse(meta.lastPosition);
            if (typeof parsed.paragraphIndex === "number") {
              resumeParagraphIndex = parsed.paragraphIndex;
              setInitialAnchor({ paragraphIndex: parsed.paragraphIndex });
              setInitialFraction(0);
            }
          } catch {
            const parsedPosition = parseTextReadingPosition(meta.lastPosition);
            if (parsedPosition.kind === "fraction") setInitialFraction(parsedPosition.value);
          }
        }

        const cached = await getPdfText(bookId, PDF_EXTRACT_VERSION);
        if (cancelled) return;
        if (cached) {
          setParagraphs(cached.paragraphs);
          setTocItems((cached.toc as PdfTocEntry[] | undefined) ?? []);
          setLoadState("ready");
          return;
        }

        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

        const buffer = await file.arrayBuffer();
        if (cancelled) return;

        loadingTask = pdfjs.getDocument({
          data: buffer,
          // Both directories ship to /public alongside the worker (see
          // scripts/copy-pdf-worker.mjs). Without them, CID-keyed and
          // non-embedded-font PDFs extract as mojibake, which is what a
          // long-press would then hand to /api/define.
          cMapUrl: "/cmaps/",
          cMapPacked: true,
          standardFontDataUrl: "/standard_fonts/",
        });
        const docProxy = await loadingTask.promise;
        if (cancelled) return;

        let opened = false;
        let extracted = 0;

        const result = await extractPdfParagraphsStreaming(docProxy, (batch) => {
          if (cancelled) return;
          extracted += batch.paragraphs.length;
          setParagraphs((prev) => [...prev, ...batch.paragraphs]);
          setExtractProgress(batch.done ? null : { pagesDone: batch.pagesDone, totalPages: batch.totalPages });

          // Open as soon as there is something worth showing. With a saved
          // position that means waiting until the paragraph they left off at
          // actually exists - opening earlier would land them on a blank
          // virtualization window. A book with no saved position (every
          // first-ever open) shows the first batch immediately.
          if (!opened && (batch.done || extracted > resumeParagraphIndex)) {
            opened = true;
            setLoadState("ready");
          }
        });
        if (cancelled) return;

        // Written once the whole book is in hand, so a cache entry is never a
        // partial book - a cancelled open (reader backs out mid-extraction)
        // simply leaves no cache and re-streams next time.
        const record = {
          bookId,
          version: PDF_EXTRACT_VERSION,
          paragraphs: result.paragraphs,
          pageToParagraphIndex: result.pageToParagraphIndex,
          createdAt: Date.now(),
        };
        await savePdfText(record);

        // Chapters are a nicety, not a prerequisite for reading - extract them
        // after the text is up, then fold them into the same cache entry so the
        // next open has them without re-scanning.
        extractPdfToc(docProxy, result.pageToParagraphIndex)
          .then(async (realToc) => {
            if (cancelled) return;
            setTocItems(realToc);
            await savePdfText({ ...record, toc: realToc });
          })
          .catch((err) => console.warn("Background TOC extract warning:", err));
      } catch (err) {
        console.error("Failed to open PDF", err);
        if (!cancelled) {
          setErrorMessage("Couldn't open that document - the file may be corrupted.");
          setLoadState("error");
        }
      }
    }

    setup();
    return () => {
      cancelled = true;
      if (loadingTask) {
        loadingTask.destroy();
      }
    };
  }, [bookId]);

  // Clear tapped-highlight on mousedown only (not touchstart — that races
  // with the long-press timer and would kill it before it fires).
  useEffect(() => {
    if (!scrollContainer) return;
    const clear = () => setTappedHighlight(null);
    scrollContainer.addEventListener("mousedown", clear);
    return () => {
      scrollContainer.removeEventListener("mousedown", clear);
    };
  }, [scrollContainer]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (selection || tappedHighlight) {
          clearSelection();
          setTappedHighlight(null);
        } else {
          onExit();
        }
      }
      if (layoutMode === "paginated" && coreRef.current) {
        if (e.key === "ArrowRight") coreRef.current.goToNextPage();
        if (e.key === "ArrowLeft") coreRef.current.goToPrevPage();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selection, tappedHighlight, clearSelection, onExit, layoutMode]);

  function closePopover() {
    clearSelection();
    setTappedHighlight(null);
  }

  function adjustFont(next: number) {
    setFontPercent(next);
    setReaderPreferences({ fontPercent: next });
  }

  function adjustFontFamily(next: FontFamilyId) {
    setFontFamily(next);
    setReaderPreferences({ fontFamily: next });
  }

  function adjustLayoutMode(next: TextLayoutMode) {
    if (coreRef.current) {
      coreRef.current.capturePendingAnchor();
    }
    setLayoutMode(next);
    setReaderPreferences({ textLayoutMode: next });
  }

  function handleHighlightTap(record: HighlightRecord, event: React.MouseEvent) {
    clearSelection();
    const rect = event.currentTarget.getBoundingClientRect();
    setTappedHighlight({ record, anchor: anchorFromRect(rect) });
  }

  async function handleHighlight() {
    if (!selection) return;
    const record = await addHighlight(bookId, selection.phrase, selection.rawPosition);
    setHighlights((prev) => (prev.some((h) => h.id === record.id) ? prev : [...prev, record]));
  }

  async function handleRemoveHighlight() {
    if (!activeTappedHighlight) return;
    await deleteHighlight(activeTappedHighlight.record.id);
    setHighlights((prev) => prev.filter((h) => h.id !== activeTappedHighlight.record.id));
    setTappedHighlight(null);
  }

  async function handleSaveNote(note: string) {
    if (!activeTappedHighlight) return;
    const updated = await updateHighlightNote(activeTappedHighlight.record.id, note);
    if (!updated) return;
    setTappedHighlight((prev) => (prev ? { ...prev, record: updated } : prev));
    setHighlights((prev) => prev.map((h) => (h.id === updated.id ? updated : h)));
  }

  const handleScrollPositionChange = useCallback((anchorStr: string, fraction: number) => {
    void updateReadingPosition(bookId, anchorStr, fraction);
  }, [bookId]);

  if (loadState === "error") {
    return <ReaderErrorState message={errorMessage} onExit={onExit} />;
  }

  return (
    <ReaderChrome
      onExit={onExit}
      // While a first-ever extraction is still running, say so: pages keep
      // appearing underneath the reader and silence would read as a glitch.
      title={
        extractProgress
          ? `Preparing ${extractProgress.pagesDone} of ${extractProgress.totalPages} pages...`
          : layoutMode === "paginated"
            ? `Page ${currentPage + 1} of ${totalPages}`
            : title
      }
      progress={localProgress}
      loading={loadState === "loading"}
      controls={
        <>
          {layoutMode === "paginated" && (
            <div className="flex items-center gap-0.5 rounded-full border border-border bg-foreground/5 p-0.5">
              <button
                type="button"
                aria-label="Previous page"
                onClick={() => coreRef.current?.goToPrevPage()}
                className="flex h-7 w-7 items-center justify-center rounded-full text-foreground transition-colors hover:bg-foreground/10 active:scale-90"
              >
                <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5" aria-hidden="true">
                  <path d="M15 5l-7 7 7 7" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              <button
                type="button"
                aria-label="Next page"
                onClick={() => coreRef.current?.goToNextPage()}
                className="flex h-7 w-7 items-center justify-center rounded-full text-foreground transition-colors hover:bg-foreground/10 active:scale-90"
              >
                <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5" aria-hidden="true">
                  <path d="M9 5l7 7-7 7" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </div>
          )}
          <PdfChaptersMenu
            items={tocItems}
            onSelectEntry={(entry) => {
              coreRef.current?.jumpToAnchor({ paragraphIndex: entry.paragraphIndex });
            }}
          />
          <DisplaySettingsMenu
            typography={{
              fontPercent,
              onFontPercentChange: adjustFont,
              fontMin: FONT_PERCENT_MIN,
              fontMax: FONT_PERCENT_MAX,
              fontStep: FONT_PERCENT_STEP,
              fontFamily,
              onFontFamilyChange: adjustFontFamily,
            }}
            layout={{ mode: layoutMode, onModeChange: adjustLayoutMode }}
          />
        </>
      }
    >
      {loadState === "ready" && paragraphs.length > 0 && (
        <TextReaderCore
          ref={coreRef}
          paragraphs={paragraphs}
          highlights={highlights}
          fontPercent={fontPercent}
          fontFamily={fontFamily}
          layoutMode={layoutMode}
          onHighlightTap={handleHighlightTap}
          onScrollPositionChange={handleScrollPositionChange}
          onProgressChange={setLocalProgress}
          onPaginationChange={(page, total) => {
            setCurrentPage(page);
            setTotalPages(total);
          }}
          initialAnchor={initialAnchor}
          initialFraction={initialFraction}
        />
      )}

      {selection?.rects && <SelectionHighlight rects={selection.rects} />}
      {selection && (
        <DefinitionPopover
          key={`sel:${selection.rawPosition}`}
          phrase={selection.phrase}
          context={selection.context}
          anchor={selection.anchor}
          onClose={closePopover}
          onHighlight={handleHighlight}
        />
      )}
      {activeTappedHighlight && (
        <DefinitionPopover
          key={`hl:${activeTappedHighlight.record.id}`}
          phrase={activeTappedHighlight.record.phrase}
          context={activeTappedHighlight.record.phrase}
          anchor={activeTappedHighlight.anchor}
          note={activeTappedHighlight.record.note}
          onClose={closePopover}
          onHighlight={handleHighlight}
          onRemoveHighlight={handleRemoveHighlight}
          onSaveNote={handleSaveNote}
          isHighlighted
        />
      )}
    </ReaderChrome>
  );
}
