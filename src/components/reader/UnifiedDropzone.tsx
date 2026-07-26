"use client";

import { useState } from "react";
import { useDropzone, type FileRejection } from "react-dropzone";
import { motion, AnimatePresence } from "motion/react";
import { addBook, addPdf } from "@/lib/readerStorage";
import type { BookMeta } from "@/lib/types";

type Status =
  | { state: "idle" }
  | { state: "importing"; fileName: string }
  | { state: "error"; message: string };

export default function UnifiedDropzone({ onImported }: { onImported: (book: BookMeta) => void }) {
  const [status, setStatus] = useState<Status>({ state: "idle" });

  async function handleDrop(acceptedFiles: File[], fileRejections: FileRejection[]) {
    if (fileRejections.length > 0) {
      setStatus({ state: "error", message: "Only EPUB and PDF files are supported." });
      return;
    }

    const file = acceptedFiles[0];
    if (!file) return;

    setStatus({ state: "importing", fileName: file.name });
    try {
      const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
      const book = isPdf ? await addPdf(file) : await addBook(file);
      setStatus({ state: "idle" });
      onImported(book);
    } catch (err) {
      setStatus({
        state: "error",
        message: err instanceof Error ? err.message : "That didn't look like a valid EPUB or PDF.",
      });
    }
  }

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: handleDrop,
    accept: {
      "application/epub+zip": [".epub"],
      "application/pdf": [".pdf"],
    },
    multiple: false,
    disabled: status.state === "importing",
  });

  return (
    <div className="w-full">
      <div {...getRootProps()} className="cursor-pointer">
        <input {...getInputProps()} />
        <motion.div
          animate={{
            borderColor: isDragActive ? "rgba(59,130,246,0.9)" : "rgba(59,130,246,0.4)",
            backgroundColor: isDragActive ? "rgba(59,130,246,0.08)" : "rgba(59,130,246,0)",
            scale: isDragActive ? 1.01 : 1,
          }}
          transition={{ type: "spring", stiffness: 300, damping: 25 }}
          className="flex min-h-36 flex-col items-center justify-center rounded-2xl border border-dashed px-6 py-8 text-center active:bg-white/5"
        >
          <AnimatePresence mode="wait">
            {status.state === "importing" ? (
              <motion.div
                key="importing"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex flex-col items-center gap-2"
              >
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                  className="h-6 w-6 rounded-full border border-white/15 border-t-accent"
                />
                <p className="text-base text-zinc-400">Adding {status.fileName} to your library...</p>
              </motion.div>
            ) : (
              <motion.div
                key="idle"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex flex-col items-center gap-2"
              >
                <span className="text-3xl">📚</span>
                <p className="text-base font-medium text-zinc-300">
                  {isDragActive ? "Drop it here" : "Tap to upload an EPUB or PDF"}
                </p>
                <p className="text-xs text-zinc-400">
                  {isDragActive ? "" : "or drag and drop - stays on this device"}
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
