"use client";

import { useState } from "react";
import { useDropzone, type FileRejection } from "react-dropzone";
import { motion, AnimatePresence } from "motion/react";

type Status =
  | { state: "idle" }
  | { state: "extracting"; fileName: string }
  | { state: "error"; message: string };

type PdfDropzoneProps = {
  onExtracted: (text: string, fileName: string) => void;
};

async function extractPdfText(file: File): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

  const buffer = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: buffer }).promise;

  const pageTexts: string[] = [];
  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
    const page = await doc.getPage(pageNumber);
    const content = await page.getTextContent();
    const pageText = content.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ");
    pageTexts.push(pageText);
  }

  return pageTexts.join("\n\n").trim();
}

export default function PdfDropzone({ onExtracted }: PdfDropzoneProps) {
  const [status, setStatus] = useState<Status>({ state: "idle" });

  async function handleDrop(acceptedFiles: File[], fileRejections: FileRejection[]) {
    if (fileRejections.length > 0) {
      setStatus({ state: "error", message: "Only PDF files are supported." });
      return;
    }

    const file = acceptedFiles[0];
    if (!file) return;

    setStatus({ state: "extracting", fileName: file.name });

    try {
      const text = await extractPdfText(file);
      if (text.length === 0) {
        setStatus({
          state: "error",
          message: "Couldn't find any text in that PDF - it may be scanned images rather than real text.",
        });
        return;
      }
      setStatus({ state: "idle" });
      onExtracted(text, file.name);
    } catch (err) {
      setStatus({
        state: "error",
        message: err instanceof Error ? err.message : "Failed to read that PDF.",
      });
    }
  }

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: handleDrop,
    accept: { "application/pdf": [".pdf"] },
    multiple: false,
    disabled: status.state === "extracting",
  });

  return (
    <div className="w-full">
      <div {...getRootProps()} className="cursor-pointer">
        <input {...getInputProps()} />

        <motion.div
          animate={{
            borderColor: isDragActive ? "rgba(212,175,55,0.9)" : "rgba(212,175,55,0.4)",
            backgroundColor: isDragActive ? "rgba(212,175,55,0.08)" : "rgba(212,175,55,0)",
            scale: isDragActive ? 1.01 : 1,
          }}
          transition={{ type: "spring", stiffness: 300, damping: 25 }}
          className="flex min-h-36 flex-col items-center justify-center rounded-2xl border border-dashed px-6 py-8 text-center active:bg-white/5"
        >
          <AnimatePresence mode="wait">
            {status.state === "extracting" ? (
              <motion.div
                key="extracting"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex flex-col items-center gap-2"
              >
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                  className="h-6 w-6 rounded-full border border-white/15 border-t-gold"
                />
                <p className="text-base text-zinc-400">Extracting text from {status.fileName}...</p>
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
                <p className="text-base font-medium text-zinc-300">
                  {isDragActive ? "Drop your PDF here" : "Tap to upload a PDF"}
                </p>
                <p className="text-xs text-zinc-400">
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
          className="mt-2 text-center text-sm text-zinc-400"
        >
          {status.message}
        </motion.p>
      )}
    </div>
  );
}
