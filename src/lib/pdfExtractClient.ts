import {
  classifyPdfError,
  extractPdfParagraphsStreaming,
  extractPdfToc,
  type PdfExtractBatch,
  type PdfExtractFailure,
  type PdfExtractRequest,
  type PdfExtractResponse,
  type PdfTocEntry,
} from "./pdfTextExtract";
import type { PDFDocumentLoadingTask } from "pdfjs-dist";

export type PdfExtractHandlers = {
  /** Fired per batch of decoded paragraphs, oldest first. Append them. */
  onBatch: (batch: PdfExtractBatch) => void;
  /** Fired once, after the last batch. `[]` when the book has no usable TOC. */
  onToc: (toc: PdfTocEntry[]) => void;
  onError: (failure: PdfExtractFailure) => void;
};

/** pdf.js needs these three at load time and they are all served from /public
 * (see scripts/copy-pdf-worker.mjs). Absolute, because the worker that receives
 * them resolves relative URLs against its own script, not the document. */
function assetUrls() {
  return {
    workerSrc: new URL("/pdf.worker.min.mjs", location.href).href,
    cMapUrl: new URL("/cmaps/", location.href).href,
    standardFontDataUrl: new URL("/standard_fonts/", location.href).href,
  };
}

/** Our own extraction worker, bundled to /public by
 * scripts/copy-pdf-worker.mjs rather than by Next - Turbopack emits
 * `new Worker(new URL("./x.ts", import.meta.url))` as a raw TypeScript asset,
 * which the browser cannot parse. */
const EXTRACT_WORKER_URL = "/pdfExtract.worker.js";

type Session = {
  cancelled: boolean;
  worker: Worker | null;
  task: PDFDocumentLoadingTask | null;
};

/** Extracts a PDF's text in a dedicated worker, calling `handlers` on the main
 * thread as results arrive. Returns a cancel function - call it when the reader
 * closes, which terminates the worker mid-book rather than letting it finish
 * work nobody will read.
 *
 * Falls back to extracting on the calling thread where a module worker can't be
 * created at all (a locked-down WebView, a CSP without worker-src). That path is
 * the slow one this file exists to replace, but a slow book beats an
 * unopenable one. */
export function startPdfExtraction(file: File, handlers: PdfExtractHandlers): () => void {
  const session: Session = { cancelled: false, worker: null, task: null };

  function cancel() {
    session.cancelled = true;
    session.worker?.terminate();
    session.worker = null;
    if (session.task) {
      session.task.destroy().catch(() => {});
      session.task = null;
    }
  }

  let worker: Worker;
  try {
    worker = new Worker(new URL(EXTRACT_WORKER_URL, location.href), {
      type: "module",
    });
  } catch (err) {
    console.warn("PDF extraction worker unavailable; extracting on the main thread:", err);
    void extractHere(file, handlers, session);
    return cancel;
  }
  session.worker = worker;

  // A worker that dies before delivering anything means the worker path is
  // broken here (bad bundle URL, blocked by policy), not that this book is
  // unreadable - retry it inline. Once paragraphs are already on screen,
  // restarting would duplicate them, so a late failure is just an error.
  let deliveredAnything = false;

  worker.onmessage = (event: MessageEvent<PdfExtractResponse>) => {
    if (session.cancelled) return;
    const message = event.data;

    if (message.type === "batch") {
      deliveredAnything = true;
      handlers.onBatch({
        paragraphs: message.paragraphs,
        pageToParagraphIndex: message.pageToParagraphIndex,
        pagesDone: message.pagesDone,
        totalPages: message.totalPages,
        done: message.done,
      });
      return;
    }

    if (message.type === "toc") {
      handlers.onToc(message.toc);
      // Everything this worker had to say has been said.
      session.worker?.terminate();
      session.worker = null;
      return;
    }

    if (message.type === "error") {
      handlers.onError({ reason: message.reason, message: message.message });
      session.worker?.terminate();
      session.worker = null;
    }

    // Anything else isn't ours. When pdf.js can't spawn a nested worker it
    // loads its worker module inline in our worker instead, and that module
    // greets the page over the same channel with a message in its own protocol.
    // Treating that as a failure would tear the extraction down on page one.
  };

  worker.onerror = (event) => {
    if (session.cancelled) return;
    session.worker?.terminate();
    session.worker = null;
    if (deliveredAnything) {
      handlers.onError(classifyPdfError(event.error ?? new Error(event.message || "PDF extraction worker failed")));
      return;
    }
    console.warn("PDF extraction worker failed to start; extracting on the main thread:", event.message);
    void extractHere(file, handlers, session);
  };

  const request: PdfExtractRequest = { file, ...assetUrls() };
  worker.postMessage(request);

  return cancel;
}

/** The pre-worker path, kept only as a fallback - see startPdfExtraction. */
async function extractHere(
  file: File,
  handlers: PdfExtractHandlers,
  session: Session,
): Promise<void> {
  try {
    const urls = assetUrls();
    const pdfjs = await import("pdfjs-dist");
    pdfjs.GlobalWorkerOptions.workerSrc = urls.workerSrc;

    const buffer = await file.arrayBuffer();
    if (session.cancelled) return;

    const task = pdfjs.getDocument({
      data: buffer,
      cMapUrl: urls.cMapUrl,
      cMapPacked: true,
      standardFontDataUrl: urls.standardFontDataUrl,
    });
    session.task = task;
    const doc = await task.promise;
    if (session.cancelled) return;

    const result = await extractPdfParagraphsStreaming(doc, (batch) => {
      if (!session.cancelled) handlers.onBatch(batch);
    });
    if (session.cancelled) return;

    let toc: PdfTocEntry[] = [];
    try {
      toc = await extractPdfToc(doc, result.pageToParagraphIndex);
    } catch (err) {
      console.warn("TOC scan failed:", err);
    }
    if (session.cancelled) return;
    handlers.onToc(toc);

    session.task = null;
    await task.destroy();
  } catch (err) {
    if (!session.cancelled) handlers.onError(classifyPdfError(err));
  }
}
