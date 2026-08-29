"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import {
  addHighlight,
  deleteHighlight,
  getBookFile,
  getBookMeta,
  getPdfText,
  listHighlights,
  remapHighlightParagraphs,
  savePdfText,
  updateHighlightNote,
  updateReadingPosition,
} from "@/lib/readerStorage";
import type { HighlightRecord } from "@/lib/types";
import { anchorFromRect, type SelectionAnchor } from "./selection";
import { useNativeSelection } from "./useNativeSelection";
import DefinitionPopover from "./DefinitionPopover";
import SelectionHighlight from "./SelectionHighlight";
import ReaderChrome, { ReaderErrorState, type ReaderStateIcon } from "./ReaderChrome";
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
  assessPdfText,
  blankFilterRemap,
  isBlankParagraph,
  PDF_EXTRACT_VERSION,
  type PdfTocEntry,
  type TextlessPdf,
} from "@/lib/pdfTextExtract";
import { startPdfExtraction } from "@/lib/pdfExtractClient";
import type { PdfExtractFailure } from "@/lib/pdfTextExtract";
import type { PdfTextRecord } from "@/lib/readerStorage";

type LoadState = "loading" | "ready" | "error";

/** Copy for every way opening a PDF can fail. Each one names what happened and,
 * where there is one, what the reader can do about it. */
