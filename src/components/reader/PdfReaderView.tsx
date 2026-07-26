"use client";

import { useEffect, useRef, useState } from "react";
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import type { TextLayer } from "pdfjs-dist";
import "pdfjs-dist/web/pdf_viewer.css";
import { getBookFile, getBookMeta, updateReadingPosition } from "@/lib/readerStorage";
import { useNativeSelection } from "./useNativeSelection";
import DefinitionPopover from "./DefinitionPopover";
import ReaderChrome, { ReaderErrorState } from "./ReaderChrome";

type LoadState = "loading" | "ready" | "error";

const MIN_SCALE = 0.5;
const MAX_SCALE = 3;
const ZOOM_STEP = 0.15;

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

export default function PdfReaderView({ bookId, onExit }: { bookId: string; onExit: () => void }) {
  const pageAreaRef = useRef<HTMLDivElement>(null);
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

  const { selection, clear: clearSelection } = useNativeSelection(pageAreaRef);

  // Open the document once per book, restore the saved (page, scale), and
  // compute a fit-to-width default scale for a never-opened PDF so it isn't
  // dropped in at pdf.js's arbitrary native scale of 1.
  useEffect(() => {
    let cancelled = false;

    async function setup() {
      const [file, meta] = await Promise.all([getBookFile(bookId), getBookMeta(bookId)]);
      if (cancelled) return;
      if (!file) {
        setErrorMessage("This document is missing from your library - it may have been removed.");
        setLoadState("error");
        return;
      }

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
        if (selection) clearSelection();
        else onExit();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageNumber, numPages, selection, clearSelection, onExit]);

  function goToPage(next: number) {
    setPageNumber(Math.min(numPages, Math.max(1, next)));
  }

  function adjustZoom(delta: number) {
    setScale((current) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, Number((current + delta).toFixed(2)))));
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
      }
    >
      <div ref={pageAreaRef} className="h-full w-full overflow-auto bg-background">
        <div className="flex min-h-full w-full items-start justify-center px-4 py-6">
          <div className="relative shadow-[0_20px_60px_-16px_rgba(0,0,0,0.8)]">
            <canvas ref={canvasRef} className="block rounded-sm" />
            <div ref={textLayerRef} className="textLayer absolute left-0 top-0" />
          </div>
        </div>
      </div>

      {/* Floating zoom pill - kept separate from the top chrome (which only
          ever carries pagination) so primary vs. secondary controls stay
          visually distinct, matching Books/Preview's own control hierarchy. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-4 z-20 flex justify-center">
        <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-white/10 bg-surface/80 px-2 py-1.5 backdrop-blur-xl shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_8px_28px_-8px_rgba(0,0,0,0.7)]">
          <button
            type="button"
            aria-label="Zoom out"
            onClick={() => adjustZoom(-ZOOM_STEP)}
            disabled={scale <= MIN_SCALE}
            className="flex h-7 w-7 items-center justify-center rounded-full text-sm font-semibold text-zinc-300 transition-colors hover:bg-white/10 active:scale-90 disabled:opacity-30"
          >
            −
          </button>
          <span className="w-10 text-center text-xs font-medium tabular-nums text-zinc-400">
            {Math.round(scale * 100)}%
          </span>
          <button
            type="button"
            aria-label="Zoom in"
            onClick={() => adjustZoom(ZOOM_STEP)}
            disabled={scale >= MAX_SCALE}
            className="flex h-7 w-7 items-center justify-center rounded-full text-sm font-semibold text-zinc-300 transition-colors hover:bg-white/10 active:scale-90 disabled:opacity-30"
          >
            +
          </button>
        </div>
      </div>

      {selection && (
        <DefinitionPopover
          phrase={selection.phrase}
          context={selection.context}
          anchor={selection.anchor}
          onClose={clearSelection}
        />
      )}
    </ReaderChrome>
  );
}
