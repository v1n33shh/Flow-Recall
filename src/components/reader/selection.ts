export type SelectionAnchor = {
  /** Viewport-space horizontal center of the selection, in px. */
  x: number;
  /** Viewport-space y coordinate to anchor to - the selection's top edge
   * when `placement` is "above", its bottom edge when "below". */
  y: number;
  placement: "above" | "below";
};

/** A single highlight rect in page (viewport) coordinates - selections can
 * span multiple lines, so this is an array, one per line box. */
export type PageRect = { x: number; y: number; width: number; height: number };

export type PendingSelection = {
  phrase: string;
  context: string;
  anchor: SelectionAnchor;
  /** Only populated on touch devices, where the real browser selection gets
   * collapsed (see captureSelectionFromRange) to pre-empt the OS's native
   * selection menu - these rects are what DefinitionPopover's SelectionHighlight
   * paints in its place. Undefined on desktop, where the native highlight
   * itself is the visual cue and nothing needs to be redrawn. */
  rects?: PageRect[];
  /** Opaque, type-dependent serialization of WHERE this selection is,
   * computed by the caller's derivePosition function at capture time -
   * an epub.js CFI range, PDF page-fraction rects, or text paragraph
   * offsets. This is exactly what gets handed to addHighlight() if the
   * user taps "Highlight", so it must already be in HighlightRecord.position's
   * shape by the time it lands here. */
  rawPosition: string;
};

/** Computes the opaque position string a selection should be saved under if
 * the user highlights it - injected per reader type since epub.js (CFI),
 * pdf.js (page-fraction rects), and raw text (paragraph offsets) each need
 * completely different math, none of which selection.ts itself should know about. */
export type DerivePosition = (range: Range) => string;

// Selections nearer the top of the viewport than this flip the popover to
// render below the selection instead of above, so it never clips offscreen.
const TOP_FLIP_THRESHOLD = 160;

// Cap how much surrounding text we send the model for disambiguation - a
// whole page/chapter would blow the prompt budget for zero extra benefit.
const MAX_CONTEXT_CHARS = 600;

// A word character for tap-to-define's boundary expansion: letters/numbers
// in any script, plus the punctuation that legitimately sits inside a single
// word (apostrophes for contractions/possessives, hyphens for compounds).
const WORD_CHAR = /[\p{L}\p{N}'’-]/u;

/** True when the primary input mechanism is touch (matchMedia "pointer:
 * coarse"), not a static "can this device technically receive touch events"
 * check - a touchscreen laptop with a mouse attached should still get the
 * desktop interaction model. Plain function (not a hook) so it's usable
 * inside imperative event-handler setup, not just component render. */
export function isCoarsePointer(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
}

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

/** Per-line highlight rects for a Range, in page coordinates - the touch
 * path's replacement for the native selection highlight it collapses away. */
export function rectsFromRange(range: Range, offsetLeft = 0, offsetTop = 0): PageRect[] {
  return Array.from(range.getClientRects()).map((rect) => ({
    x: offsetLeft + rect.left,
    y: offsetTop + rect.top,
    width: rect.width,
    height: rect.height,
  }));
}

export function captureSelectionFromRange(
  range: Range,
  includeRects: boolean,
  derivePosition: DerivePosition,
  offsetLeft = 0,
  offsetTop = 0,
): PendingSelection | null {
  const phrase = range.toString().trim();
  if (!phrase) return null;
  return {
    phrase,
    context: getBlockContext(range),
    anchor: anchorFromRect(range.getBoundingClientRect(), offsetLeft, offsetTop),
    rects: includeRects ? rectsFromRange(range, offsetLeft, offsetTop) : undefined,
    rawPosition: derivePosition(range),
  };
}

type CaretPoint = { node: Node; offset: number };

/** caretRangeFromPoint (Safari/Chrome) and caretPositionFromPoint (Firefox)
 * are two different non-standard/newer-standard APIs for the same thing:
 * "what text is under this exact pixel". Neither is on the lib.dom.d.ts
 * Document type in all TS lib versions, hence the local cast. */
function caretPointAt(doc: Document, x: number, y: number): CaretPoint | null {
  const withCaret = doc as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  };

  if (withCaret.caretRangeFromPoint) {
    const range = withCaret.caretRangeFromPoint(x, y);
    return range ? { node: range.startContainer, offset: range.startOffset } : null;
  }
  if (withCaret.caretPositionFromPoint) {
    const pos = withCaret.caretPositionFromPoint(x, y);
    return pos ? { node: pos.offsetNode, offset: pos.offset } : null;
  }
  return null;
}

