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

interface CaretPoint {
  node: Node;
  offset: number;
}

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

function rectContains(rect: DOMRect, x: number, y: number): boolean {
  // 2px of slack in both axes: a fingertip's reported centre lands a pixel or
  // two off the glyph box often enough to matter, and line boxes butt up
  // against each other exactly, so an off-by-one shouldn't mean "no word here".
  return x >= rect.left - 2 && x <= rect.right + 2 && y >= rect.top - 2 && y <= rect.bottom + 2;
}

/** Fallback for when caretRangeFromPoint resolves to an ELEMENT rather than a
 * text node - it does that when the point lands on a paragraph's own padding,
 * or on a wrapper whose text lives one level down. Rather than guess (picking
 * "some" child text node would define a word the student never pressed), this
 * geometrically hit-tests the reader-text container's own text nodes and
 * returns the exact character under the point, or nothing at all.
 *
 * The per-character scan only ever runs on the single text node whose line
 * boxes actually contain the point, and only on this fallback path - never on
 * the caretRangeFromPoint happy path that handles the overwhelming majority
 * of presses. */
function caretPointFromContainer(doc: Document, x: number, y: number): CaretPoint | null {
  const container = doc.elementFromPoint(x, y)?.closest<HTMLElement>(READER_TEXT_SELECTOR);
  if (!container) return null;

  const walker = doc.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const probe = doc.createRange();

  let node: Node | null;
  while ((node = walker.nextNode())) {
    const text = node.textContent ?? "";
    if (!text.trim()) continue;

    probe.selectNodeContents(node);
    if (!Array.from(probe.getClientRects()).some((rect) => rectContains(rect, x, y))) continue;

    for (let i = 0; i < text.length; i++) {
      probe.setStart(node, i);
      probe.setEnd(node, i + 1);
      if (Array.from(probe.getClientRects()).some((rect) => rectContains(rect, x, y))) {
        return { node, offset: i };
      }
    }
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
  // A press right at the screen edge can report a coordinate a hair outside
  // the viewport, which every caret API answers null for.
  const viewportWidth = doc.documentElement?.clientWidth || 0;
  const viewportHeight = doc.documentElement?.clientHeight || 0;
  const px = viewportWidth > 0 ? Math.max(0, Math.min(x, viewportWidth - 1)) : x;
  const py = viewportHeight > 0 ? Math.max(0, Math.min(y, viewportHeight - 1)) : y;

  let caret = caretPointAt(doc, px, py);
  if (!caret || caret.node.nodeType !== Node.TEXT_NODE) {
    caret = caretPointFromContainer(doc, px, py);
  }
  if (!caret || caret.node.nodeType !== Node.TEXT_NODE) return null;

  const text = caret.node.textContent ?? "";

  // The caret can resolve to just past a word's last character (or just
  // before its first), so check one character either side before giving up -
  // matching how a native word-select gesture is forgiving about landing on a
  // glyph versus its trailing edge. Anything further afield is a press in
  // genuinely blank space, and defining a word inches away from the finger is
  // worse than doing nothing.
  let anchor = -1;
  for (const candidate of [caret.offset, caret.offset - 1, caret.offset + 1]) {
    if (candidate >= 0 && candidate < text.length && WORD_CHAR.test(text[candidate])) {
      anchor = candidate;
      break;
    }
  }
  if (anchor === -1) return null;

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

/**
 * The core long-press interaction, shared by useNativeSelection (top-level
 * document: PDF text, plain text) and EpubReaderView (each chapter's
 * sandboxed iframe document) so the hold-vs-move-vs-lift logic lives in
 * exactly one place.
 *
 * Native selection is expected to already be disabled via CSS (-webkit-user-
 * select / -webkit-touch-callout: none) on whatever `target` this attaches to:
 * a long-press resolves the word directly from the pointer's coordinates via
 * caretRangeFromPoint (wordRangeAtPoint), so the OS callout menu never gets a
 * selection to attach to in the first place.
 *
 * On touch devices this listens to TOUCH events, not pointer events. That is
 * not stylistic: Chrome/Android WebView fires `pointercancel` the moment it
 * decides a touch is a scroll, and it makes that call well inside our hold
 * window - so a pointer-based timer gets killed on presses the user very
 * much intended as a long-press. Touch events keep flowing through the same
 * gesture, leaving the move-tolerance check (which is what should decide
 * "this became a scroll") in charge instead.
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
  // Non-null exactly while a press is pending. fire() and cancel() both clear
  // it, so it doubles as the "already resolved, ignore the rest of this
  // gesture" flag - there is no path that can fire twice for one press.
  let origin: { x: number; y: number; at: number } | null = null;

  function cancel() {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
    origin = null;
  }

  function fire() {
    const point = origin;
    cancel();
    if (!point) return;

    // Only ever define a word inside actual reader text: a press that drifted
    // onto chrome, or landed in a gutter, resolves to nothing.
    const element = doc.elementFromPoint(point.x, point.y);
    if (!element?.closest(READER_TEXT_SELECTOR)) return;

    const range = wordRangeAtPoint(doc, point.x, point.y);
    if (!range) return;

    const captured = captureSelectionFromRange(range, true, derivePosition, offsetLeft, offsetTop);
    if (!captured) return;

    // Whatever partial selection the platform may have started building is not
    // ours, and leaving it in place is what gives the OS callout menu
    // something to anchor to. SelectionHighlight paints captured.rects instead.
    doc.getSelection()?.removeAllRanges();
    onLongPress(captured);
  }

  function start(x: number, y: number) {
    cancel();
    const element = doc.elementFromPoint(x, y);
    if (element?.closest(INTERACTIVE_SELECTOR)) return;
    origin = { x, y, at: Date.now() };
    timer = setTimeout(fire, LONG_PRESS_MS);
  }

  function move(x: number, y: number) {
    if (!origin) return;
    if (Math.hypot(x - origin.x, y - origin.y) > LONG_PRESS_MOVE_TOLERANCE_PX) cancel();
  }

  function end() {
    // origin is already null if the timer fired (or the press was cancelled),
    // so a completed long-press falls straight through here.
    if (!origin) return;
    if (Date.now() - origin.at >= LONG_PRESS_COMMIT_MS) fire();
    else cancel();
  }

  function onTouchStart(e: Event) {
    const touches = (e as TouchEvent).touches;
    // A second finger means pinch-zoom, not a define gesture.
    if (touches.length !== 1) {
      cancel();
      return;
    }
    start(touches[0].clientX, touches[0].clientY);
  }

  function onTouchMove(e: Event) {
    const touch = (e as TouchEvent).touches[0];
    if (touch) move(touch.clientX, touch.clientY);
  }

  function onPointerDown(e: Event) {
    const pe = e as PointerEvent;
    start(pe.clientX, pe.clientY);
  }

  function onPointerMove(e: Event) {
    const pe = e as PointerEvent;
    move(pe.clientX, pe.clientY);
  }

  // The content moving under a held finger invalidates the stored coordinates
  // outright - firing after a scroll would define whichever word had drifted
  // into that spot. Capture phase because scroll doesn't bubble.
  const onScroll = () => cancel();

  // Belt and braces alongside the CSS user-select rule: if a native selection
  // gesture ever does start over reader text on a coarse pointer, refuse it
  // here too, so the OS action bar has nothing to attach to. Desktop
  // drag-to-select (the selectionchange path) is deliberately left alone.
  function onSelectStart(e: Event) {
    if (!isCoarsePointer()) return;
    const node = e.target as Node | null;
    const element = node?.nodeType === Node.ELEMENT_NODE ? (node as Element) : node?.parentElement;
    if (element?.closest(READER_TEXT_SELECTOR)) e.preventDefault();
  }

  const preventContextMenu = (e: Event) => {
    const mouse = e as MouseEvent;
    const element = doc.elementFromPoint(mouse.clientX, mouse.clientY);
    if (element?.closest(READER_TEXT_SELECTOR)) e.preventDefault();
  };

  const useTouch = isCoarsePointer() || (typeof window !== "undefined" && "ontouchstart" in window);

  if (useTouch) {
    target.addEventListener("touchstart", onTouchStart, { passive: true });
    target.addEventListener("touchmove", onTouchMove, { passive: true });
    target.addEventListener("touchend", end, { passive: true });
    target.addEventListener("touchcancel", cancel, { passive: true });
  } else {
    target.addEventListener("pointerdown", onPointerDown, { passive: true });
    target.addEventListener("pointermove", onPointerMove, { passive: true });
    target.addEventListener("pointerup", end, { passive: true });
    target.addEventListener("pointercancel", cancel, { passive: true });
  }
  doc.addEventListener("scroll", onScroll, { capture: true, passive: true });
  doc.addEventListener("selectstart", onSelectStart);
  doc.addEventListener("contextmenu", preventContextMenu);

  return () => {
    cancel();
    if (useTouch) {
      target.removeEventListener("touchstart", onTouchStart);
      target.removeEventListener("touchmove", onTouchMove);
      target.removeEventListener("touchend", end);
      target.removeEventListener("touchcancel", cancel);
    } else {
      target.removeEventListener("pointerdown", onPointerDown);
      target.removeEventListener("pointermove", onPointerMove);
      target.removeEventListener("pointerup", end);
      target.removeEventListener("pointercancel", cancel);
    }
    doc.removeEventListener("scroll", onScroll, { capture: true });
    doc.removeEventListener("selectstart", onSelectStart);
    doc.removeEventListener("contextmenu", preventContextMenu);
  };
}
