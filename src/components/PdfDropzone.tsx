"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useDropzone, type FileRejection } from "react-dropzone";
import { motion, AnimatePresence } from "motion/react";
import { startPdfExtraction } from "@/lib/pdfExtractClient";
import { assessPdfText, type PdfExtractFailure } from "@/lib/pdfTextExtract";

type Status =
  | { state: "idle" }
  | { state: "extracting"; fileName: string; pagesDone: number; totalPages: number }
  | { state: "error"; message: string };

type PdfDropzoneProps = {
  onExtracted: (text: string, fileName: string) => void;
};

/** What to tell someone whose PDF could not be opened at all. The three reasons
 * are worth telling apart: one is a file they can fix, one is a file that is
 * broken, and calling the first one "damaged" sends them off deleting a
 * perfectly good book. */
function messageForFailure(failure: PdfExtractFailure): string {
  if (failure.reason === "password") {
    return "That PDF is password-protected. Remove the password and upload it again.";
  }
  if (failure.reason === "invalid") {
    return "That file isn't a PDF we can read - it may be damaged or only partly downloaded.";
  }
  return failure.message || "Failed to read that PDF.";
}

export default function PdfDropzone({ onExtracted }: PdfDropzoneProps) {
  const [status, setStatus] = useState<Status>({ state: "idle" });
  // The live extraction's cancel function, so a second drop (or leaving the
  // page) terminates the worker instead of leaving it decoding a book whose
  // paragraphs nothing will read.
  const cancelRef = useRef<(() => void) | null>(null);

  const cancelExtraction = useCallback(() => {
    cancelRef.current?.();
    cancelRef.current = null;
  }, []);

  useEffect(() => cancelExtraction, [cancelExtraction]);

  function handleDrop(acceptedFiles: File[], fileRejections: FileRejection[]) {
    if (fileRejections.length > 0) {
      setStatus({ state: "error", message: "Only PDF files are supported." });
      return;
    }

    const file = acceptedFiles[0];
    if (!file) return;

    cancelExtraction();
    setStatus({ state: "extracting", fileName: file.name, pagesDone: 0, totalPages: 0 });

    // Extraction runs in src/workers/pdfExtract.worker.ts - the same pipeline the
    // reader uses, called rather than duplicated. Two things follow from that
    // which the old inline loop in this file could not offer: the page decoding,
    // paragraph grouping and Type3 cipher recovery all happen off the UI thread
    // (a 444-page book used to freeze the phone for over a minute, and on Android
    // a frozen WebView is indistinguishable from a crashed app), and pdf.js gets
    // handed its cMap and standard-font assets, without which a CID-keyed book
    // extracts as mojibake and every card generated from it is nonsense.
    const paragraphs: string[] = [];
    let pageCount: number | undefined;
    let finished = false;

    function finish() {
      if (finished) return;
      finished = true;
      cancelExtraction();

      // A scan has no text layer to read, and a near-scan has a few stamped
      // characters per page. Either way there is nothing here to make cards from,
      // and handing it to the model would spend one of a FREE account's monthly
      // decks on stray glyphs.
      const textless = assessPdfText(paragraphs, pageCount);
      if (textless) {
        setStatus({
          state: "error",
          message:
            textless.kind === "none"
              ? "Couldn't find any text in that PDF - it may be scanned images rather than real text."
              : `That PDF only has about ${textless.words} words of real text across ${textless.pages} pages, so it's almost certainly page scans. Cards made from it wouldn't be worth studying.`,
        });
        return;
      }

      setStatus({ state: "idle" });
      onExtracted(paragraphs.join("\n\n"), file.name);
    }

    const cancel = startPdfExtraction(file, {
      onBatch: (batch) => {
        if (finished) return;
        paragraphs.push(...batch.paragraphs);
        pageCount = batch.totalPages;
        setStatus({
          state: "extracting",
          fileName: file.name,
          pagesDone: batch.pagesDone,
          totalPages: batch.totalPages,
        });
        if (batch.done) finish();
      },
      // Chapter titles are no use to the ingest pipeline, so the last batch is
      // what finishes this. onToc only ever arrives for a document that produced
      // no batch at all, and it is kept as the backstop for exactly that.
      onToc: () => finish(),
      onError: (failure) => {
        if (finished) return;
        finished = true;
        cancelExtraction();
        setStatus({ state: "error", message: messageForFailure(failure) });
      },
    });

    // A one-page document can be finished before this line is reached, and a
    // cancel stored after the fact would leave a live worker nothing ever stops.
    if (finished) cancel();
    else cancelRef.current = cancel;
  }

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: handleDrop,
    accept: { "application/pdf": [".pdf"] },
    multiple: false,
    disabled: status.state === "extracting",
  });

  const progress =
    status.state === "extracting" && status.totalPages > 0
      ? `${status.pagesDone} of ${status.totalPages} pages`
      : null;

  return (
    <div className="w-full">
      <div {...getRootProps()} className="cursor-pointer">
        <input {...getInputProps()} />

        <motion.div
          // borderColor/backgroundColor are plain Tailwind classes, not part of
          // this animate object - Framer Motion's color tween needs literal
          // rgba/hex values it can interpolate, which can't express the
          // foreground token's light/dark swap the way `hsl(var(--foreground))`
          // can in CSS. Scale still animates via Motion for the spring feel.
          animate={{ scale: isDragActive ? 1.01 : 1 }}
          transition={{ type: "spring", stiffness: 300, damping: 25 }}
          className={`flex min-h-36 flex-col items-center justify-center rounded-2xl border border-dashed px-6 py-8 text-center transition-colors duration-300 active:bg-foreground/5 ${
            isDragActive ? "border-foreground/90 bg-foreground/[0.08]" : "border-foreground/40 bg-transparent"
          }`}
        >
          <AnimatePresence mode="wait">
            {status.state === "extracting" ? (
              <motion.div
                key="extracting"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex w-full flex-col items-center gap-2"
              >
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                  className="h-6 w-6 rounded-full border border-border border-t-accent"
                />
                <p className="text-base text-muted-foreground">Reading {status.fileName}...</p>
                {/* A long book spends a minute in here. Naming the page it has
                    reached is the difference between waiting and wondering
                    whether the app has hung. */}
                {progress && (
                  <>
                    <p className="text-xs text-muted-foreground">{progress}</p>
                    <div className="h-1 w-40 overflow-hidden rounded-full bg-foreground/10">
                      <div
                        className="h-full bg-accent transition-all"
                        style={{ width: `${(status.pagesDone / status.totalPages) * 100}%` }}
                      />
                    </div>
                  </>
                )}
              </motion.div>
            ) : (
              <motion.div
                key="idle"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex flex-col items-center gap-2"
              >
                <span className="text-3xl">📄</span>
                <p className="text-base font-medium text-foreground">
                  {isDragActive ? "Drop your PDF here" : "Tap to upload a PDF"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {isDragActive ? "" : "or drag and drop - we'll pull the text out automatically"}
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </div>

      {status.state === "error" && (
        <motion.p
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-2 text-center text-sm text-muted-foreground"
        >
          {status.message}
        </motion.p>
      )}
    </div>
  );
}
