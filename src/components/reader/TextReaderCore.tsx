"use client";

import React, { useEffect, useMemo, useRef, useState, useImperativeHandle } from "react";
import {
  COLUMN_GAP_PX,
  PARAGRAPH_INDEX_ATTR,
  type TextReadingAnchor,
  parseTextHighlightPosition,
  findTopVisibleAnchor,
  locateAnchorPage,
  paragraphColumnPage,
  renderParagraphWithHighlights,
} from "@/lib/textReaderUtils";
import type { HighlightRecord } from "@/lib/types";
import { type TextLayoutMode, type FontFamilyId, FONT_FAMILY_CSS } from "@/lib/readerPreferences";
import { isCoarsePointer, LONG_PRESS_COMMIT_MS } from "./selection";

export type TextReaderCoreProps = {
  paragraphs: string[];
  highlights: HighlightRecord[];
  fontPercent: number;
  fontFamily: FontFamilyId;
  layoutMode: TextLayoutMode;
  onHighlightTap: (record: HighlightRecord, event: React.MouseEvent) => void;
  onScrollPositionChange: (anchorStr: string, fraction: number) => void;
  onProgressChange: (fraction: number) => void;
  onPaginationChange: (currentPage: number, totalPages: number) => void;
  initialAnchor: TextReadingAnchor | null;
  initialFraction: number;
  /** 1-based source page number -> index of the first paragraph on that page.
   * When present (PDFs), the reported page number and progress are the book's
   * real pages instead of columns of the virtualization window - see
   * pageNumbersFor. Text and EPUB content has no such map and keeps reporting
   * columns. */
  pageMap?: Record<number, number>;
  /** The document's real page count. Pages with no text get no entry in
   * `pageMap`, and during a first-ever extraction the map only covers the pages
   * read so far, so the denominator comes from here when it is known. */
  pageCount?: number;
  header?: React.ReactNode;
  footer?: React.ReactNode;
};

export type TextReaderCoreRef = {
  goToPrevPage: () => void;
  goToNextPage: () => void;
  jumpToAnchor: (anchor: TextReadingAnchor) => void;
  getScrollContainer: () => HTMLDivElement | null;
  capturePendingAnchor: () => void;
};

// DOM virtualization window, sized by characters rather than by paragraph count.
//
// CSS multi-column layout cost tracks the text in the window, and paragraph
// sizes differ enormously between books: one paragraph is ~60 characters in the
// chess PDF and ~2800 in the Osho PDF, where every paragraph is a whole page of
// prose. Measured on the test device, a 50-paragraph window of the latter is
// 154k characters over 227 columns and blocks the main thread for 3.9s on open;
// 14k characters over 34 columns costs 67ms. So the budget is characters, with
// the paragraph count only as a cap on DOM nodes.
const WINDOW_TARGET_CHARS = 45000;
const WINDOW_MIN_PARAGRAPHS = 6;
const WINDOW_MAX_PARAGRAPHS = 50;

