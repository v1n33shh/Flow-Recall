"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
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
import {
  FONT_FAMILY_CSS,
  getReaderPreferences,
  setReaderPreferences,
  type FontFamilyId,
} from "@/lib/readerPreferences";

type LoadState = "loading" | "ready" | "error";

// Debounces IndexedDB writes while scrolling - persisting on every scroll
// tick would mean a write per animation frame during a fast flick.
const SCROLL_PERSIST_DELAY_MS = 400;

const PARAGRAPH_INDEX_ATTR = "data-paragraph-index";

function parseScrollFraction(raw: string | null | undefined): number {
  const value = raw ? Number(raw) : NaN;
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

type TextHighlightPosition = { paragraphIndex: number; start: number; end: number };

function parseTextHighlightPosition(raw: string): TextHighlightPosition | null {
  try {
    const parsed = JSON.parse(raw);
    if (
      typeof parsed.paragraphIndex === "number" &&
      typeof parsed.start === "number" &&
      typeof parsed.end === "number"
    ) {
      return parsed;
    }
  } catch {
    // A highlight saved by some future/incompatible format just doesn't render.
  }
  return null;
}

/** Sums text-node lengths within a single paragraph element up to (node,
 * offset) - the paragraph's DOM content is always exactly paragraphs[i]'s
 * characters (mark-wrapping a previous highlight only splits it across more
 * text nodes, never adds/removes characters), so this offset is stable and
 * comparable against previously-saved highlight offsets for the same paragraph. */
function getParagraphOffset(paragraphEl: Element, targetNode: Node, targetOffset: number): number {
  const walker = document.createTreeWalker(paragraphEl, NodeFilter.SHOW_TEXT);
  let offset = 0;
  let node: Node | null;
  while ((node = walker.nextNode())) {
    if (node === targetNode) return offset + targetOffset;
    offset += node.textContent?.length ?? 0;
  }
  return offset;
}

function closestParagraph(node: Node): HTMLElement | null {
  const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  return el?.closest<HTMLElement>(`[${PARAGRAPH_INDEX_ATTR}]`) ?? null;
}

/** Highlight positions are paragraph-scoped (see readerStorage.ts's
 * HighlightRecord doc comment) - a selection that spans a paragraph break is
 * clamped to its starting paragraph's own text rather than attempting a
 * global cross-paragraph offset scheme. */
function deriveTextPosition(range: Range): string {
  const startParagraph = closestParagraph(range.startContainer);
  if (!startParagraph) return "";

  const paragraphIndex = Number(startParagraph.getAttribute(PARAGRAPH_INDEX_ATTR));
  const start = getParagraphOffset(startParagraph, range.startContainer, range.startOffset);

  const endParagraph = closestParagraph(range.endContainer);
  const end =
    endParagraph === startParagraph
      ? getParagraphOffset(startParagraph, range.endContainer, range.endOffset)
      : startParagraph.textContent?.length ?? start;

  return JSON.stringify({ paragraphIndex, start, end } satisfies TextHighlightPosition);
}

/** Splits one paragraph's text around its saved highlights, wrapping each in
 * a clickable <mark> (underline styling, not a background fill - tapping it
 * is how a highlight gets removed, see handleHighlightTap). Ranges are
 * expected non-overlapping (each came from an independent user selection); a
 * defensive clamp keeps a malformed/overlapping range from producing a
 * negative-length slice rather than crashing the reader. */
function renderParagraphWithHighlights(
  text: string,
  entries: { record: HighlightRecord; position: TextHighlightPosition }[],
  onHighlightClick: (record: HighlightRecord, event: React.MouseEvent) => void,
): ReactNode[] {
  if (entries.length === 0) return [text];

  const sorted = [...entries].sort((a, b) => a.position.start - b.position.start);
  const nodes: ReactNode[] = [];
  let cursor = 0;

  sorted.forEach(({ record, position }, i) => {
    const start = Math.max(position.start, cursor);
    const end = Math.max(position.end, start);
    if (start > cursor) nodes.push(text.slice(cursor, start));
    if (end > start) {
      nodes.push(
        <mark
          key={i}
          onClick={(e) => onHighlightClick(record, e)}
          className="cursor-pointer border-b-[3px] border-accent bg-transparent text-inherit"
        >
          {text.slice(start, end)}
        </mark>,
      );
    }
    cursor = Math.max(cursor, end);
  });

  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}

export default function TextReaderView({ bookId, onExit }: { bookId: string; onExit: () => void }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const hasRestoredScroll = useRef(false);
  const scrollPersistTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [errorMessage, setErrorMessage] = useState("");
  const [title, setTitle] = useState("");
  const [paragraphs, setParagraphs] = useState<string[]>([]);
  const [highlights, setHighlights] = useState<HighlightRecord[]>([]);
  const [progress, setProgress] = useState(0);
  // Global, cross-book preference (see readerPreferences.ts) - initialized
  // once from localStorage so the very first render already reflects
  // whatever the reader last chose, rather than flashing the old 112%/serif
  // default and then snapping to it.
  const [fontPercent, setFontPercent] = useState(() => getReaderPreferences().fontPercent);
  const [fontFamily, setFontFamily] = useState<FontFamilyId>(() => getReaderPreferences().fontFamily);
  const [tappedHighlight, setTappedHighlight] = useState<{ record: HighlightRecord; anchor: SelectionAnchor } | null>(
    null,
  );
  const savedFractionRef = useRef(0);

  const { selection, clear: clearSelection } = useNativeSelection(scrollRef, deriveTextPosition);

  // A fresh new-selection popover and a tapped-existing-highlight popover are
  // mutually exclusive - derived at render time rather than synced via an
  // effect, since there's no invariant to enforce, just a value that depends
  // on two independently-set pieces of state.
  const activeTappedHighlight = selection ? null : tappedHighlight;

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
        setErrorMessage("This note is missing from your library - it may have been removed.");
        setLoadState("error");
        return;
      }

      try {
        const text = await file.text();
        if (cancelled) return;

        setTitle(meta?.title ?? "Untitled Notes");
        setParagraphs(text.split(/\n{2,}/).filter((p) => p.trim().length > 0));
        setHighlights(savedHighlights);
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

  // Mirrors useNativeSelection's own "clear on any fresh tap/click in the
  // container" listeners, but for tappedHighlight specifically - mousedown/
  // touchstart always fire before the <mark>'s own onClick for the same
  // physical gesture, so tapping a highlight still correctly ends up
  // clearing-then-setting in that order, not racing it.
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    const clear = () => setTappedHighlight(null);
    container.addEventListener("mousedown", clear);
    container.addEventListener("touchstart", clear);
    return () => {
      container.removeEventListener("mousedown", clear);
      container.removeEventListener("touchstart", clear);
    };
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
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
  }, [selection, tappedHighlight, clearSelection, onExit]);

  function closePopover() {
    clearSelection();
    setTappedHighlight(null);
  }

  function adjustFont(next: number) {
    setFontPercent(next);
    setReaderPreferences({ fontPercent: next });
  }

  function adjustFontFamily(next: FontFamilyId) {
    setFontFamily(next);
    setReaderPreferences({ fontFamily: next });
  }

  function handleHighlightTap(record: HighlightRecord, event: React.MouseEvent) {
    clearSelection();
    const rect = event.currentTarget.getBoundingClientRect();
    setTappedHighlight({ record, anchor: anchorFromRect(rect) });
  }

  async function handleHighlight() {
    if (!selection) return;
    const record = await addHighlight(bookId, selection.phrase, selection.rawPosition);
    // addHighlight is idempotent at the DB level (highlighting the same spot
    // twice returns the EXISTING record rather than inserting a duplicate),
    // but blindly appending here regardless would still duplicate it in this
    // local array - and renderParagraphWithHighlights renders one <mark> per
    // array entry.
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
    setTappedHighlight((prev) => (prev ? { ...prev, record: updated } : prev));
    setHighlights((prev) => prev.map((h) => (h.id === updated.id ? updated : h)));
  }

  if (loadState === "error") {
    return <ReaderErrorState message={errorMessage} onExit={onExit} />;
  }

  return (
    <ReaderChrome
      onExit={onExit}
      title={title}
      progress={progress}
      loading={loadState === "loading"}
      controls={
        <DisplaySettingsMenu
          typography={{
            fontPercent,
            onFontPercentChange: adjustFont,
            fontMin: 80,
            fontMax: 160,
            fontStep: 2,
            fontFamily,
            onFontFamilyChange: adjustFontFamily,
          }}
        />
      }
    >
      <div ref={scrollRef} onScroll={handleScroll} className="h-full w-full overflow-y-auto px-6 py-10 sm:px-10">
        <div
          className="reader-longpress-text mx-auto max-w-2xl text-zinc-200"
          style={{
            fontFamily: FONT_FAMILY_CSS[fontFamily],
            fontSize: `${fontPercent}%`,
            lineHeight: 1.75,
          }}
        >
          {paragraphs.map((paragraph, i) => {
            const entries = highlights
              .map((record) => {
                const position = parseTextHighlightPosition(record.position);
                return position && position.paragraphIndex === i ? { record, position } : null;
              })
              .filter((e): e is { record: HighlightRecord; position: TextHighlightPosition } => e !== null);
            return (
              <p key={i} data-paragraph-index={i} className="mb-[1.1em] whitespace-pre-wrap last:mb-0">
                {renderParagraphWithHighlights(paragraph, entries, handleHighlightTap)}
              </p>
            );
          })}
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
