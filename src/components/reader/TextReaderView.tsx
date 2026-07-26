"use client";

import { useEffect, useRef, useState } from "react";
import { getBookFile, getBookMeta, updateReadingPosition } from "@/lib/readerStorage";
import { useNativeSelection } from "./useNativeSelection";
import DefinitionPopover from "./DefinitionPopover";
import ReaderChrome, { ReaderErrorState } from "./ReaderChrome";
import FontSizeStepper from "./FontSizeStepper";

type LoadState = "loading" | "ready" | "error";

// Debounces IndexedDB writes while scrolling - persisting on every scroll
// tick would mean a write per animation frame during a fast flick.
const SCROLL_PERSIST_DELAY_MS = 400;

function parseScrollFraction(raw: string | null | undefined): number {
  const value = raw ? Number(raw) : NaN;
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

export default function TextReaderView({ bookId, onExit }: { bookId: string; onExit: () => void }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const hasRestoredScroll = useRef(false);
  const scrollPersistTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [errorMessage, setErrorMessage] = useState("");
  const [title, setTitle] = useState("");
  const [paragraphs, setParagraphs] = useState<string[]>([]);
  const [progress, setProgress] = useState(0);
  const [fontPercent, setFontPercent] = useState(112);
  const savedFractionRef = useRef(0);

  const { selection, clear: clearSelection } = useNativeSelection(scrollRef);

  useEffect(() => {
    let cancelled = false;

    async function setup() {
      const [file, meta] = await Promise.all([getBookFile(bookId), getBookMeta(bookId)]);
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
        savedFractionRef.current = parseScrollFraction(meta?.lastPosition);
        setProgress(savedFractionRef.current);
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

  // Restore the saved scroll fraction exactly once, after the content has
  // actually rendered (scrollHeight is only meaningful post-layout).
  useEffect(() => {
    if (loadState !== "ready" || hasRestoredScroll.current) return;
    const el = scrollRef.current;
    if (!el) return;
    hasRestoredScroll.current = true;
    el.scrollTop = savedFractionRef.current * (el.scrollHeight - el.clientHeight);
  }, [loadState]);

  function handleScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const maxScroll = el.scrollHeight - el.clientHeight;
    const fraction = maxScroll > 0 ? Math.min(1, Math.max(0, el.scrollTop / maxScroll)) : 0;
    setProgress(fraction);

    clearTimeout(scrollPersistTimeout.current);
    scrollPersistTimeout.current = setTimeout(() => {
      void updateReadingPosition(bookId, String(fraction), fraction);
    }, SCROLL_PERSIST_DELAY_MS);
  }

  useEffect(() => {
    return () => clearTimeout(scrollPersistTimeout.current);
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (selection) clearSelection();
        else onExit();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selection, clearSelection, onExit]);

  if (loadState === "error") {
    return <ReaderErrorState message={errorMessage} onExit={onExit} />;
  }

  return (
    <ReaderChrome
      onExit={onExit}
      title={title}
      progress={progress}
      loading={loadState === "loading"}
      controls={<FontSizeStepper percent={fontPercent} onChange={setFontPercent} />}
    >
      <div ref={scrollRef} onScroll={handleScroll} className="h-full w-full overflow-y-auto px-6 py-10 sm:px-10">
        <div
          className="mx-auto max-w-2xl text-zinc-200"
          style={{
            fontFamily: "Georgia, Cambria, 'Times New Roman', serif",
            fontSize: `${fontPercent}%`,
            lineHeight: 1.75,
          }}
        >
          {paragraphs.map((paragraph, i) => (
            <p key={i} className="mb-[1.1em] whitespace-pre-wrap last:mb-0">
              {paragraph}
            </p>
          ))}
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
