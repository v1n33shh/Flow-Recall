import type { ReactNode } from "react";
import type { HighlightRecord } from "./types";

export const PARAGRAPH_INDEX_ATTR = "data-paragraph-index";

// Visual gap between adjacent CSS columns in paginated mode.
export const COLUMN_GAP_PX = 48;

export function parseScrollFraction(raw: string | null | undefined): number {
  const value = raw ? Number(raw) : NaN;
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

export type TextReadingAnchor = { paragraphIndex: number };

export type ParsedTextPosition = { kind: "fraction"; value: number } | { kind: "anchor"; paragraphIndex: number };

export function parseTextReadingPosition(raw: string | null | undefined): ParsedTextPosition {
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed.paragraphIndex === "number") {
        return { kind: "anchor", paragraphIndex: parsed.paragraphIndex };
      }
    } catch {
      // Not JSON - it's the plain numeric fraction string scrolling mode writes.
    }
  }
  return { kind: "fraction", value: parseScrollFraction(raw) };
}

export function findTopVisibleAnchor(container: HTMLElement, mode: "paginated" | "scrolling"): TextReadingAnchor | null {
  const paragraphEls = container.querySelectorAll<HTMLElement>(`[${PARAGRAPH_INDEX_ATTR}]`);
  const containerRect = container.getBoundingClientRect();
  for (const el of Array.from(paragraphEls)) {
    const rect = el.getBoundingClientRect();
    const isCurrent = mode === "paginated" ? rect.right > containerRect.left + 1 : rect.bottom > containerRect.top + 1;
    if (isCurrent) return { paragraphIndex: Number(el.getAttribute(PARAGRAPH_INDEX_ATTR)) };
  }
  return null;
}

/** Which column-page the given paragraph starts on.
 *
 * Deliberately measured from layout (`offsetLeft`) rather than
 * getBoundingClientRect: paginated mode moves the content with a 300ms animated
 * `transform`, and rects report wherever the animation currently is - so a rect
 * read during a page turn resolves to the page being left behind. offsetLeft is
 * a layout metric, so it is stable mid-animation and unaffected by any stray
 * horizontal scroll of the container. */
export function locateAnchorPage(anchor: TextReadingAnchor | null, container: HTMLElement, width: number, gap: number): number {
  if (!anchor || width <= 0) return 0;
  const el = container.querySelector<HTMLElement>(`[${PARAGRAPH_INDEX_ATTR}="${anchor.paragraphIndex}"]`);
  const content = el?.parentElement;
  if (!el || !content) return 0;
  return paragraphColumnPage(el, content, width, gap);
}

/** Column-page of one already-located paragraph element, relative to the
 * multi-column content element it lives in. See locateAnchorPage on why this is
 * offset-based. */
export function paragraphColumnPage(el: HTMLElement, content: HTMLElement, width: number, gap: number): number {
  const stride = width + gap;
  if (stride <= 0) return 0;
  // Sub-pixel column positions round the wrong way without the epsilon.
  return Math.max(0, Math.floor((el.offsetLeft - content.offsetLeft + 1) / stride));
}

export type TextHighlightPosition = { paragraphIndex: number; start: number; end: number };

export function parseTextHighlightPosition(raw: string): TextHighlightPosition | null {
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

export function getParagraphOffset(paragraphEl: Element, targetNode: Node, targetOffset: number): number {
  const walker = document.createTreeWalker(paragraphEl, NodeFilter.SHOW_TEXT);
  let offset = 0;
  let node: Node | null;
  while ((node = walker.nextNode())) {
    if (node === targetNode) return offset + targetOffset;
    offset += node.textContent?.length ?? 0;
  }
  return offset;
}

export function closestParagraph(node: Node): HTMLElement | null {
  const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  return el?.closest<HTMLElement>(`[${PARAGRAPH_INDEX_ATTR}]`) ?? null;
}

export function deriveTextPosition(range: Range): string {
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

export function renderParagraphWithHighlights(
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
          className="cursor-pointer border-b-[3px] border-reader-highlight bg-transparent text-inherit"
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
