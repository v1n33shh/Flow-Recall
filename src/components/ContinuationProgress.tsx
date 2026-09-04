"use client";

import type { ContinuousProgress } from "@/lib/ingestChunks";

/** Live state of a continuous continuation, on the deck's own card.
 *
 * A run can last twenty minutes and contain several 62-second rate-limit waits, so
 * a spinner is not enough: this says which section, how many cards have actually
 * been saved, and what it is waiting for when it is waiting. `progress` is
 * momentarily undefined between the tap and the runner's first tick. */
export default function ContinuationProgress({
  progress,
  onStop,
}: {
  progress: ContinuousProgress | undefined;
  onStop: () => void;
}) {
  const current = progress?.currentSection ?? 1;
  const total = Math.max(1, progress?.totalSections ?? 1);
  const stopping = progress?.stopping ?? false;
  // The gap between the tap and the runner's first tick. Both counts fall back to 1
  // there, which read "section 1 of 1" above a bar filled to 100% at the start of a
  // 386-section run - briefly, but wrong in the one direction that matters, since the
  // whole point of the bar is telling a student how much is left.
  const started = progress !== undefined;

  return (
    <div className="mt-2">
      <p className="text-sm font-medium text-foreground">
        {started ? `Generating section ${current} of ${total}...` : "Starting..."}
      </p>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {progress?.cardsSoFar ?? 0} {progress?.cardsSoFar === 1 ? "card" : "cards"} so far
        {stopping ? " · finishing this section" : ""}
      </p>
      {progress?.waitingReason && (
        <p className="mt-0.5 text-xs text-muted-foreground">{progress.waitingReason}</p>
      )}
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-foreground/10">
        <div
          className="h-full bg-accent transition-all"
          style={{ width: started ? `${Math.round((current / total) * 100)}%` : "0%" }}
        />
      </div>
      <button
        type="button"
        onClick={onStop}
        disabled={stopping}
        className="mt-2 rounded-full border border-border bg-transparent px-4 py-2.5 text-sm font-medium text-foreground transition-all duration-200 hover:bg-foreground/10 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {stopping ? "Finishing this section..." : "Stop"}
      </button>
    </div>
  );
}
