// The PDF text pipeline, moved wholesale off the UI thread.
//
// pdf.js already parses pages in a worker of its own, but everything after that
// ran on the main thread: the structured-clone of every page's text items, the
// geometric line/paragraph grouping, and - by far the most expensive part - the
// per-paragraph trigram analysis that recovers Type3-encoded books' Caesar
// shift. On a 444-page PDF that added up to over a minute of a thread that was
// also supposed to be scrolling text and answering taps.
//
// So the whole document lives here instead: this worker owns the
// PDFDocumentProxy, streams decoded paragraphs back batch by batch, and scans
// the table of contents afterwards. The main thread only ever receives finished
// strings. pdf.js spawns its own worker nested inside this one; where a runtime
// forbids nested workers it silently falls back to running that stage inline
// here, which is still not the UI thread.
import * as pdfjs from "pdfjs-dist";
import type { PDFDocumentLoadingTask } from "pdfjs-dist";
import {
  classifyPdfError,
  extractPdfParagraphsStreaming,
  extractPdfToc,
  type PdfExtractRequest,
  type PdfExtractResponse,
} from "@/lib/pdfTextExtract";

// tsconfig loads the "dom" lib (this is a Next app), not "webworker", and
// pulling the latter in via a triple-slash reference would collide with it on
// every shared global. The two members this file touches are easier to just
// declare.
type WorkerScope = {
  postMessage: (message: PdfExtractResponse) => void;
  addEventListener: (
    type: "message",
    listener: (event: MessageEvent<PdfExtractRequest>) => void,
  ) => void;
};

const ctx = self as unknown as WorkerScope;

function post(message: PdfExtractResponse) {
  ctx.postMessage(message);
}

// One extraction per worker: the reader creates a worker per book and
// terminates it when the book closes, so a second request would only ever be a
// bug (and would interleave two documents' paragraphs into one stream).
let started = false;

// addEventListener rather than `onmessage =`: pdf.js, when it cannot spawn a
// nested worker and loads its worker module inline here instead, installs its
// own `self.onmessage` and would silently take over this channel. A listener
// registered before that happens keeps receiving messages either way.
ctx.addEventListener("message", async (event: MessageEvent<PdfExtractRequest>) => {
  if (started) return;
  started = true;

  const request = event.data;
  let loadingTask: PDFDocumentLoadingTask | null = null;

  try {
    pdfjs.GlobalWorkerOptions.workerSrc = request.workerSrc;

    const buffer = await request.file.arrayBuffer();
    loadingTask = pdfjs.getDocument({
      data: buffer,
      // Same three assets the main thread used to pass, now as absolute URLs -
      // a worker resolves relative paths against its own script, not the
      // document. Without them, CID-keyed and non-embedded-font PDFs extract
      // as mojibake, which is what a long-press would then hand to /api/define.
      cMapUrl: request.cMapUrl,
      cMapPacked: true,
      standardFontDataUrl: request.standardFontDataUrl,
    });
    const doc = await loadingTask.promise;

    const result = await extractPdfParagraphsStreaming(doc, (batch) => {
      post({ type: "batch", ...batch });
    });

    // Chapters are a nicety, not a prerequisite for reading, and this scan
    // re-reads page text the extraction above has already read once. It runs
    // strictly behind an already-readable book, and a failure here should never
    // cost the reader the text it already has - hence the empty-list fallback.
    let toc: Awaited<ReturnType<typeof extractPdfToc>> = [];
    try {
      toc = await extractPdfToc(doc, result.pageToParagraphIndex);
    } catch (err) {
      console.warn("TOC scan failed in extraction worker:", err);
    }
    post({ type: "toc", toc });

    await loadingTask.destroy();
    loadingTask = null;
  } catch (err) {
    post({ type: "error", ...classifyPdfError(err) });
    if (loadingTask) {
      // Best-effort: the document may never have finished loading.
      loadingTask.destroy().catch(() => {});
    }
  }
});
