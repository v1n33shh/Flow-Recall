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
  /** Only populated on touch devices, where native selection is disabled
   * outright (see globals.css's reader-longpress-text rule) - these rects are
   * what SelectionHighlight paints in its place, so the student can see which
   * word the long-press actually landed on. Undefined on desktop, where the
   * browser's own selection highlight is already the visual cue. */
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

// A word character for long-press-to-define's boundary expansion:
// letters/numbers in any script, combining marks (so accented and Indic
// glyphs don't split a word in half), plus the punctuation that legitimately
// sits inside a single word (apostrophes for contractions/possessives,
// hyphens for compounds).
const WORD_CHAR = /[\p{L}\p{N}\u0300-\u036f'\u2019-]/u;

/** Everything a long-press is allowed to resolve a word inside: the plain-text
 * reader's paragraph container, pdf.js's text layer, an individual paragraph.
 * A press that lands anywhere else (chrome, empty gutter) is ignored rather
 * than guessed at. */
const READER_TEXT_SELECTOR = ".reader-longpress-text, .textLayer, [data-paragraph-index], p";

/** Controls that own the press themselves - a long-press starting on one of
 * these is never a define gesture. Deliberately NOT `[aria-label]`: that
 * matches labelled spans inside the prose too, which would create dead zones
 * in the middle of the text. */
const INTERACTIVE_SELECTOR = '[role="dialog"], button, a, input, textarea, select, nav, header';

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
 * path's replacement for the native selection highlight it never allows to form. */
export function rectsFromRange(range: Range, offsetLeft = 0, offsetTop = 0): PageRect[] {
  return Array.from(range.getClientRects())
    .filter((rect) => rect.width > 0 && rect.height > 0)
    .map((rect) => ({
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

  // An empty position means derivePosition couldn't place this range (e.g. the
  // range resolved outside any [data-paragraph-index] paragraph). Bailing here
  // rather than opening the popover is what keeps "Highlight" from ever
  // persisting a record whose position can never be rendered back.
  const rawPosition = derivePosition(range);
  if (!rawPosition) return null;

  return {
    phrase,
    context: getBlockContext(range),
    anchor: anchorFromRect(range.getBoundingClientRect(), offsetLeft, offsetTop),
    rects: includeRects ? rectsFromRange(range, offsetLeft, offsetTop) : undefined,
    rawPosition,
  };
}



// How long a touch has to stay down, roughly in place, before it counts as a
// long-press rather than a tap/scroll/swipe. Kept under Android WebView's own
// ~350ms gesture-recognition threshold so the popover is already on screen by
// the time the platform would otherwise try to take the gesture over.
export const LONG_PRESS_MS = 300;

// A long-press timer is cancelled if the touch drifts further than this
// before the timeout fires - distinguishes a held finger (which wobbles a few
// px) from the start of a scroll or a page swipe. Large enough to survive
// fingertip jitter, small enough that a deliberate drag never defines a word
// the content has already scrolled out from under.
const LONG_PRESS_MOVE_TOLERANCE_PX = 16;

// A hold released a hair before the timer fires still counts. Android WebView
// batches touch delivery, so a genuine ~300ms press can surface its touchend
// a frame or two ahead of our own timeout.
const EARLY_RELEASE_GRACE_MS = 60;

/** The shortest hold that still resolves a word - LONG_PRESS_MS minus the
 * early-release grace above. Exported because anything else that reacts to a
 * touch ending inside reader text (TextReaderCore's tap-to-turn zones) has to
 * split "tap" from "long press" on exactly this boundary: a looser threshold
 * turns the page AND opens the popover for the same press, a stricter one
 * leaves holds that do neither. */
export const LONG_PRESS_COMMIT_MS = LONG_PRESS_MS - EARLY_RELEASE_GRACE_MS;