export const TextReaderCore = React.forwardRef<TextReaderCoreRef, TextReaderCoreProps>(
  (
    {
      paragraphs,
      highlights,
      fontPercent,
      fontFamily,
      layoutMode,
      onHighlightTap,
      onScrollPositionChange,
      onProgressChange,
      onPaginationChange,
      initialAnchor,
      initialFraction,
      pageMap,
      pageCount,
      header,
      footer,
    },
    ref,
  ) => {
    const scrollRef = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const [containerWidth, setContainerWidth] = useState(0);

    const pendingAnchorRef = useRef<TextReadingAnchor | null>(initialAnchor);
    // Applied to the page the pending anchor resolves to. Only shiftWindow uses
    // it: sliding the window changes what page N means, so the turn that caused
    // the slide has to be re-expressed as "one page on from where they were".
    const pendingPageDeltaRef = useRef(0);
    const savedFractionRef = useRef(initialFraction);
    const hasRestoredScroll = useRef(false);
    const scrollPersistTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

    // Active paragraph window focus index
    const [activeFocusIndex, setActiveFocusIndex] = useState(() => initialAnchor?.paragraphIndex ?? 0);

    // Compute virtualized window range [windowStart, windowEnd), grown outward
    // from the focused paragraph until the character budget above is spent.
    // Growth alternates so there is always something behind the reader to turn
    // back to, and prefers forward when the two sides are even.
    const totalParagraphs = paragraphs.length;
    const { windowStart, windowEnd } = useMemo(() => {
      if (totalParagraphs === 0) return { windowStart: 0, windowEnd: 0 };
      const focus = Math.min(Math.max(activeFocusIndex, 0), totalParagraphs - 1);
      let start = focus;
      let end = focus + 1;
      let chars = paragraphs[focus].length;

      while (end - start < WINDOW_MAX_PARAGRAPHS) {
        if (chars >= WINDOW_TARGET_CHARS && end - start >= WINDOW_MIN_PARAGRAPHS) break;
        const canGrowForward = end < totalParagraphs;
        const canGrowBack = start > 0;
        if (!canGrowForward && !canGrowBack) break;
        if (canGrowForward && (!canGrowBack || end - focus <= focus - start)) {
          chars += paragraphs[end].length;
          end++;
        } else {
          start--;
          chars += paragraphs[start].length;
        }
      }
      return { windowStart: start, windowEnd: end };
    }, [paragraphs, totalParagraphs, activeFocusIndex]);

    const visibleParagraphs = paragraphs.slice(windowStart, windowEnd);

    // Keep callbacks in refs to avoid re-triggering effects when parent passes inline functions
    const onPaginationChangeRef = useRef(onPaginationChange);
    onPaginationChangeRef.current = onPaginationChange;
    const onProgressChangeRef = useRef(onProgressChange);
    onProgressChangeRef.current = onProgressChange;
    const onScrollPositionChangeRef = useRef(onScrollPositionChange);
    onScrollPositionChangeRef.current = onScrollPositionChange;

    const currentPageRef = useRef(0);
    const totalPagesRef = useRef(1);
    const [currentPage, setCurrentPage] = useState(0);
    // Sliding the window renumbers every column, so the transform has to jump by
    // however many columns the removed paragraphs occupied. Animating that jump
    // sends the reader whooshing through dozens of pages of text on what was a
    // single page turn; this drops the transition for exactly that one frame.
    const [instantJump, setInstantJump] = useState(false);

    // Touch swipe / tap-to-turn tracking
    const touchStartX = useRef(0);
    const touchStartY = useRef(0);
    const touchStartAt = useRef(0);
    const isSwipeActive = useRef(false);

    const isPaginated = layoutMode === "paginated";

    // The book's real pages, sorted by where they start. pageToParagraphIndex
    // arrives keyed by page number and grows batch by batch during a first-ever
    // extraction, so this is rebuilt whenever it changes.
    const pageTable = useMemo(() => {
      if (!pageMap) return null;
      const entries = Object.entries(pageMap)
        .map(([page, firstParagraph]) => ({ page: Number(page), firstParagraph }))
        .sort((a, b) => a.page - b.page);
      if (entries.length === 0) return null;
      // The highest page number, not the number of entries: pages whose text was
      // empty or entirely blank get no entry, and a counter whose denominator
      // undercounts them would read "Page 200 of 190" further into the book.
      // pageCount, when the caller knows it, is truer still - it also covers
      // trailing pages with no text at all, and holds steady while a first-ever
      // extraction is still filling the map in.
      const lastPage = Math.max(pageCount ?? 0, entries[entries.length - 1].page);
      return { entries, lastPage };
    }, [pageMap, pageCount]);

    /** The book page a paragraph sits on: the last page that starts at or before
     * it. */
    function pageForParagraph(paragraphIndex: number): number | null {
      if (!pageTable) return null;
      const { entries } = pageTable;
      let lo = 0;
      let hi = entries.length - 1;
      let found = entries[0].page;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (entries[mid].firstParagraph <= paragraphIndex) {
          found = entries[mid].page;
          lo = mid + 1;
        } else {
          hi = mid - 1;
        }
      }
      return found;
    }

    /** What the chrome should display. With a page map this is the book's own
     * page numbering; without one it stays the column count it always was.
     * `page` is 0-based - the caller renders `page + 1`. */
    function pageNumbersFor(paragraphIndex: number, columnPage: number, columnTotal: number) {
      const bookPage = pageForParagraph(paragraphIndex);
      if (bookPage === null || !pageTable) return { page: columnPage, total: columnTotal };
      return { page: bookPage - 1, total: pageTable.lastPage };
    }

    /** Progress derived from the same paragraph the page number came from, so
     * the bar and the counter can never disagree. */
    function progressFor(paragraphIndex: number, columnPage?: number, columnTotal?: number): number {
      const bookPage = pageForParagraph(paragraphIndex);
      if (bookPage !== null && pageTable && pageTable.lastPage > 1) {
        return Math.min(1, Math.max(0, (bookPage - 1) / (pageTable.lastPage - 1)));
      }
      if (totalParagraphs > 1) {
        return Math.min(1, Math.max(0, paragraphIndex / (totalParagraphs - 1)));
      }
      // A document with no second paragraph to move between - a pasted note -
      // has no paragraph-level progress to report, so fall back to how far
      // across the columns the reader has got.
      if (columnPage !== undefined && columnTotal !== undefined && columnTotal > 1) {
        return Math.min(1, Math.max(0, columnPage / (columnTotal - 1)));
      }
      return 0;
    }

    function reportPosition(paragraphIndex: number, columnPage: number, columnTotal: number) {
      const view = pageNumbersFor(paragraphIndex, columnPage, columnTotal);
      onPaginationChangeRef.current(view.page, view.total);
      onProgressChangeRef.current(progressFor(paragraphIndex, columnPage, columnTotal));
    }

    // Helper: compute stride and total from DOM
    function getPageInfo() {
      const container = scrollRef.current;
      const content = contentRef.current;
      if (!container || !content) return null;
      const w = containerWidth > 0 ? containerWidth : container.clientWidth;
      if (w <= 0) return null;
      const stride = w + COLUMN_GAP_PX;
      // The content element's own scrollWidth, never the scroll container's:
      // paging translates this element, and a transform shrinks the container's
      // scrollable overflow - which is what made the page total count *down* as
      // the reader advanced ("Page 1 of 34" ... "Page 18 of 18"). The content
      // element's scrollWidth is pure layout, so it holds still.
      const laidOut = Math.max(content.scrollWidth, w);
      const total = Math.max(1, Math.ceil(laidOut / stride));
      return { container, content, w, stride, total };
    }

    /** Which paragraph the reader sees first on a given column-page: the first one
     * that starts there, or - when a long paragraph spills across several columns
     * and none starts here - the one still running through it.
     *
     * Layout-based (see paragraphColumnPage), so it stays correct mid page-turn
     * animation. Taking the *first* rather than the last matters wherever several
     * paragraphs share one column: naming the bottom one would report a page the
     * reader has not got to yet. */
    function paragraphAtColumnPage(columnPage: number): number | null {
      const info = getPageInfo();
      if (!info) return null;
      let spilledFrom: number | null = null;
      for (const el of info.content.querySelectorAll<HTMLElement>(`[${PARAGRAPH_INDEX_ATTR}]`)) {
        const column = paragraphColumnPage(el, info.content, info.w, COLUMN_GAP_PX);
        const index = Number(el.getAttribute(PARAGRAPH_INDEX_ATTR));
        if (column === columnPage) return index;
        if (column < columnPage) spilledFrom = index;
        else break;
      }
      return spilledFrom;
    }

    function navigateToPage(targetPage: number) {
      const info = getPageInfo();
      if (!info) return;
      const { total } = info;
      const clamped = Math.max(0, Math.min(targetPage, total - 1));

      currentPageRef.current = clamped;
      totalPagesRef.current = total;
      setCurrentPage(clamped);

      const paragraphIdx = paragraphAtColumnPage(clamped) ?? windowStart + clamped;
      reportPosition(paragraphIdx, clamped, total);

      clearTimeout(scrollPersistTimeout.current);
      scrollPersistTimeout.current = setTimeout(() => {
        onScrollPositionChangeRef.current(
          JSON.stringify({ paragraphIndex: paragraphIdx } satisfies TextReadingAnchor),
          progressFor(paragraphIdx, clamped, total),
        );
      }, 600);
    }

    /** Slides the virtualization window, keeping the reader's place and then
     * advancing one page within the *new* window.
     *
     * Without the anchor this skipped text: page N of the old window and page N
     * of the new one are different content (windowStart moved), and the
     * re-pagination effect fell back to the old page index. Without the delta the
     * turn would instead do nothing, landing back on the page they were already
     * reading. */
    function shiftWindow(direction: 1 | -1) {
      const container = scrollRef.current;
      const seen = container ? findTopVisibleAnchor(container, layoutMode) : null;
      const anchorIndex = seen?.paragraphIndex ?? activeFocusIndex;
      // Re-centre the window on what they are actually reading rather than
      // stepping a fixed distance: that guarantees the anchor is inside the new
      // window (it is its centre) and leaves the most content ahead before the
      // next slide is needed. A paragraph tall enough to fill the window on its
      // own leaves the anchor where it already was, so nudge past it.
      const nextFocus = anchorIndex === activeFocusIndex
        ? Math.max(0, Math.min(totalParagraphs - 1, activeFocusIndex + direction))
        : anchorIndex;
      pendingAnchorRef.current = { paragraphIndex: anchorIndex };
      pendingPageDeltaRef.current = direction;
      setInstantJump(true);
      setActiveFocusIndex(nextFocus);
    }

    function goToPrevPage() {
      if (currentPageRef.current > 0) {
        navigateToPage(currentPageRef.current - 1);
      } else if (windowStart > 0) {
        shiftWindow(-1);
      }
    }

    function goToNextPage() {
      const info = getPageInfo();
      const total = info ? info.total : 1;
      if (currentPageRef.current < total - 1) {
        navigateToPage(currentPageRef.current + 1);
      } else if (windowEnd < totalParagraphs) {
        shiftWindow(1);
      }
    }

    function jumpToAnchor(anchor: TextReadingAnchor) {
      pendingAnchorRef.current = anchor;
      pendingPageDeltaRef.current = 0;
      setActiveFocusIndex(anchor.paragraphIndex);

      const container = scrollRef.current;
      if (!container) return;

      if (isPaginated && containerWidth > 0) {
        container.scrollTop = 0;
        const page = locateAnchorPage(anchor, container, containerWidth, COLUMN_GAP_PX);
        const info = getPageInfo();
        const total = info ? info.total : 1;
        const clamped = Math.max(0, Math.min(page, total - 1));

        currentPageRef.current = clamped;
        setCurrentPage(clamped);
        reportPosition(anchor.paragraphIndex, clamped, total);
      } else {
        const paragraphEl = container.querySelector<HTMLElement>(
          `[${PARAGRAPH_INDEX_ATTR}="${anchor.paragraphIndex}"]`,
        );
        if (paragraphEl) {
          container.scrollTop = paragraphEl.offsetTop;
        }
      }
    }

    useImperativeHandle(ref, () => ({
      goToPrevPage,
      goToNextPage,
      jumpToAnchor,
      getScrollContainer: () => scrollRef.current,
      capturePendingAnchor: () => {
        const container = scrollRef.current;
        if (container) {
          const anchor = findTopVisibleAnchor(container, layoutMode);
          if (anchor) {
            pendingAnchorRef.current = anchor;
            pendingPageDeltaRef.current = 0;
            setActiveFocusIndex(anchor.paragraphIndex);
          }
        }
      },
    }));

    // ResizeObserver to track container width
    useEffect(() => {
      const el = scrollRef.current;
      if (!el) return;
      const observer = new ResizeObserver((entries) => {
        const w = entries[0]?.contentRect.width ?? el.clientWidth;
        if (w > 0) setContainerWidth(w);
      });
      observer.observe(el);
      if (el.clientWidth > 0) setContainerWidth(el.clientWidth);
      return () => observer.disconnect();
    }, []);

    // Paginated layout & position restoration
    useEffect(() => {
      if (!isPaginated || containerWidth <= 0) return;
      const info = getPageInfo();
      if (!info) return;
      const { container, total } = info;

      container.scrollTop = 0;

      // Default to leaving the reader on the page they are already on. This
      // effect re-runs on every reflow - font change, resize, and (with
      // streamed PDF extraction) every background batch that extends the
      // window - and jumping back to the resume anchor each time would drag
      // them backwards mid-sentence. The anchor is consumed once, by whoever
      // set it (initial open, a layout-mode switch, or a window slide).
      let targetPage = currentPageRef.current;
      if (pendingAnchorRef.current) {
        targetPage = locateAnchorPage(pendingAnchorRef.current, container, containerWidth, COLUMN_GAP_PX);
        pendingAnchorRef.current = null;
        targetPage += pendingPageDeltaRef.current;
        pendingPageDeltaRef.current = 0;
      }
      const clamped = Math.max(0, Math.min(targetPage, total - 1));

      currentPageRef.current = clamped;
      totalPagesRef.current = total;
      setCurrentPage(clamped);

      reportPosition(paragraphAtColumnPage(clamped) ?? activeFocusIndex, clamped, total);

      // Restore the animation once the jumped-to page has been painted.
      if (instantJump) {
        const frame = requestAnimationFrame(() => setInstantJump(false));
        return () => cancelAnimationFrame(frame);
      }
      // Deliberately keyed on the visible slice rather than `paragraphs` itself:
      // streamed extraction appends past the end of the window constantly, and
      // re-paginating for content nobody can see is pure jank. pageTable is in
      // here so the counter picks up pages as extraction reveals them.
    }, [isPaginated, fontPercent, fontFamily, containerWidth, activeFocusIndex, windowStart, visibleParagraphs.length, totalParagraphs, pageTable]);

    // Scrolling mode position restoration & window tracking
    useEffect(() => {
      if (layoutMode !== "scrolling") return;
      const el = scrollRef.current;
      if (!el) return;

      const anchor = pendingAnchorRef.current;
      if (anchor) {
        const paragraphEl = el.querySelector<HTMLElement>(
          `[${PARAGRAPH_INDEX_ATTR}="${anchor.paragraphIndex}"]`,
        );
        el.scrollTop = paragraphEl
          ? paragraphEl.offsetTop
          : savedFractionRef.current * (el.scrollHeight - el.clientHeight);
        pendingAnchorRef.current = null;
        pendingPageDeltaRef.current = 0;
      } else if (!hasRestoredScroll.current) {
        el.scrollTop = savedFractionRef.current * (el.scrollHeight - el.clientHeight);
      }
      hasRestoredScroll.current = true;
      onProgressChangeRef.current(progressFor(activeFocusIndex));
    }, [layoutMode, activeFocusIndex, windowStart, visibleParagraphs.length, totalParagraphs, pageTable]);

    // Continuous scroll handler (scrolling mode)
    function handleScroll() {
      if (isPaginated) return;
      const el = scrollRef.current;
      if (!el) return;

      const topAnchor = findTopVisibleAnchor(el, "scrolling");
      if (topAnchor && Math.abs(topAnchor.paragraphIndex - activeFocusIndex) > 10) {
        setActiveFocusIndex(topAnchor.paragraphIndex);
      }

      const paragraphIdx = topAnchor?.paragraphIndex ?? activeFocusIndex;
      const globalProgress = progressFor(paragraphIdx);
      onProgressChangeRef.current(globalProgress);

      clearTimeout(scrollPersistTimeout.current);
      scrollPersistTimeout.current = setTimeout(() => {
        onScrollPositionChangeRef.current(
          JSON.stringify({ paragraphIndex: paragraphIdx } satisfies TextReadingAnchor),
          globalProgress,
        );
      }, 500);
    }

    useEffect(() => {
      return () => clearTimeout(scrollPersistTimeout.current);
    }, []);

    // Touch swipe / tap handlers (paginated only)
    const SWIPE_THRESHOLD = 40;

    // Tap-to-turn zones, as a fraction of the container's width, and how much
    // drift still counts as a tap rather than a nudged scroll.
    const TAP_ZONE_FRACTION = 0.2;
    const TAP_MAX_MOVE_PX = 10;

    function handleTouchStart(e: React.TouchEvent) {
      if (!isPaginated) return;
      const touch = e.touches[0];
      touchStartX.current = touch.clientX;
      touchStartY.current = touch.clientY;
      touchStartAt.current = Date.now();
      isSwipeActive.current = true;
    }

    function handleTouchMove(e: React.TouchEvent) {
      if (!isPaginated || !isSwipeActive.current) return;
      const touch = e.touches[0];
      const dx = Math.abs(touch.clientX - touchStartX.current);
      const dy = Math.abs(touch.clientY - touchStartY.current);
      if (dx > dy && dx > 10) {
        e.preventDefault();
      }
    }

    function handleTouchEnd(e: React.TouchEvent) {
      if (!isPaginated || !isSwipeActive.current) return;
      isSwipeActive.current = false;

      const touch = e.changedTouches[0];
      const dx = touch.clientX - touchStartX.current;
      const dy = Math.abs(touch.clientY - touchStartY.current);

      if (Math.abs(dx) > SWIPE_THRESHOLD && Math.abs(dx) > dy) {
        if (dx < 0) {
          goToNextPage();
        } else {
          goToPrevPage();
        }
        return;
      }

      // Tap-to-turn. Coarse pointers only, because that is exactly where the
      // .reader-page-turn overlays below are display:none (see globals.css) -
      // on a mouse-driven device those buttons are still the ones handling
      // this, and running both would turn two pages per click.
      //
      // A hold long enough to have fired long-press-to-define, or a drag long
      // enough to have been a scroll, is never a page turn. LONG_PRESS_COMMIT_MS
      // is the exact boundary selection.ts commits a word on, so no press can
      // both turn the page and open the definition popover.
      if (!isCoarsePointer()) return;
      if (Date.now() - touchStartAt.current >= LONG_PRESS_COMMIT_MS) return;
      if (Math.abs(dx) > TAP_MAX_MOVE_PX || dy > TAP_MAX_MOVE_PX) return;

      const container = scrollRef.current;
      if (!container) return;
      const bounds = container.getBoundingClientRect();
      if (bounds.width <= 0 || bounds.height <= 0) return;

      const relX = (touch.clientX - bounds.left) / bounds.width;
      const relY = (touch.clientY - bounds.top) / bounds.height;
      // Same vertical band the desktop overlays cover (inset-y-[15%]), so both
      // input paths turn pages from the same places.
      if (relY < 0.15 || relY > 0.85) return;

      if (relX <= TAP_ZONE_FRACTION) goToPrevPage();
      else if (relX >= 1 - TAP_ZONE_FRACTION) goToNextPage();
    }

    // Top/bottom spacers for scroll mode height virtualization
    const avgParaHeight = 65;
    const topSpacerHeight = windowStart * avgParaHeight;
    const bottomSpacerHeight = (totalParagraphs - windowEnd) * avgParaHeight;

    return (
      <>
        {/* Click-to-turn overlays for mouse-driven devices. globals.css drops
            these entirely under (pointer: coarse): an invisible overlay on top
            of the prose swallows long-press-to-define across the outer fifth of
            every page, and hides the text beneath it from elementFromPoint and
            caretRangeFromPoint. Touch turns pages via the tap zones in
            handleTouchEnd (and swipes) instead, over uncovered text. */}
        {isPaginated && (
          <>
            <button
              type="button"
              aria-label="Previous page"
              onClick={goToPrevPage}
              className="reader-page-turn absolute inset-y-[15%] left-0 z-10 w-[20%] cursor-w-resize"
            />
            <button
              type="button"
              aria-label="Next page"
              onClick={goToNextPage}
              className="reader-page-turn absolute inset-y-[15%] right-0 z-10 w-[20%] cursor-e-resize"
            />
          </>
        )}

        <div
          ref={scrollRef}
          onScroll={handleScroll}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onTouchCancel={() => { isSwipeActive.current = false; }}
          className={
            isPaginated
              ? "h-full w-full overflow-x-scroll overflow-y-hidden no-scrollbar px-6 py-10"
              : "h-full w-full overflow-y-auto px-6 py-10 sm:px-10 bg-background"
          }
          style={isPaginated ? { touchAction: "pan-y" } : undefined}
        >
          {/* Paginated mode waits for the ResizeObserver's first measurement.
              columnWidth would otherwise be "0px" on the first paint, which is
              invalid CSS and so ignored - collapsing the whole window into one
              overflowing column of jumbled text for a frame before it snaps
              into place. That flash is what reads as "gibberish letters before
              it settles down". Scrolling mode doesn't use containerWidth at
              all, so it renders immediately. */}
          {(!isPaginated || containerWidth > 0) && (
          <div
            ref={contentRef}
            className={
              isPaginated
                ? `reader-longpress-text h-full text-foreground${instantJump ? "" : " transition-transform duration-300 ease-out"}`
                : "reader-longpress-text mx-auto max-w-2xl text-foreground"
            }
            style={
              isPaginated
                ? {
                    fontFamily: FONT_FAMILY_CSS[fontFamily],
                    fontSize: `${fontPercent}%`,
                    lineHeight: 1.75,
                    columnWidth: `${containerWidth}px`,
                    columnGap: `${COLUMN_GAP_PX}px`,
                    columnFill: "auto" as const,
                    height: "100%",
                    transform: `translate3d(-${currentPage * (containerWidth + COLUMN_GAP_PX)}px, 0, 0)`,
                  }
                : {
                    fontFamily: FONT_FAMILY_CSS[fontFamily],
                    fontSize: `${fontPercent}%`,
                    lineHeight: 1.75,
                  }
            }
          >
            {!isPaginated && topSpacerHeight > 0 && (
              <div style={{ height: `${topSpacerHeight}px` }} aria-hidden="true" />
            )}
            
            {header && windowStart === 0 && header}

            {visibleParagraphs.map((paragraph, relIdx) => {
              const absIdx = windowStart + relIdx;
              const entries = highlights
                .map((record) => {
                  const position = parseTextHighlightPosition(record.position);
                  return position && position.paragraphIndex === absIdx ? { record, position } : null;
                })
                .filter((e) => e !== null);

              return (
                <p key={absIdx} data-paragraph-index={absIdx} className="mb-6 whitespace-pre-wrap">
                  {renderParagraphWithHighlights(paragraph, entries, onHighlightTap)}
                </p>
              );
            })}

            {footer && windowEnd === totalParagraphs && footer}

            {!isPaginated && bottomSpacerHeight > 0 && (
              <div style={{ height: `${bottomSpacerHeight}px` }} aria-hidden="true" />
            )}
          </div>
          )}
        </div>
      </>
    );
  },
);
TextReaderCore.displayName = "TextReaderCore";
