"use client";

import React, { useEffect, useRef, useState, useImperativeHandle } from "react";
import {
  COLUMN_GAP_PX,
  PARAGRAPH_INDEX_ATTR,
  type TextReadingAnchor,
  parseTextHighlightPosition,
  findTopVisibleAnchor,
  locateAnchorPage,
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

// Window size for DOM virtualization: renders 50 paragraphs around active anchor
// (Keeps DOM element count under ~50 nodes, preventing CSS multi-column WebKit thrashing)
const VIRTUAL_WINDOW_HALF = 25;

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
      header,
      footer,
    },
    ref,
  ) => {
    const scrollRef = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const [containerWidth, setContainerWidth] = useState(0);

    const pendingAnchorRef = useRef<TextReadingAnchor | null>(initialAnchor);
    const savedFractionRef = useRef(initialFraction);
    const hasRestoredScroll = useRef(false);
    const scrollPersistTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

    // Active paragraph window focus index
    const [activeFocusIndex, setActiveFocusIndex] = useState(() => initialAnchor?.paragraphIndex ?? 0);

    // Compute virtualized window range [startIndex, endIndex]
    const totalParagraphs = paragraphs.length;
    let windowStart = Math.max(0, activeFocusIndex - VIRTUAL_WINDOW_HALF);
    let windowEnd = Math.min(totalParagraphs, activeFocusIndex + VIRTUAL_WINDOW_HALF);

    // For smaller documents (< 80 paragraphs), render everything directly
    if (totalParagraphs <= 80) {
      windowStart = 0;
      windowEnd = totalParagraphs;
    }

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

    // Touch swipe / tap-to-turn tracking
    const touchStartX = useRef(0);
    const touchStartY = useRef(0);
    const touchStartAt = useRef(0);
    const isSwipeActive = useRef(false);

    const isPaginated = layoutMode === "paginated";

    // Helper: compute stride and total from DOM
    function getPageInfo() {
      const container = scrollRef.current;
      if (!container) return null;
      const w = containerWidth > 0 ? containerWidth : container.clientWidth;
      if (w <= 0) return null;
      const stride = w + COLUMN_GAP_PX;
      const scrollW = Math.max(container.scrollWidth, container.clientWidth);
      const total = Math.max(1, Math.ceil(scrollW / stride));
      return { container, w, stride, total };
    }

    function navigateToPage(targetPage: number) {
      const info = getPageInfo();
      if (!info) return;
      const { total } = info;
      const clamped = Math.max(0, Math.min(targetPage, total - 1));

      currentPageRef.current = clamped;
      totalPagesRef.current = total;
      setCurrentPage(clamped);

      onPaginationChangeRef.current(clamped, total);
      const fraction = total > 1 ? clamped / (total - 1) : 0;

      const globalProgress = totalParagraphs > 0
        ? Math.min(1, Math.max(0, (windowStart + (clamped / Math.max(1, total - 1)) * (windowEnd - windowStart)) / totalParagraphs))
        : fraction;

      onProgressChangeRef.current(globalProgress);

      clearTimeout(scrollPersistTimeout.current);
      scrollPersistTimeout.current = setTimeout(() => {
        const topAnchor = findTopVisibleAnchor(info.container, "paginated");
        const paragraphIdx = topAnchor ? topAnchor.paragraphIndex : Math.max(0, windowStart + clamped);
        onScrollPositionChangeRef.current(
          JSON.stringify({ paragraphIndex: paragraphIdx } satisfies TextReadingAnchor),
          globalProgress,
        );
      }, 600);
    }

    function goToPrevPage() {
      if (currentPageRef.current > 0) {
        navigateToPage(currentPageRef.current - 1);
      } else if (windowStart > 0) {
        const newFocus = Math.max(0, activeFocusIndex - 15);
        setActiveFocusIndex(newFocus);
      }
    }

    function goToNextPage() {
      const info = getPageInfo();
      const total = info ? info.total : 1;
      if (currentPageRef.current < total - 1) {
        navigateToPage(currentPageRef.current + 1);
      } else if (windowEnd < totalParagraphs) {
        const newFocus = Math.min(totalParagraphs - 1, activeFocusIndex + 15);
        setActiveFocusIndex(newFocus);
      }
    }

    function jumpToAnchor(anchor: TextReadingAnchor) {
      pendingAnchorRef.current = anchor;
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
        onPaginationChangeRef.current(clamped, total);
        
        const globalProgress = totalParagraphs > 0 ? anchor.paragraphIndex / totalParagraphs : 0;
        onProgressChangeRef.current(globalProgress);
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
      const container = scrollRef.current;
      if (!container) return;

      container.scrollTop = 0;

      const stride = containerWidth + COLUMN_GAP_PX;
      const scrollW = Math.max(container.scrollWidth, container.clientWidth);
      const total = Math.max(1, Math.ceil(scrollW / stride));

      // Default to leaving the reader on the page they are already on. This
      // effect re-runs on every reflow - font change, resize, and (with
      // streamed PDF extraction) every background batch that extends the
      // window - and jumping back to the resume anchor each time would drag
      // them backwards mid-sentence. The anchor is consumed once, by whoever
      // set it (initial open, or a layout-mode switch via capturePendingAnchor).
      let targetPage = currentPageRef.current;
      if (pendingAnchorRef.current) {
        targetPage = locateAnchorPage(pendingAnchorRef.current, container, containerWidth, COLUMN_GAP_PX);
        pendingAnchorRef.current = null;
      }
      const clamped = Math.max(0, Math.min(targetPage, total - 1));

      currentPageRef.current = clamped;
      totalPagesRef.current = total;
      setCurrentPage(clamped);

      onPaginationChangeRef.current(clamped, total);
      const globalProgress = totalParagraphs > 0
        ? Math.min(1, Math.max(0, activeFocusIndex / totalParagraphs))
        : (total > 1 ? clamped / (total - 1) : 0);
      onProgressChangeRef.current(globalProgress);
      // Deliberately keyed on the visible slice rather than `paragraphs` itself:
      // streamed extraction appends past the end of the window constantly, and
      // re-paginating for content nobody can see is pure jank.
    }, [isPaginated, fontPercent, fontFamily, containerWidth, activeFocusIndex, windowStart, visibleParagraphs.length, totalParagraphs]);

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
      } else if (!hasRestoredScroll.current) {
        el.scrollTop = savedFractionRef.current * (el.scrollHeight - el.clientHeight);
      }
      hasRestoredScroll.current = true;
      const globalProgress = totalParagraphs > 0 ? activeFocusIndex / totalParagraphs : 0;
      onProgressChangeRef.current(globalProgress);
    }, [layoutMode, activeFocusIndex, windowStart, visibleParagraphs.length, totalParagraphs]);

    // Continuous scroll handler (scrolling mode)
    function handleScroll() {
      if (isPaginated) return;
      const el = scrollRef.current;
      if (!el) return;
      
      const topAnchor = findTopVisibleAnchor(el, "scrolling");
      if (topAnchor && Math.abs(topAnchor.paragraphIndex - activeFocusIndex) > 10) {
        setActiveFocusIndex(topAnchor.paragraphIndex);
      }

      const maxScroll = el.scrollHeight - el.clientHeight;
      const fraction = maxScroll > 0 ? Math.min(1, Math.max(0, el.scrollTop / maxScroll)) : 0;
      const globalProgress = totalParagraphs > 0
        ? Math.min(1, Math.max(0, (topAnchor?.paragraphIndex ?? activeFocusIndex) / totalParagraphs))
        : fraction;

      onProgressChangeRef.current(globalProgress);

      clearTimeout(scrollPersistTimeout.current);
      scrollPersistTimeout.current = setTimeout(() => {
        const anchorToSave = topAnchor ?? { paragraphIndex: activeFocusIndex };
        onScrollPositionChangeRef.current(JSON.stringify(anchorToSave), globalProgress);
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
                ? "reader-longpress-text h-full text-foreground transition-transform duration-300 ease-out"
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
