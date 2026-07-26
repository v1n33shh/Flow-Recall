import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { anchorFromRect, getBlockContext, type PendingSelection } from "./selection";

// Matches epub.js's own internal selectionchange debounce (see Contents#onSelectionChange
// in epubjs/src/contents.js) so the interaction feels identical whether the
// selection came from an EPUB's iframe or a plain DOM view (PDF text layer,
// raw text).
const SELECTION_DEBOUNCE_MS = 250;

/** Shared selection-to-popover wiring for reader views that render into the
 * main document (PDF's text layer, raw text) rather than epub.js's sandboxed
 * iframes. Ignores selections outside `containerRef` so highlighting the
 * chrome (title, buttons) never triggers a definition popover. */
export function useNativeSelection(containerRef: RefObject<HTMLElement | null>) {
  const [selection, setSelection] = useState<PendingSelection | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const clear = useCallback(() => setSelection(null), []);

  useEffect(() => {
    function handleSelectionChange() {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => {
        const container = containerRef.current;
        const domSelection = window.getSelection();
        if (!container || !domSelection || domSelection.rangeCount === 0 || domSelection.isCollapsed) return;

        const range = domSelection.getRangeAt(0);
        if (!container.contains(range.commonAncestorContainer)) return;

        const phrase = domSelection.toString().trim();
        if (!phrase) return;

        setSelection({
          phrase,
          context: getBlockContext(range),
          anchor: anchorFromRect(range.getBoundingClientRect()),
        });
      }, SELECTION_DEBOUNCE_MS);
    }

    document.addEventListener("selectionchange", handleSelectionChange);
    return () => {
      clearTimeout(timeoutRef.current);
      document.removeEventListener("selectionchange", handleSelectionChange);
    };
  }, [containerRef]);

  // A fresh tap/click starting inside the reading container dismisses
  // whatever popover is already open - mirrors epub.js's contents-mousedown
  // handling in EpubReaderView, so both feel identical.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    container.addEventListener("mousedown", clear);
    container.addEventListener("touchstart", clear);
    return () => {
      container.removeEventListener("mousedown", clear);
      container.removeEventListener("touchstart", clear);
    };
  }, [containerRef, clear]);

  return { selection, clear };
}
