"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type Book from "epubjs/types/book";
import type Rendition from "epubjs/types/rendition";
import type Contents from "epubjs/types/contents";
import type { NavItem } from "epubjs/types/navigation";
import { getBookFile, getBookMeta, updateReadingPosition } from "@/lib/readerStorage";
import { anchorFromRect, getBlockContext, type PendingSelection } from "./selection";
import DefinitionPopover from "./DefinitionPopover";
import ReaderChrome, { ReaderErrorState } from "./ReaderChrome";
import FontSizeStepper from "./FontSizeStepper";

type LoadState = "loading" | "ready" | "error";

function flattenToc(items: NavItem[]): NavItem[] {
  return items.flatMap((item) => [item, ...(item.subitems ? flattenToc(item.subitems) : [])]);
}

function registerObsidianTheme(rendition: Rendition) {
  // Matches the app's "Obsidian Monochrome + Electric Azure" tokens, but
  // swaps to a serif reading face - established typography practice for
  // long-form body text, and distinct enough from the UI chrome's Geist Sans
  // that "reading mode" reads as its own deliberate surface, not a bug.
  rendition.themes.register("obsidian", {
    body: {
      background: "#050505 !important",
      color: "#e4e4e7 !important",
      "font-family": "Georgia, Cambria, 'Times New Roman', serif !important",
      "line-height": "1.75 !important",
    },
    p: { "margin-bottom": "1.1em !important" },
    a: { color: "#3B82F6 !important" },
    "::selection": { background: "rgba(59,130,246,0.35)" },
  });
  rendition.themes.select("obsidian");
}

export default function EpubReaderView({ bookId, onExit }: { bookId: string; onExit: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const bookRef = useRef<Book | null>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const tocRef = useRef<NavItem[]>([]);

  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [errorMessage, setErrorMessage] = useState("");
  const [progress, setProgress] = useState(0);
  const [chapterTitle, setChapterTitle] = useState("");
  const [fontPercent, setFontPercent] = useState(112);
  const [selection, setSelection] = useState<PendingSelection | null>(null);

  const clearSelection = useCallback(() => setSelection(null), []);

  useEffect(() => {
    let cancelled = false;

    async function setup() {
      const [file, meta] = await Promise.all([getBookFile(bookId), getBookMeta(bookId)]);
      if (cancelled) return;
      if (!file || !containerRef.current) {
        setErrorMessage("This book is missing from your library - it may have been removed.");
        setLoadState("error");
        return;
      }

      try {
        const ePub = (await import("epubjs")).default;
        const buffer = await file.arrayBuffer();
        if (cancelled) return;

        const book = ePub(buffer);
        bookRef.current = book;

        const rendition = book.renderTo(containerRef.current, {
          width: "100%",
          height: "100%",
          flow: "paginated",
          spread: "none",
          allowScriptedContent: false,
        });
        renditionRef.current = rendition;

        registerObsidianTheme(rendition);
        rendition.themes.fontSize(`${fontPercent}%`);

        rendition.on("relocated", (location: { start: { cfi: string; percentage: number; href: string } }) => {
          setProgress(location.start.percentage);
          void updateReadingPosition(bookId, location.start.cfi, location.start.percentage);

          const match = tocRef.current.find((item) => item.href.split("#")[0] === location.start.href.split("#")[0]);
          if (match) setChapterTitle(match.label.trim());
        });

        rendition.on("selected", async (cfiRange: string, contents: Contents) => {
          const domSelection = contents.window.getSelection();
          if (!domSelection || domSelection.rangeCount === 0 || domSelection.isCollapsed) return;

          const range = domSelection.getRangeAt(0);
          const rect = range.getBoundingClientRect();
          const frameEl = contents.window.frameElement as HTMLElement | null;
          const frameRect = frameEl?.getBoundingClientRect();

          const phrase = (await book.getRange(cfiRange)).toString().trim();
          if (!phrase) return;

          setSelection({
            phrase,
            context: getBlockContext(range),
            anchor: anchorFromRect(rect, frameRect?.left ?? 0, frameRect?.top ?? 0),
          });
        });

        // A tap/click starting fresh anywhere in the chapter (that isn't
        // itself the start of a new selection) dismisses whatever popover is
        // already open - epub.js has no "unselected" event of its own.
        rendition.on("rendered", (_section: unknown, contents: Contents) => {
          contents.document.addEventListener("mousedown", clearSelection);
          contents.document.addEventListener("touchstart", clearSelection);
        });

        await rendition.display(meta?.lastPosition ?? undefined);
        await book.ready;
        if (cancelled) return;

        const navigation = await book.loaded.navigation;
        tocRef.current = flattenToc(navigation.toc);
        const current = rendition.currentLocation() as unknown as { start: { href: string } } | undefined;
        if (current?.start?.href) {
          const match = tocRef.current.find((item) => item.href.split("#")[0] === current.start.href.split("#")[0]);
          if (match) setChapterTitle(match.label.trim());
        }

        setLoadState("ready");

        // book.locations.percentageFromLocation() (which "relocated" reads
        // via location.start.percentage) is hard-coded to 0 until locations
        // have been generated at least once - generate them in the
        // background so the very first page isn't blocked on it, then
        // backfill the progress bar for wherever the reader already landed.
        book.locations.generate(1600).then(() => {
          if (cancelled) return;
          const location = rendition.currentLocation() as unknown as { start: { percentage: number } } | undefined;
          if (location) setProgress(location.start.percentage);
        });
      } catch (err) {
        console.error("Failed to open EPUB", err);
        if (!cancelled) {
          setErrorMessage("Couldn't open that book - the file may be corrupted.");
          setLoadState("error");
        }
      }
    }

    setup();

    return () => {
      cancelled = true;
      try {
        renditionRef.current?.destroy();
        bookRef.current?.destroy();
      } catch {
        // Best-effort teardown - nothing user-facing depends on it succeeding.
      }
      renditionRef.current = null;
      bookRef.current = null;
    };
    // Only ever re-run for a genuinely different book.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId, clearSelection]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "ArrowRight") renditionRef.current?.next();
      if (e.key === "ArrowLeft") renditionRef.current?.prev();
      if (e.key === "Escape") {
        if (selection) clearSelection();
        else onExit();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selection, clearSelection, onExit]);

  function adjustFont(next: number) {
    setFontPercent(next);
    renditionRef.current?.themes.fontSize(`${next}%`);
  }

  if (loadState === "error") {
    return <ReaderErrorState message={errorMessage} onExit={onExit} />;
  }

  return (
    <ReaderChrome
      onExit={onExit}
      title={chapterTitle}
      progress={progress}
      loading={loadState === "loading"}
      controls={<FontSizeStepper percent={fontPercent} onChange={adjustFont} />}
    >
      {/* Tap zones for page turns - narrow edge bands so the wide center
          column is left completely free for native text selection. */}
      <button
        type="button"
        aria-label="Previous page"
        onClick={() => renditionRef.current?.prev()}
        className="absolute inset-y-0 left-0 z-10 w-[15%] cursor-w-resize"
      />
      <button
        type="button"
        aria-label="Next page"
        onClick={() => renditionRef.current?.next()}
        className="absolute inset-y-0 right-0 z-10 w-[15%] cursor-e-resize"
      />

      <div ref={containerRef} className="h-full w-full px-2" />

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
