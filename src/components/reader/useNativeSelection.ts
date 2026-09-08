import { useCallback, useEffect, useRef, useState } from "react";
import {
  captureSelectionFromRange,
  isCoarsePointer,
  type DerivePosition,
  type PendingSelection,
} from "./selection";

// Matches epub.js's own internal selectionchange debounce (see Contents#onSelectionChange
// in epubjs/src/contents.js) so the interaction feels identical whether the
// selection came from an EPUB's iframe or a plain DOM view (PDF text layer,
// raw text).
const SELECTION_DEBOUNCE_MS = 250;

/** Shared selection-to-popover wiring for reader views that render into the
 * main document (PDF text, raw text) rather than epub.js's sandboxed iframes.
 * Takes the reading container as an ELEMENT rather than a ref so the listeners
 * re-attach on the render where it first exists (both views hand it over via
 * TextReaderCore's imperative getScrollContainer()). Selections outside it are
 * ignored, so dragging across the chrome never opens a definition popover.
 *
 * `derivePosition` computes the opaque, type-dependent position string a
 * selection would be saved under if the user hits "Highlight" - PdfReaderView
 * and TextReaderView each supply their own, so this hook stays agnostic.
 *
 * Native drag-to-select is used on both desktop and touch; the popover is
 * driven from a debounced `selectionchange` listener. */
export function useNativeSelection(containerEl: HTMLElement | null, derivePosition: DerivePosition) {
  const [selection, setSelection] = useState<PendingSelection | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const clearSelection = useCallback(() => {
    setSelection(null);
    // Only desktop has a real browser selection to drop - on touch there is
    // never one to begin with, and calling into Selection there would just
    // churn selectionchange events for nothing.
    if (!isCoarsePointer() && typeof window !== "undefined") {
      window.getSelection()?.removeAllRanges();
    }
  }, []);

  // Drag-to-select, debounced so the popover appears once the drag settles
  // rather than flickering on every intermediate range.
  useEffect(() => {
    if (!containerEl) return;

    function handleSelectionChange() {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => {
        const domSelection = window.getSelection();
        if (!domSelection || domSelection.rangeCount === 0 || domSelection.isCollapsed) return;

        const range = domSelection.getRangeAt(0);
        if (!containerEl?.contains(range.commonAncestorContainer)) return;

        const captured = captureSelectionFromRange(range, false, derivePosition);
        if (captured) setSelection(captured);
      }, SELECTION_DEBOUNCE_MS);
    }

    document.addEventListener("selectionchange", handleSelectionChange);
    return () => {
      clearTimeout(timeoutRef.current);
      document.removeEventListener("selectionchange", handleSelectionChange);
    };
  }, [containerEl, derivePosition]);

  // Desktop: a fresh mousedown in the reading area dismisses whatever popover
  // is open. Touch deliberately gets no container-level equivalent -
  // DefinitionPopover's bottom sheet owns dismissal through its own
  // full-screen scrim, whereas a click/touchstart listener here would race the
  // synthetic click that mobile browsers replay right after the touchend
  // ending a long-press, and self-dismiss the sheet it just opened.
  useEffect(() => {
    if (!containerEl || isCoarsePointer()) return;
    containerEl.addEventListener("mousedown", clearSelection);
    return () => containerEl.removeEventListener("mousedown", clearSelection);
  }, [containerEl, clearSelection]);

  return { selection, clearSelection };
}
