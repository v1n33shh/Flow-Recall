import { useCallback, useEffect, useRef, useState } from "react";
import {
  captureSelectionFromRange,
  isCoarsePointer,
  type DerivePosition,
  type PendingSelection,
} from "./selection";

// Matches epub.js's own internal selectionchange debounce (see Contents#onSelectionChange
// in epubjs/src/contents.js) so the desktop interaction feels identical
// whether the selection came from an EPUB's iframe or a plain DOM view (PDF
// text layer, raw text). 
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
 */
export function useNativeSelection(containerEl: HTMLElement | null, derivePosition: DerivePosition) {
  const [selection, setSelection] = useState<PendingSelection | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const clearSelection = useCallback(() => {
    setSelection(null);
    if (typeof window !== "undefined") {
      window.getSelection()?.removeAllRanges();
    }
  }, []);

  // Dynamic debounce:
  // Desktop: 250ms (fast, standard).
  // Mobile: 800ms (gives the user ample time to drag native handles without the popover popping up mid-drag).
  const SELECTION_DEBOUNCE_MS = isCoarsePointer() ? 800 : 250;

  // Native text selection (drag-to-select on desktop, long-press handles on mobile).
  // selectionchange is debounced. On mobile, the native selection handles intercept
  // touch events, so we cannot rely on touchend. The debounce timer commits the selection.
  useEffect(() => {
    if (!containerEl) return;

    function handleSelectionChange() {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => {
        const domSelection = window.getSelection();
        if (!domSelection || domSelection.rangeCount === 0 || domSelection.isCollapsed) {
          setSelection(null);
          return;
        }

        const range = domSelection.getRangeAt(0);
        if (!containerEl?.contains(range.commonAncestorContainer)) {
          setSelection(null);
          return;
        }

        const captured = captureSelectionFromRange(range, false, derivePosition);
        if (captured) {
          // Provide haptic feedback on touch devices when a selection is finalized
          if (isCoarsePointer()) {
            import("@capacitor/haptics")
              .then(({ Haptics, ImpactStyle }) => {
                Haptics.impact({ style: ImpactStyle.Medium }).catch(() => {});
              })
              .catch(() => {});
          }
          setSelection(captured);
        }
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

