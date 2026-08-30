"use client";

import { motion } from "motion/react";
import EyeFilterOverlay from "./EyeFilterOverlay";

// PERFORMANCE CONTRACT (matches StreakModal/MobileTabBar): every animation
// here touches transform/opacity only. The one static backdrop-blur (chrome
// bar) never animates.

/** Shared full-bleed reader shell (progress bar + back button + title +
 * type-specific controls slot) used by every reader view - EpubReaderView,
 * PdfReaderView, TextReaderView - so switching content types never feels
 * like switching apps. */
export default function ReaderChrome({
  onExit,
  title,
  progress,
  loading,
  controls,
  children,
}: {
  onExit: () => void;
  title: string;
  progress: number;
  loading?: boolean;
  controls?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-background">
      {/* Fine top-of-viewport progress bar, Chrome-tab-load style. Scaled via
          transform (not width) so it stays compositor-only, per the contract
          above - animating `width` triggers layout every frame. */}
      <div className="absolute inset-x-0 top-0 z-30 h-[3px] bg-foreground/5">
        <motion.div
          className="h-full w-full origin-left bg-accent"
          animate={{ scaleX: progress }}
          transition={{ type: "tween", duration: 0.25 }}
        />
      </div>

      {/* relative z-20: backdrop-blur-xl gives this row its own stacking
          context (per spec, any non-"none" filter/backdrop-filter does),
          but with no explicit z-index it still only paints at DOM-order
          level within its own parent - the content pane below it comes
          LATER in that DOM order, so without this it would paint on top
          of any dropdown here (e.g. DisplaySettingsMenu's popover) wherever
          the dropdown extends past the header's own box. */}
      <div
        className="relative z-20 flex items-center justify-between gap-2 border-b border-border bg-surface/70 px-3 py-2.5 backdrop-blur-xl"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 0.625rem)" }}
      >
        <button
          type="button"
          onClick={onExit}
          aria-label="Back to library"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground active:scale-90"
        >
          <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden="true">
            <path d="M15 5l-7 7 7 7" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        <p className="min-w-0 flex-1 truncate text-center text-xs font-medium text-muted-foreground">{title}</p>

        <div className="flex shrink-0 items-center gap-1.5">{controls}</div>
      </div>

      {/* min-h-0 overrides the flex item's default min-height:auto - without
          it, a tall inner scroll area (PDF canvas, long pasted text) forces
          this box to grow past its allotted flex space instead of clipping,
          which both breaks its own inner overflow-auto scrolling AND pushes
          any viewport-relative absolutely-positioned overlay (e.g. the PDF
          zoom pill) off past the bottom of the real viewport. */}
      <div className="relative min-h-0 flex-1">
        {loading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-background">
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
              className="h-7 w-7 rounded-full border-2 border-border border-t-accent"
            />
          </div>
        )}
        {children}
      </div>

      {/* Last child, z-50: the filter has to sit over the header AND over
          anything a reader view renders into the pane above (the definition
          sheet is a z-40 fixed layer inside those children), so it is the top
          of this stacking context by DOM order as well as by z-index. Renders
          nothing at all while the filter is off. */}
      <EyeFilterOverlay />
    </div>
  );
}

export type ReaderStateIcon = "scan" | "lock" | "file";

// Stroked, currentColor, same weight as the chrome's own icons.
const STATE_ICON_PATHS: Record<ReaderStateIcon, React.ReactNode> = {
  // A framed picture: the pages of this PDF are images, not words.
  scan: (
    <>
      <rect x="3" y="4.5" width="18" height="15" rx="2.5" />
      <path d="M3.5 16.5l4.3-4.3a2 2 0 0 1 2.8 0l4.4 4.4" />
      <circle cx="15.6" cy="9.2" r="1.5" />
    </>
  ),
  lock: (
    <>
      <rect x="4.5" y="10.5" width="15" height="9.5" rx="2.5" />
      <path d="M8 10.5V7.6a4 4 0 0 1 8 0v2.9" />
    </>
  ),
  file: (
    <>
      <path d="M6.5 3.5h6.8L18.5 9v11.5h-12z" />
      <path d="M13 3.5V9h5.5" />
    </>
  ),
};

/** Full-bleed terminal state for a book that can't be read: a missing file, a
 * locked PDF, a scan with no text layer.
 *
 * `fixed inset-0` deliberately, matching ReaderChrome: these render INSTEAD of
 * the reader, and without it the message stranded itself mid-layout in whatever
 * page rendered the reader.
 *
 * `action` exists for states that are a judgement rather than a fact - "almost
 * no text in here" is a heuristic, so the reader is always allowed to overrule
 * it rather than being left at a dead end. */
export function ReaderErrorState({
  message,
  onExit,
  title,
  context,
  icon = "file",
  action,
}: {
  message: string;
  onExit: () => void;
  title?: string;
  /** The book this is about. Worth showing: the state replaces the whole
   * reader, so without it someone with six PDFs open in a session cannot tell
   * which one just refused to open. */
  context?: string;
  icon?: ReaderStateIcon;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="fixed inset-0 z-40 flex flex-col items-center justify-center bg-background px-8 text-center">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
        className="flex flex-col items-center gap-5"
      >
        {context && (
          <p className="max-w-[17rem] truncate text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">
            {context}
          </p>
        )}

        <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-border bg-surface text-muted-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.6}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-6 w-6"
            aria-hidden="true"
          >
            {STATE_ICON_PATHS[icon]}
          </svg>
        </div>

        <div className="flex max-w-sm flex-col gap-2">
          {title && (
            <h2 className="text-base font-semibold tracking-tight text-foreground">{title}</h2>
          )}
          <p className="text-pretty text-sm leading-relaxed text-muted-foreground">{message}</p>
        </div>

        <div className="flex flex-col items-stretch gap-1.5">
          {action && (
            <button
              type="button"
              onClick={action.onClick}
              className="rounded-full bg-accent px-6 py-2.5 text-sm font-semibold text-accent-foreground transition-transform active:scale-[0.97]"
            >
              {action.label}
            </button>
          )}
          <button
            type="button"
            onClick={onExit}
            className={
              action
                ? "rounded-full px-6 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
                : "rounded-full bg-accent px-6 py-2.5 text-sm font-semibold text-accent-foreground transition-transform active:scale-[0.97]"
            }
          >
            Back to library
          </button>
        </div>
      </motion.div>
    </div>
  );
}
