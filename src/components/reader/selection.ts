export type SelectionAnchor = {
  /** Viewport-space horizontal center of the selection, in px. */
  x: number;
  /** Viewport-space y coordinate to anchor to - the selection's top edge
   * when `placement` is "above", its bottom edge when "below". */
  y: number;
  placement: "above" | "below";
};

export type PendingSelection = {
  phrase: string;
  context: string;
  anchor: SelectionAnchor;
};

// Selections nearer the top of the viewport than this flip the popover to
// render below the selection instead of above, so it never clips offscreen.
const TOP_FLIP_THRESHOLD = 160;

// Cap how much surrounding text we send the model for disambiguation - a
// whole page/chapter would blow the prompt budget for zero extra benefit.
const MAX_CONTEXT_CHARS = 600;

/** Walks up from the selected range to the nearest substantial block element
 * (paragraph, list item, blockquote...) so the model gets real surrounding
 * sentence context instead of just the highlighted fragment. Works the same
 * whether the range lives in an epub.js content iframe or the main document. */
export function getBlockContext(range: Range): string {
  const node: Node = range.commonAncestorContainer;
  let element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;

  while (element && element.textContent && element.textContent.trim().length < 40 && element.parentElement) {
    element = element.parentElement;
  }

  const text = element?.textContent?.trim() ?? "";
  return text.length > MAX_CONTEXT_CHARS ? text.slice(0, MAX_CONTEXT_CHARS) : text;
}

/** Turns a selection Range's bounding rect into a popover anchor, optionally
 * offset by an ancestor iframe's own position (epub.js renders each chapter
 * into a sandboxed iframe, so its rects are iframe-local; native DOM
 * selections in the PDF text layer or the raw-text view pass offset 0,0
 * since they're already in the top-level document). */
export function anchorFromRect(rect: DOMRect, offsetLeft = 0, offsetTop = 0): SelectionAnchor {
  const topY = offsetTop + rect.top;
  const bottomY = offsetTop + rect.bottom;
  const placement: SelectionAnchor["placement"] = topY < TOP_FLIP_THRESHOLD ? "below" : "above";
  return {
    x: offsetLeft + rect.left + rect.width / 2,
    y: placement === "above" ? topY : bottomY,
    placement,
  };
}
