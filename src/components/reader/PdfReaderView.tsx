"use client";

import { useEffect, useRef, useState } from "react";
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import type { TextLayer } from "pdfjs-dist";
import "pdfjs-dist/web/pdf_viewer.css";
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

type LoadState = "loading" | "ready" | "error";

// 50%-300%, matching the previous stepped range - only the granularity
// changed (a smooth 1% slider instead of a 15%-per-click jump), so existing
// per-book saved scales still fall well within bounds.
const MIN_SCALE = 0.5;
const MAX_SCALE = 3;
const ZOOM_STEP_PERCENT = 1;

// pdf.js draws its own white page onto the canvas - the classic trick for
// faking dark mode over that is inverting the whole canvas, with a
// hue-rotate to cancel invert()'s hue flip (so a blue diagram stays roughly
// blue instead of turning orange) and brightness/contrast pulled in from the
// harsh true-invert extremes toward something closer to an OLED reader's
// near-black. Scoped to the canvas ONLY (not a wrapper) - the text layer is
// already transparent, and highlight overlays are separate siblings that
// must NOT get re-inverted back to the wrong color.
const PDF_DARK_MODE_FILTER = "invert(1) hue-rotate(180deg) brightness(0.94) contrast(0.88)";

type StoredPosition = { page: number; scale: number };

function parsePosition(raw: string | null | undefined): StoredPosition | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed.page === "number" && typeof parsed.scale === "number") return parsed;
  } catch {
    // Falls through to null - a corrupted/foreign position string just
    // means "start fresh" rather than crashing the reader.
  }
  return null;
}

type UnitRect = { x: number; y: number; width: number; height: number };
type HighlightPosition = { page: number; unitRects: UnitRect[] };

function parseHighlightPosition(raw: string): HighlightPosition | null {
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed.page === "number" && Array.isArray(parsed.unitRects)) return parsed;
  } catch {
    // A highlight saved by some future/incompatible format just doesn't render.
  }
  return null;
}

const UNDERLINE_THICKNESS = 3;

/** Persistent highlights, positioned relative to the page box (not fixed to
 * the viewport like SelectionHighlight's transient overlay) so they scroll
 * and zoom together with the page. unitRects are 0-1 fractions of the page's
 * rendered size, reprojected here against whatever that size currently is -
 * correct at any zoom level without needing to touch pdf.js's own coordinate
 * system. Each rect renders as a bold Electric Azure underline (a thin bar at
 * its own bottom edge), not a filled block - a hit-testable but visually
 * invisible full-height wrapper keeps the tap target line-sized rather than
 * shrinking it down to the 3px bar itself. */
function PdfHighlightOverlay({
  highlights,
  pageNumber,
  viewportWidth,
  viewportHeight,
  onHighlightClick,
}: {
  highlights: HighlightRecord[];
  pageNumber: number;
  viewportWidth: number;
  viewportHeight: number;
  onHighlightClick: (record: HighlightRecord, event: React.MouseEvent) => void;
}) {
  return (
    <div className="pointer-events-none absolute inset-0 z-10" aria-hidden="true">
      {highlights.flatMap((h) => {
        const position = parseHighlightPosition(h.position);
        if (!position || position.page !== pageNumber) return [];
        return position.unitRects.map((r, i) => (
          <button
            key={`${h.id}-${i}`}
            type="button"
            aria-label={`Highlighted: ${h.phrase}`}
            onClick={(e) => onHighlightClick(h, e)}
            className="pointer-events-auto absolute cursor-pointer"
            style={{
              left: r.x * viewportWidth,
              top: r.y * viewportHeight,
              width: r.width * viewportWidth,
              height: r.height * viewportHeight,
            }}
          >
            <span
              className="absolute inset-x-0 bottom-0 block rounded-[1px] bg-accent"
              style={{ height: UNDERLINE_THICKNESS, opacity: 0.9 }}
            />
          </button>
        ));
      })}
    </div>
  );
}

