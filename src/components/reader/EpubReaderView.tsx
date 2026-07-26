"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type Book from "epubjs/types/book";
import type Rendition from "epubjs/types/rendition";
import type Contents from "epubjs/types/contents";
import type { NavItem } from "epubjs/types/navigation";
import {
  addHighlight,
  deleteHighlight,
  getBookFile,
  getBookMeta,
  listHighlights,
  updateReadingPosition,
} from "@/lib/readerStorage";
import type { HighlightRecord } from "@/lib/types";
import {
  anchorFromRect,
  getBlockContext,
  handleSelectionTouchEnd,
  isCoarsePointer,
  type PendingSelection,
  type SelectionAnchor,
} from "./selection";
import DefinitionPopover from "./DefinitionPopover";
import ReaderChrome, { ReaderErrorState } from "./ReaderChrome";
import FontSizeStepper from "./FontSizeStepper";
import SelectionHighlight from "./SelectionHighlight";

type LoadState = "loading" | "ready" | "error";

// Rendered as an "underline" annotation (marks-pane draws an invisible
// fill:none hit-box rect plus a visible <line>), not "highlight" (a filled
// rect) - the bold Electric Azure underline the reader wants instead of a
// background block. marks-pane hardcodes the <line>'s stroke/stroke-width
// and ignores `styles` for that child element entirely, so the actual color
// comes from a CSS override in globals.css targeting our own ref-scoped
// selector; `mix-blend-mode: normal` here still matters though - it applies
// to the whole annotation group, overriding marks-pane's default "multiply"
// (designed for light backgrounds; on our near-black background it crushes
// toward black instead of showing Electric Azure).
const EPUB_HIGHLIGHT_STYLES = { "mix-blend-mode": "normal" };
const EPUB_HIGHLIGHT_CLASS = "flowrecall-highlight";

