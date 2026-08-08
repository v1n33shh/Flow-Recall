import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import {
  attachLongPressToDefine,
  captureSelectionFromRange,
  isCoarsePointer,
  type DerivePosition,
  type PendingSelection,
} from "./selection";

// Matches epub.js's own internal selectionchange debounce (see Contents#onSelectionChange
// in epubjs/src/contents.js) so the desktop interaction feels identical
// whether the selection came from an EPUB's iframe or a plain DOM view (PDF
// text layer, raw text). Touch devices don't use this path at all - see below.
const SELECTION_DEBOUNCE_MS = 250;

/** Shared selection-to-popover wiring for reader views that render into the
 * main document (PDF's text layer, raw text) rather than epub.js's sandboxed
 * iframes. Ignores selections outside `containerRef` so highlighting the
 * chrome (title, buttons) never triggers a definition popover.
 *
 * `derivePosition` computes the opaque, type-dependent position string a
 * selection would be saved under if the user hits "Highlight" - PdfReaderView
 * and TextReaderView each supply their own (page-fraction rects vs. paragraph
 * offsets), so this hook stays agnostic of either.
 *
 * Desktop and touch get genuinely different interaction models here - see
 * selection.ts's attachLongPressToDefine doc comment for why touch can't
 * just reuse the debounced selectionchange path: native selection (and the
 * OS callout menu tied to it) is disabled entirely on touch via CSS, so a
 * long-press has to resolve the word directly from the pointer's
 * coordinates instead of ever reading a browser Selection. */
export function useNativeSelection(containerRef: RefObject<HTMLElement | null>, derivePosition: DerivePosition) {
  const [selection, setSelection] = useState<PendingSelection | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const clear = useCallback(() => setSelection(null), []);

  useEffect(() => {
    if (isCoarsePointer()) return;

    function handleSelectionChange() {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => {
        const container = containerRef.current;
        const domSelection = window.getSelection();
        if (!container || !domSelection || domSelection.rangeCount === 0 || domSelection.isCollapsed) return;

        const range = domSelection.getRangeAt(0);
        if (!container.contains(range.commonAncestorContainer)) return;

        const captured = captureSelectionFromRange(range, false, derivePosition);
        if (captured) setSelection(captured);
      }, SELECTION_DEBOUNCE_MS);
    }

    document.addEventListener("selectionchange", handleSelectionChange);
    return () => {
      clearTimeout(timeoutRef.current);
      document.removeEventListener("selectionchange", handleSelectionChange);
    };
  }, [containerRef, derivePosition]);

  useEffect(() => {
    if (!isCoarsePointer()) return;
    const container = containerRef.current;
    if (!container) return;

    return attachLongPressToDefine({
      target: container,
      doc: document,
      derivePosition,
      onLongPress: setSelection,
    });
  }, [containerRef, derivePosition]);

  // A fresh tap/click starting inside the reading container dismisses
  // whatever popover is already open - mirrors epub.js's contents-mousedown
  // handling in EpubReaderView, so both feel identical. Desktop only for
  // mousedown: browsers replay it as a SYNTHETIC compatibility event right
  // after a real touchend, which would otherwise immediately wipe out the
  // selection the touchend handler above just captured. touchstart alone
  // already covers "clear on new touch interaction" correctly.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    if (!isCoarsePointer()) container.addEventListener("mousedown", clear);
    container.addEventListener("touchstart", clear);
    return () => {
      if (!isCoarsePointer()) container.removeEventListener("mousedown", clear);
      container.removeEventListener("touchstart", clear);
    };
  }, [containerRef, clear]);

  return { selection, clear };
}
