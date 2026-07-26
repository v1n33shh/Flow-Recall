"use client";

import { motion } from "motion/react";

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
      {/* Fine top-of-viewport progress bar, Chrome-tab-load style. */}
      <div className="absolute inset-x-0 top-0 z-30 h-[3px] bg-white/5">
        <motion.div
          className="h-full bg-accent"
          animate={{ width: `${progress * 100}%` }}
          transition={{ type: "tween", duration: 0.25 }}
        />
      </div>

      <div
        className="flex items-center justify-between gap-2 border-b border-white/10 bg-surface/70 px-3 py-2.5 backdrop-blur-xl"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 0.625rem)" }}
      >
        <button
          type="button"
          onClick={onExit}
          aria-label="Back to library"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-zinc-400 transition-colors hover:bg-white/10 hover:text-zinc-200 active:scale-90"
        >
          <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden="true">
            <path d="M15 5l-7 7 7 7" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        <p className="min-w-0 flex-1 truncate text-center text-xs font-medium text-zinc-400">{title}</p>

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
              className="h-7 w-7 rounded-full border-2 border-white/15 border-t-accent"
            />
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

export function ReaderErrorState({ message, onExit }: { message: string; onExit: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 bg-background px-6 text-center">
      <p className="text-sm text-zinc-400">{message}</p>
      <button
        type="button"
        onClick={onExit}
        className="rounded-full border border-white/10 bg-white/5 px-5 py-2 text-sm font-medium text-zinc-300 transition-colors hover:bg-white/10"
      >
        Back to library
      </button>
    </div>
  );
}