type PopoverState =
  | { kind: "selection"; data: PendingSelection }
  | { kind: "highlight"; record: HighlightRecord; anchor: SelectionAnchor };

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
  // Guards against a genuine race: loading saved highlights on mount and the
  // user creating a new one via handleHighlight are two independent async
  // paths that can BOTH resolve for the same record (e.g. the user
  // highlights something before the mount-time listHighlights() read
  // finishes) - epub.js's annotations API has no "already exists" check of
  // its own, so calling .underline() twice for the same record renders it twice.
  const appliedHighlightIds = useRef(new Set<string>());

  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [errorMessage, setErrorMessage] = useState("");
  const [progress, setProgress] = useState(0);
  const [chapterTitle, setChapterTitle] = useState("");
  const [fontPercent, setFontPercent] = useState(112);
  const [popover, setPopover] = useState<PopoverState | null>(null);

  const clearPopover = useCallback(() => setPopover(null), []);

  // Tapping an EXISTING highlight's own rendered mark - epub.js attaches this
  // directly to the mark's SVG element (click + touchstart), so it's a
  // completely separate path from "capture a new selection" below: no
  // window.getSelection() involved at all, hence no OS-menu risk to worry
  // about, and no geometric hit-testing needed either - the mark IS the hit target.
  function makeHighlightClickHandler(record: HighlightRecord) {
    return (event: Event) => {
      const target = event.currentTarget as HTMLElement | null;
      const rect = target?.getBoundingClientRect();
      setPopover({
        kind: "highlight",
        record,
        anchor: rect ? anchorFromRect(rect) : { x: 0, y: 0, placement: "below" },
      });
    };
  }

  function applyUnderline(rendition: Rendition, record: HighlightRecord) {
    if (appliedHighlightIds.current.has(record.id)) return;
    appliedHighlightIds.current.add(record.id);
    rendition.annotations.underline(
      record.position,
      {},
      makeHighlightClickHandler(record),
      EPUB_HIGHLIGHT_CLASS,
      EPUB_HIGHLIGHT_STYLES,
    );
  }

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
          // Touch devices use the synchronous touchend path below instead -
          // epub.js's own "selected" event is itself debounced (see epubjs/
          // src/contents.js), which on mobile would fire too late to collapse
          // the selection before the OS's native callout menu paints.
          if (isCoarsePointer()) return;

          const domSelection = contents.window.getSelection();
          if (!domSelection || domSelection.rangeCount === 0 || domSelection.isCollapsed) return;

          const range = domSelection.getRangeAt(0);
          const rect = range.getBoundingClientRect();
          const frameEl = contents.window.frameElement as HTMLElement | null;
          const frameRect = frameEl?.getBoundingClientRect();

          const phrase = (await book.getRange(cfiRange)).toString().trim();
          if (!phrase) return;

          setPopover({
            kind: "selection",
            data: {
              phrase,
              context: getBlockContext(range),
              anchor: anchorFromRect(rect, frameRect?.left ?? 0, frameRect?.top ?? 0),
              // epub.js already computed this CFI range for us to reach this
              // handler at all - no need to re-derive it from the Range.
              rawPosition: cfiRange,
            },
          });
        });

        // A tap/click starting fresh anywhere in the chapter (that isn't
        // itself the start of a new selection) dismisses whatever popover is
        // already open - epub.js has no "unselected" event of its own.
        rendition.on("rendered", (_section: unknown, contents: Contents) => {
          contents.document.addEventListener("touchstart", clearPopover);
          // Desktop only - browsers replay a SYNTHETIC "mousedown" right
          // after a real touchend (for legacy mouse-oriented code), which
          // would otherwise immediately wipe out the selection touchend's
          // handler below just captured, a moment before it ever renders.
          // touchstart above already covers "clear on new touch interaction".
          if (!isCoarsePointer()) {
            contents.document.addEventListener("mousedown", clearPopover);
          }

          // Mobile: react on touchend itself, synchronously, so a drag-
          // selection's OS callout menu ("Copy | Look Up | Share...") never
          // gets a chance to paint - see selection.ts's handleSelectionTouchEnd
          // for the full rationale. Each chapter gets its own iframe/document,
          // so this has to be wired per-render rather than once.
          if (isCoarsePointer()) {
            contents.document.addEventListener("touchend", (e: TouchEvent) => {
              const frameEl = contents.window.frameElement as HTMLElement | null;
              const frameRect = frameEl?.getBoundingClientRect();
              const captured = handleSelectionTouchEnd({
                event: e,
                win: contents.window,
                doc: contents.document,
                container: contents.document.body,
                // The "rendered"/"selected" callback param is typed as
                // Contents but is actually an IframeView at runtime - it
                // duplicates .window/.document directly (why those calls
                // above work), but cfiFromRange only lives on its nested
                // real Contents instance, which epub.js's own types don't
                // model (its .d.ts assumes the param really is Contents).
                derivePosition: (range) =>
                  (contents as unknown as { contents: Contents }).contents.cfiFromRange(range),
                offsetLeft: frameRect?.left ?? 0,
                offsetTop: frameRect?.top ?? 0,
              });
              if (captured) setPopover({ kind: "selection", data: captured });
            });
          }
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

        // rendition.annotations.underline() only paints for the CURRENT
        // rendition instance - it doesn't persist anything on its own, and
        // has to be re-applied once per fresh Book/Rendition (i.e. every
        // time the book is reopened). Once applied, epub.js's Annotations
        // manager keeps it visible as the user navigates within this session.
        listHighlights(bookId).then((records) => {
          if (cancelled) return;
          for (const record of records) applyUnderline(rendition, record);
        });

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
  }, [bookId, clearPopover]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "ArrowRight") renditionRef.current?.next();
      if (e.key === "ArrowLeft") renditionRef.current?.prev();
      if (e.key === "Escape") {
        if (popover) clearPopover();
        else onExit();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [popover, clearPopover, onExit]);

  function adjustFont(next: number) {
    setFontPercent(next);
    renditionRef.current?.themes.fontSize(`${next}%`);
  }

  async function handleHighlight() {
    if (popover?.kind !== "selection") return;
    const record = await addHighlight(bookId, popover.data.phrase, popover.data.rawPosition);
    if (renditionRef.current) applyUnderline(renditionRef.current, record);
  }

  async function handleRemoveHighlight() {
    if (popover?.kind !== "highlight") return;
    await deleteHighlight(popover.record.id);
    renditionRef.current?.annotations.remove(popover.record.position, "underline");
    appliedHighlightIds.current.delete(popover.record.id);
  }

  if (loadState === "error") {
    return <ReaderErrorState message={errorMessage} onExit={onExit} />;
  }

  const popoverProps =
    popover?.kind === "selection"
      ? { phrase: popover.data.phrase, context: popover.data.context, anchor: popover.data.anchor }
      : popover?.kind === "highlight"
        ? { phrase: popover.record.phrase, context: popover.record.phrase, anchor: popover.anchor }
        : null;

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

      {popover?.kind === "selection" && popover.data.rects && <SelectionHighlight rects={popover.data.rects} />}
      {popoverProps && (
        <DefinitionPopover
          phrase={popoverProps.phrase}
          context={popoverProps.context}
          anchor={popoverProps.anchor}
          onClose={clearPopover}
          onHighlight={handleHighlight}
          onRemoveHighlight={handleRemoveHighlight}
          isHighlighted={popover?.kind === "highlight"}
        />
      )}
    </ReaderChrome>
  );
}