const FAILURE_COPY: Record<PdfExtractFailure["reason"], { title: string; message: string; icon: ReaderStateIcon }> = {
  password: {
    title: "This PDF is locked",
    message:
      "It is password-protected, so its text can't be read. Remove the password in any PDF tool and add it to your library again.",
    icon: "lock",
  },
  invalid: {
    title: "This file is damaged",
    message:
      "The PDF's internal structure is broken, so there is nothing to read. Re-downloading it usually fixes this.",
    icon: "file",
  },
  unknown: {
    title: "Couldn't open this PDF",
    message: "Something went wrong reading the file, so its text couldn't be extracted.",
    icon: "file",
  },
};

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
  const [failure, setFailure] = useState<{ title: string; message: string; icon: ReaderStateIcon } | null>(null);
  // Set once extraction has finished and produced too little to read. The
  // override is the reader taking the "open anyway" escape hatch.
  const [textless, setTextless] = useState<TextlessPdf | null>(null);
  const [openedAnyway, setOpenedAnyway] = useState(false);
  const [title, setTitle] = useState("");
  
  const [paragraphs, setParagraphs] = useState<string[]>([]);
  // 1-based PDF page -> first paragraph on it. Drives the reader's page counter
  // and progress, so both describe the book rather than the columns of whatever
  // slice of it is currently in the DOM.
  const [pageMap, setPageMap] = useState<Record<number, number>>({});
  const [pageCount, setPageCount] = useState<number | undefined>(undefined);
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
  //
  // Tiers 2 and 3 run entirely inside a worker (see lib/pdfExtractClient), so
  // even that once-per-book cost never lands on the UI thread: this component
  // only ever receives finished paragraphs.
  useEffect(() => {
    let cancelled = false;
    let cancelExtraction: (() => void) | null = null;

    async function setup() {
      const [file, meta, savedHighlights] = await Promise.all([
        getBookFile(bookId),
        getBookMeta(bookId),
        listHighlights(bookId),
      ]);
      if (cancelled) return;
      if (!file) {
        setFailure({
          title: "This document is missing",
          message:
            "It is no longer in your library — it may have been removed from this device. Add the file again to keep reading.",
          icon: "file",
        });
        setLoadState("error");
        return;
      }

      try {
        setTitle(meta?.title ?? "Untitled Document");
        setHighlights(savedHighlights);

        // Parse the saved position first: it decides how much of the book has
        // to exist before opening is useful (see resumeParagraphIndex below).
        let resumeParagraphIndex: number | null = null;
        if (meta?.lastPosition) {
          try {
            const parsed = JSON.parse(meta.lastPosition);
            if (typeof parsed.paragraphIndex === "number") {
              resumeParagraphIndex = parsed.paragraphIndex;
            }
          } catch {
            const parsedPosition = parseTextReadingPosition(meta.lastPosition);
            if (parsedPosition.kind === "fraction") setInitialFraction(parsedPosition.value);
          }
        }

        let record = await getPdfText(bookId);
        if (cancelled) return;

        // v2 of the extractor drops paragraphs that decode to nothing but
        // whitespace. The survivors are byte-identical to what v1 stored, so a v1
        // record is filtered in place rather than thrown away - re-extracting a
        // 444-page book costs ~15s on a phone - and every index stored against
        // the old numbering moves with it.
        if (record && record.version === 1) {
          const remap = blankFilterRemap(record.paragraphs);
          const paragraphs = record.paragraphs.filter((p) => !isBlankParagraph(p));
          const pageToParagraphIndex: Record<number, number> = {};
          for (const [page, index] of Object.entries(record.pageToParagraphIndex)) {
            const moved = remap(index);
            if (moved < paragraphs.length) pageToParagraphIndex[Number(page)] = moved;
          }
          const toc = (record.toc as PdfTocEntry[] | undefined)?.map((entry) => ({
            ...entry,
            paragraphIndex: remap(entry.paragraphIndex),
          }));

          record = { ...record, version: PDF_EXTRACT_VERSION, paragraphs, pageToParagraphIndex, toc };
          await savePdfText(record);
          if (resumeParagraphIndex !== null) {
            resumeParagraphIndex = remap(resumeParagraphIndex);
            // Persisted, not just used for this open: the stored position is in
            // v1 numbering, and once the record is v2 nothing would remap it
            // again - so a reader who backs out without turning a page would
            // come back to an index three times too deep. Progress is a fraction
            // of the book and so survives renumbering untouched.
            await updateReadingPosition(
              bookId,
              JSON.stringify({ paragraphIndex: resumeParagraphIndex } satisfies TextReadingAnchor),
              meta?.progress ?? 0,
            );
          }
          const movedHighlights = await remapHighlightParagraphs(bookId, remap);
          if (cancelled) return;
          setHighlights(movedHighlights);
        }

        if (resumeParagraphIndex !== null) {
          setInitialAnchor({ paragraphIndex: resumeParagraphIndex });
          setInitialFraction(0);
        }

        if (record && record.version === PDF_EXTRACT_VERSION) {
          setParagraphs(record.paragraphs);
          setPageMap(record.pageToParagraphIndex);
          setPageCount(record.pageCount);
          setTocItems((record.toc as PdfTocEntry[] | undefined) ?? []);
          // A scan caches as an empty record rather than re-running a fruitless
          // 15-second extraction on every open, so this verdict is reached from
          // the cache too.
          setTextless(assessPdfText(record.paragraphs, record.pageCount));
          setLoadState("ready");
          return;
        }

        // Accumulated separately from React state because the cache entry needs
        // the whole book in one piece, and a state updater can't be read back.
        const allParagraphs: string[] = [];
        const allPageIndex: Record<number, number> = {};
        let cacheRecord: PdfTextRecord | null = null;
        let opened = false;
        const resumeAt = resumeParagraphIndex ?? 0;

        cancelExtraction = startPdfExtraction(file, {
          onBatch: (batch) => {
            if (cancelled) return;
            allParagraphs.push(...batch.paragraphs);
            Object.assign(allPageIndex, batch.pageToParagraphIndex);
            setParagraphs([...allParagraphs]);
            setPageMap({ ...allPageIndex });
            setPageCount(batch.totalPages);
            setExtractProgress(batch.done ? null : { pagesDone: batch.pagesDone, totalPages: batch.totalPages });

            // Open as soon as there is something worth showing. With a saved
            // position that means waiting until the paragraph they left off at
            // actually exists - opening earlier would land them on a blank
            // virtualization window. A book with no saved position (every
            // first-ever open) shows the first batch immediately.
            if (!opened && (batch.done || allParagraphs.length > resumeAt)) {
              opened = true;
              setLoadState("ready");
            }

            // Written once the whole book is in hand, so a cache entry is never
            // a partial book - a cancelled open (reader backs out
            // mid-extraction) simply leaves no cache and re-extracts next time.
            if (batch.done) {
              setTextless(assessPdfText(allParagraphs, batch.totalPages));
              cacheRecord = {
                bookId,
                version: PDF_EXTRACT_VERSION,
                paragraphs: allParagraphs,
                pageToParagraphIndex: allPageIndex,
                pageCount: batch.totalPages,
                createdAt: Date.now(),
              };
              void savePdfText(cacheRecord);
            }
          },
          // Chapters arrive behind the text and fold into the same cache entry,
          // so the next open has them without re-scanning.
          onToc: (toc) => {
            if (cancelled) return;
            setTocItems(toc);
            if (cacheRecord) void savePdfText({ ...cacheRecord, toc });
          },
          onError: (extractFailure) => {
            console.error("Failed to extract PDF text", extractFailure);
            if (cancelled) return;
            // Whatever pages made it are still readable; just stop claiming
            // more are coming.
            setExtractProgress(null);
            if (opened) return;
            setFailure(FAILURE_COPY[extractFailure.reason]);
            setLoadState("error");
          },
        });
      } catch (err) {
        console.error("Failed to open PDF", err);
        if (!cancelled) {
          setFailure(FAILURE_COPY.unknown);
          setLoadState("error");
        }
      }
    }

    setup();
    return () => {
      cancelled = true;
      cancelExtraction?.();
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

  if (loadState === "error" && failure) {
    return (
      <ReaderErrorState
        title={failure.title}
        message={failure.message}
        icon={failure.icon}
        context={title || undefined}
        onExit={onExit}
      />
    );
  }

  // Extraction succeeded and there is nothing worth reading in the result. Said
  // plainly, because the alternative - what this used to do - is an empty reader
  // with a back button, which reads as the app being broken.
  if (textless && !openedAnyway) {
    if (textless.kind === "none") {
      return (
        <ReaderErrorState
          title="No text in this PDF"
          message="Every page is an image — a scan, or a photographed book — so there are no words to reflow, highlight or define. A PDF exported from a word processor or an ebook tool will work."
          icon="scan"
          context={title || undefined}
          onExit={onExit}
        />
      );
    }
    return (
      <ReaderErrorState
        title="Almost no readable text"
        message={`Only about ${textless.words.toLocaleString()} ${textless.words === 1 ? "word" : "words"} came out of ${textless.pages.toLocaleString()} pages, so most of this PDF is probably images rather than text. You can still open what was found.`}
        icon="scan"
        context={title || undefined}
        onExit={onExit}
        action={{ label: "Open anyway", onClick: () => setOpenedAnyway(true) }}
      />
    );
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
          pageMap={pageMap}
          pageCount={pageCount}
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