export default function PdfReaderView({ bookId, onExit }: { bookId: string; onExit: () => void }) {
  const pageAreaRef = useRef<HTMLDivElement>(null);
  const pageBoxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const docRef = useRef<PDFDocumentProxy | null>(null);
  const loadingTaskRef = useRef<PDFDocumentLoadingTask | null>(null);
  const renderTaskRef = useRef<RenderTask | null>(null);
  const textLayerTaskRef = useRef<TextLayer | null>(null);

  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [errorMessage, setErrorMessage] = useState("");
  const [pageNumber, setPageNumber] = useState(1);
  const [numPages, setNumPages] = useState(0);
  const [scale, setScale] = useState(1);
  const [viewportSize, setViewportSize] = useState<{ width: number; height: number } | null>(null);
  const [highlights, setHighlights] = useState<HighlightRecord[]>([]);
  const [tappedHighlight, setTappedHighlight] = useState<{ record: HighlightRecord; anchor: SelectionAnchor } | null>(
    null,
  );

  // Page-relative (not viewport-relative) unit-fraction rects, reprojected
  // against the page box's CURRENT on-screen size - correct at any zoom
  // level, and consistent with how the persisted highlights above reproject too.
  function derivePdfPosition(range: Range): string {
    const boxRect = pageBoxRef.current?.getBoundingClientRect();
    if (!boxRect || boxRect.width === 0 || boxRect.height === 0) return "";
    const unitRects: UnitRect[] = Array.from(range.getClientRects()).map((r) => ({
      x: (r.left - boxRect.left) / boxRect.width,
      y: (r.top - boxRect.top) / boxRect.height,
      width: r.width / boxRect.width,
      height: r.height / boxRect.height,
    }));
    return JSON.stringify({ page: pageNumber, unitRects } satisfies HighlightPosition);
  }

  const { selection, clear: clearSelection } = useNativeSelection(pageAreaRef, derivePdfPosition);

  // A fresh new-selection popover and a tapped-existing-highlight popover are
  // mutually exclusive - capturing a new one implicitly means whatever
  // highlight popover was open is now stale. Derived at render time rather
  // than synced via an effect: there's no cross-state invariant to enforce
  // here, just a value ("what should the highlight popover show right now")
  // that depends on two independently-set pieces of state.
  const activeTappedHighlight = selection ? null : tappedHighlight;

  // Mirrors useNativeSelection's own "clear on any fresh tap/click in the
  // container" listeners, but for tappedHighlight specifically - mousedown/
  // touchstart always fire before the highlight rect's own onClick for the
  // same physical gesture, so tapping a highlight still correctly ends up
  // clearing-then-setting in that order, not racing it.
  useEffect(() => {
    const container = pageAreaRef.current;
    if (!container) return;
    const clear = () => setTappedHighlight(null);
    container.addEventListener("mousedown", clear);
    container.addEventListener("touchstart", clear);
    return () => {
      container.removeEventListener("mousedown", clear);
      container.removeEventListener("touchstart", clear);
    };
  }, []);

  function handleHighlightTap(record: HighlightRecord, event: React.MouseEvent) {
    clearSelection();
    const rect = event.currentTarget.getBoundingClientRect();
    setTappedHighlight({ record, anchor: anchorFromRect(rect) });
  }

  // Open the document once per book, restore the saved (page, scale), and
  // compute a fit-to-width default scale for a never-opened PDF so it isn't
  // dropped in at pdf.js's arbitrary native scale of 1.
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
        setErrorMessage("This document is missing from your library - it may have been removed.");
        setLoadState("error");
        return;
      }
      setHighlights(savedHighlights);

      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

        const buffer = await file.arrayBuffer();
        if (cancelled) return;

        const loadingTask = pdfjs.getDocument({ data: buffer });
        loadingTaskRef.current = loadingTask;
        const doc = await loadingTask.promise;
        if (cancelled) return;
        docRef.current = doc;
        setNumPages(doc.numPages);

        const saved = parsePosition(meta?.lastPosition);
        if (saved && saved.page >= 1 && saved.page <= doc.numPages) {
          setPageNumber(saved.page);
          setScale(saved.scale);
        } else {
          const firstPage = await doc.getPage(1);
          const nativeWidth = firstPage.getViewport({ scale: 1 }).width;
          const containerWidth = pageAreaRef.current?.clientWidth ?? nativeWidth;
          const fitScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, (containerWidth - 32) / nativeWidth));
          setScale(fitScale);
        }

        setLoadState("ready");
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
      renderTaskRef.current?.cancel();
      textLayerTaskRef.current?.cancel();
      void loadingTaskRef.current?.destroy();
      loadingTaskRef.current = null;
      docRef.current = null;
    };
  }, [bookId]);

  // Renders the current page whenever page/scale changes, cancelling any
  // still-in-flight render from a previous page/zoom change first - pdf.js
  // throws if a second render() starts on the same canvas before the first finishes.
  useEffect(() => {
    if (loadState !== "ready") return;
    const doc = docRef.current;
    const canvas = canvasRef.current;
    const textLayerContainer = textLayerRef.current;
    if (!doc || !canvas || !textLayerContainer) return;

    let cancelled = false;

    const renderPage = async () => {
      renderTaskRef.current?.cancel();
      textLayerTaskRef.current?.cancel();

      const page = await doc.getPage(pageNumber);
      if (cancelled) return;

      const viewport = page.getViewport({ scale });
      const outputScale = window.devicePixelRatio || 1;

      canvas.width = Math.floor(viewport.width * outputScale);
      canvas.height = Math.floor(viewport.height * outputScale);
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;
      setViewportSize({ width: viewport.width, height: viewport.height });

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const renderTask = page.render({
        canvas,
        viewport,
        transform: outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : undefined,
      });
      renderTaskRef.current = renderTask;
      await renderTask.promise;
      if (cancelled) return;

      // TextLayer needs an empty container per render, and its span sizing
      // is driven by --total-scale-factor rather than a JS argument - see
      // pdfjs-dist/web/pdf_viewer.css's .textLayer rules for the contract.
      textLayerContainer.replaceChildren();
      textLayerContainer.style.width = `${viewport.width}px`;
      textLayerContainer.style.height = `${viewport.height}px`;
      textLayerContainer.style.setProperty("--total-scale-factor", String(scale));
      textLayerContainer.style.setProperty("--scale-round-x", "1px");
      textLayerContainer.style.setProperty("--scale-round-y", "1px");

      const pdfjsModule = await import("pdfjs-dist");
      const textLayer = new pdfjsModule.TextLayer({
        textContentSource: page.streamTextContent(),
        container: textLayerContainer,
        viewport,
      });
      textLayerTaskRef.current = textLayer;
      await textLayer.render();
    };

    renderPage().catch((err) => {
      if (!cancelled) console.error("Failed to render PDF page", err);
    });

    return () => {
      cancelled = true;
    };
  }, [pageNumber, scale, loadState]);

  // Persist position/progress on every page or zoom change - matches the
  // epub reader's "on every relocate" persistence, just triggered by state
  // instead of a rendition event.
  useEffect(() => {
    if (loadState !== "ready" || numPages === 0) return;
    void updateReadingPosition(bookId, JSON.stringify({ page: pageNumber, scale }), pageNumber / numPages);
  }, [bookId, pageNumber, scale, numPages, loadState]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "ArrowRight") goToPage(pageNumber + 1);
      if (e.key === "ArrowLeft") goToPage(pageNumber - 1);
      if (e.key === "Escape") {
        if (selection || tappedHighlight) {
          clearSelection();
          setTappedHighlight(null);
        } else {
          onExit();
        }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageNumber, numPages, selection, tappedHighlight, clearSelection, onExit]);

  function goToPage(next: number) {
    setPageNumber(Math.min(numPages, Math.max(1, next)));
  }

  function setZoomPercent(percent: number) {
    setScale(Math.min(MAX_SCALE, Math.max(MIN_SCALE, percent / 100)));
  }

  function closePopover() {
    clearSelection();
    setTappedHighlight(null);
  }

  async function handleHighlight() {
    if (!selection) return;
    const record = await addHighlight(bookId, selection.phrase, selection.rawPosition);
    // addHighlight is idempotent at the DB level (highlighting the same spot
    // twice returns the EXISTING record rather than inserting a duplicate),
    // but blindly appending here regardless would still duplicate it in this
    // local array - and PdfHighlightOverlay renders one bar per array entry.
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
    // Keep both the open popover's record AND the master highlights array
    // in sync - the array is what PdfHighlightOverlay renders from, though
    // notes are pure metadata with no visual mark on the page itself.
    setTappedHighlight((prev) => (prev ? { ...prev, record: updated } : prev));
    setHighlights((prev) => prev.map((h) => (h.id === updated.id ? updated : h)));
  }

  if (loadState === "error") {
    return <ReaderErrorState message={errorMessage} onExit={onExit} />;
  }

  return (
    <ReaderChrome
      onExit={onExit}
      title={numPages ? `Page ${pageNumber} of ${numPages}` : ""}
      progress={numPages ? pageNumber / numPages : 0}
      loading={loadState === "loading"}
      controls={
        <>
          <div className="flex items-center gap-0.5 rounded-full border border-white/10 bg-white/5 p-0.5">
            <button
              type="button"
              aria-label="Previous page"
              onClick={() => goToPage(pageNumber - 1)}
              disabled={pageNumber <= 1}
              className="flex h-7 w-7 items-center justify-center rounded-full text-zinc-300 transition-colors hover:bg-white/10 active:scale-90 disabled:opacity-30"
            >
              <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5" aria-hidden="true">
                <path d="M15 5l-7 7 7 7" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <button
              type="button"
              aria-label="Next page"
              onClick={() => goToPage(pageNumber + 1)}
              disabled={pageNumber >= numPages}
              className="flex h-7 w-7 items-center justify-center rounded-full text-zinc-300 transition-colors hover:bg-white/10 active:scale-90 disabled:opacity-30"
            >
              <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5" aria-hidden="true">
                <path d="M9 5l7 7-7 7" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
          <DisplaySettingsMenu
            zoom={{
              percent: scale * 100,
              min: MIN_SCALE * 100,
              max: MAX_SCALE * 100,
              step: ZOOM_STEP_PERCENT,
              onChange: setZoomPercent,
            }}
          />
        </>
      }
    >
      <div ref={pageAreaRef} className="h-full w-full overflow-auto bg-background">
        <div className="flex min-h-full w-full items-start justify-center px-4 py-6">
          <div ref={pageBoxRef} className="relative shadow-[0_20px_60px_-16px_rgba(0,0,0,0.8)]">
            <canvas ref={canvasRef} className="block rounded-sm" style={{ filter: PDF_DARK_MODE_FILTER }} />
            <div ref={textLayerRef} className="textLayer absolute left-0 top-0" />
            {viewportSize && (
              <PdfHighlightOverlay
                highlights={highlights}
                pageNumber={pageNumber}
                viewportWidth={viewportSize.width}
                viewportHeight={viewportSize.height}
                onHighlightClick={handleHighlightTap}
              />
            )}
          </div>
        </div>
      </div>

      {selection?.rects && <SelectionHighlight rects={selection.rects} />}
      {selection && (
        <DefinitionPopover
          phrase={selection.phrase}
          context={selection.context}
          anchor={selection.anchor}
          onClose={closePopover}
          onHighlight={handleHighlight}
        />
      )}
      {activeTappedHighlight && (
        <DefinitionPopover
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
