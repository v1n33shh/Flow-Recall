"use client";

const DEFAULT_MIN = 80;
const DEFAULT_MAX = 160;
const DEFAULT_STEP = 10;

/** Self-contained A-/A+ text-size control, shared by EpubReaderView and
 * TextReaderView (PDF uses zoom instead - font size on a fixed-layout page
 * doesn't map the same way). */
export default function FontSizeStepper({
  percent,
  onChange,
  min = DEFAULT_MIN,
  max = DEFAULT_MAX,
  step = DEFAULT_STEP,
}: {
  percent: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <div className="flex shrink-0 items-center gap-0.5 rounded-full border border-white/10 bg-white/5 p-0.5">
      <button
        type="button"
        aria-label="Decrease text size"
        onClick={() => onChange(Math.max(min, percent - step))}
        disabled={percent <= min}
        className="flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold text-zinc-300 transition-colors hover:bg-white/10 active:scale-90 disabled:opacity-30"
      >
        A-
      </button>
      <button
        type="button"
        aria-label="Increase text size"
        onClick={() => onChange(Math.min(max, percent + step))}
        disabled={percent >= max}
        className="flex h-7 w-7 items-center justify-center rounded-full text-sm font-semibold text-zinc-300 transition-colors hover:bg-white/10 active:scale-90 disabled:opacity-30"
      >
        A+
      </button>
    </div>
  );
}
