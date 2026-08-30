"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  addHighlight,
  deleteHighlight,
  getBookFile,
  getBookMeta,
  listHighlights,
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

type LoadState = "loading" | "ready" | "error";

export default function TextReaderView({ bookId, onExit }: { bookId: string; onExit: () => void }) {
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [errorMessage, setErrorMessage] = useState("");
  const [title, setTitle] = useState("");
  const [paragraphs, setParagraphs] = useState<string[]>([]);
  const [highlights, setHighlights] = useState<HighlightRecord[]>([]);
  const [progress, setProgress] = useState(0);

  const [fontPercent, setFontPercent] = useState(() => getReaderPreferences().fontPercent);
  const [fontFamily, setFontFamily] = useState<FontFamilyId>(() => getReaderPreferences().fontFamily);
  const [layoutMode, setLayoutMode] = useState<TextLayoutMode>(() => getReaderPreferences().textLayoutMode);
  
  const [currentPage, setCurrentPage] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [tappedHighlight, setTappedHighlight] = useState<{ record: HighlightRecord; anchor: SelectionAnchor } | null>(null);

  const [initialAnchor, setInitialAnchor] = useState<TextReadingAnchor | null>(null);
  const [initialFraction, setInitialFraction] = useState(0);

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

  useEffect(() => {
    let cancelled = false;

    async function setup() {
      const [file, meta, savedHighlights] = await Promise.all([
        getBookFile(bookId),
        getBookMeta(bookId),
        listHighlights(bookId),
      ]);
      if (cancelled) return;
      if (!file) {
        setErrorMessage("This note is missing from your library - it may have been removed.");
        setLoadState("error");
        return;
      }

      try {
        const text = await file.text();
        if (cancelled) return;

        setTitle(meta?.title ?? "Untitled Notes");
        setParagraphs(text.split(/\n{2,}/).filter((p) => p.trim().length > 0));
        setHighlights(savedHighlights);

        const parsedPosition = parseTextReadingPosition(meta?.lastPosition);
        if (parsedPosition.kind === "anchor") {
          setInitialAnchor({ paragraphIndex: parsedPosition.paragraphIndex });
          setInitialFraction(0);
        } else {
          setInitialAnchor(null);
          setInitialFraction(parsedPosition.value);
          setProgress(parsedPosition.value);
        }
        setLoadState("ready");
      } catch (err) {
        console.error("Failed to open text note", err);
        if (!cancelled) {
          setErrorMessage("Couldn't open that note.");
          setLoadState("error");
        }
      }
    }

    setup();
    return () => {
      cancelled = true;
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

  /** A note is stored ON a highlight - that underline is the only way back to
   * it once the popover closes. So a note saved straight from a fresh
   * selection (the usual case: long-press, Define, Save as Note) creates the
   * highlight it hangs off, rather than having nowhere to be written and
   * silently going nowhere. */
  async function handleSaveNote(note: string) {
    let target = activeTappedHighlight?.record;
    if (!target) {
      if (!selection) return;
      target = await addHighlight(bookId, selection.phrase, selection.rawPosition);
    }
    const updated = await updateHighlightNote(target.id, note);
    if (!updated) return;
    setHighlights((prev) =>
      prev.some((h) => h.id === updated.id)
        ? prev.map((h) => (h.id === updated.id ? updated : h))
        : [...prev, updated],
    );
    setTappedHighlight((prev) => (prev && prev.record.id === updated.id ? { ...prev, record: updated } : prev));
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
      title={layoutMode === "paginated" ? `Page ${currentPage + 1} of ${totalPages}` : title}
      progress={progress}
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
      {loadState === "ready" && (
        <TextReaderCore
          ref={coreRef}
          paragraphs={paragraphs}
          highlights={highlights}
          fontPercent={fontPercent}
          fontFamily={fontFamily}
          layoutMode={layoutMode}
          onHighlightTap={handleHighlightTap}
          onScrollPositionChange={handleScrollPositionChange}
          onProgressChange={setProgress}
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
          onSaveNote={handleSaveNote}
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