/** Resolves the single word under an exact point, for long-press-to-define -
 * the whole reason this exists rather than just reading window.getSelection()
 * is that native selection is disabled entirely on touch (see globals.css's
 * reader-longpress-text rule), so there's never a browser Selection to read
 * in the first place. Deliberately scoped to a single text node (never
 * expands across markup/sibling boundaries) - a press that lands exactly on
 * a node seam does nothing rather than guessing. */
export function wordRangeAtPoint(doc: Document, x: number, y: number): Range | null {
  const caret = caretPointAt(doc, x, y);
  if (!caret || caret.node.nodeType !== Node.TEXT_NODE) return null;

  const text = caret.node.textContent ?? "";
  let anchor = caret.offset;
  // The tap can resolve to just past the word's last character - check one
  // character back before giving up, matching how a native word-select
  // gesture is forgiving about landing exactly on a glyph vs. its trailing edge.
  if (!WORD_CHAR.test(text[anchor] ?? "")) anchor -= 1;
  if (!WORD_CHAR.test(text[anchor] ?? "")) return null;

  let start = anchor;
  let end = anchor + 1;
  while (start > 0 && WORD_CHAR.test(text[start - 1])) start--;
  while (end < text.length && WORD_CHAR.test(text[end])) end++;

  const range = doc.createRange();
  range.setStart(caret.node, start);
  range.setEnd(caret.node, end);
  return range;
}

// How long a touch has to stay down, roughly in place, before it counts as a
// long-press rather than a tap/scroll/swipe.
export const LONG_PRESS_MS = 500;

// A long-press timer is cancelled if the touch drifts further than this
// before the timeout fires - distinguishes a held finger from the start of a
// scroll or swipe gesture.
const LONG_PRESS_MOVE_TOLERANCE_PX = 10;

/**
 * The core mobile long-press interaction, shared verbatim by useNativeSelection
 * (top-level document) and EpubReaderView (each chapter's sandboxed iframe
 * document) so the pointerdown-hold-timeout-vs-move/lift-cancel logic lives
 * in exactly one place.
 *
 * Native selection is expected to already be disabled via CSS (-webkit-user-
 * select/-webkit-touch-callout: none) on whatever `target` this attaches to -
 * unlike the old touchend-based approach, there's no live browser Selection
 * to capture-then-collapse here, since none is ever allowed to form: a
 * long-press resolves the word directly from the pointer's coordinates via
 * caretRangeFromPoint (wordRangeAtPoint), so the OS callout menu it would
 * otherwise trigger never gets a selection to attach to in the first place.
 *
 * Returns a cleanup function that cancels any pending timer and removes all
 * listeners - callers own its lifetime the same way they'd own any other
 * addEventListener cleanup.
 */
export function attachLongPressToDefine(params: {
  target: EventTarget;
  doc: Document;
  derivePosition: DerivePosition;
  onLongPress: (selection: PendingSelection) => void;
  offsetLeft?: number;
  offsetTop?: number;
}): () => void {
  const { target, doc, derivePosition, onLongPress, offsetLeft = 0, offsetTop = 0 } = params;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let origin: { x: number; y: number; pointerId: number } | null = null;

  function cancel() {
    clearTimeout(timer);
    timer = undefined;
    origin = null;
  }

  function fire() {
    const point = origin;
    origin = null;
    if (!point) return;
    const range = wordRangeAtPoint(doc, point.x, point.y);
    if (!range) return;
    const captured = captureSelectionFromRange(range, true, derivePosition, offsetLeft, offsetTop);
    if (captured) onLongPress(captured);
  }

  function onPointerDown(e: Event) {
    const pe = e as PointerEvent;
    if (pe.pointerType !== "touch") return;
    origin = { x: pe.clientX, y: pe.clientY, pointerId: pe.pointerId };
    timer = setTimeout(fire, LONG_PRESS_MS);
  }

  function onPointerMove(e: Event) {
    const pe = e as PointerEvent;
    if (!origin || pe.pointerId !== origin.pointerId) return;
    if (Math.hypot(pe.clientX - origin.x, pe.clientY - origin.y) > LONG_PRESS_MOVE_TOLERANCE_PX) cancel();
  }

  function onPointerUp(e: Event) {
    const pe = e as PointerEvent;
    if (!origin || pe.pointerId !== origin.pointerId) return;
    cancel();
  }

  target.addEventListener("pointerdown", onPointerDown);
  target.addEventListener("pointermove", onPointerMove);
  target.addEventListener("pointerup", onPointerUp);
  target.addEventListener("pointercancel", onPointerUp);

  return () => {
    cancel();
    target.removeEventListener("pointerdown", onPointerDown);
    target.removeEventListener("pointermove", onPointerMove);
    target.removeEventListener("pointerup", onPointerUp);
    target.removeEventListener("pointercancel", onPointerUp);
  };
}
