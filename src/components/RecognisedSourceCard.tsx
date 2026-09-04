"use client";

import type { Deck } from "@/lib/types";
import type { ContinuousProgress } from "@/lib/ingestChunks";

/** How long ago, in the words a student would use. Relative while that is the more
 * useful answer, then the same short date the library shows. */
function lastTouchedLabel(timestamp: number): string {
  const days = Math.floor((Date.now() - timestamp) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  return new Date(timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Shown when an upload turns out to be a source the student has already made cards
 * from - the alternative to silently adding a second copy of their book to the
 * library, which is what this screen did before.
 *
 * Nothing here has spent anything yet. handleGenerate returns before chunking when
 * it finds a match, so every request in this flow is behind one of these buttons. */
export default function RecognisedSourceCard({
  deck,
  allowance,
  continuing,
  progress,
  onContinue,
  onStop,
  onStartSeparate,
  onStudy,
}: {
  deck: Deck;
  allowance: { remaining: number; limit: number } | null;
  continuing: boolean;
  progress: ContinuousProgress | null;
  onContinue: () => void;
  onStop: () => void;
  onStartSeparate: () => void;
  onStudy: () => void;
}) {
  const sectionsLeft = deck.pendingChunks?.length ?? 0;
  const finished = sectionsLeft === 0;

  return (
    <div className="mt-4 overflow-hidden rounded-2xl border border-accent/30 bg-gradient-to-br from-accent/10 via-surface to-surface p-6 shadow-lg shadow-accent/5">
      <span className="text-xs font-bold uppercase tracking-widest text-accent">
        ✦ You&apos;ve studied this before
      </span>
      <p className="mt-3 text-lg font-semibold text-foreground">{deck.title}</p>
      {/* Hidden while a run is going, because it cannot keep up with one: the deck is
          rewritten every batch and this line is a snapshot taken when the card
          appeared. The progress block below is the live count. */}
      {!continuing && (
        <p className="mt-1.5 text-sm text-muted-foreground">
          {finished
            ? `Fully generated · ${deck.concepts.length} cards`
            : `${deck.concepts.length} cards · ${sectionsLeft} ${sectionsLeft === 1 ? "section" : "sections"} left`}
          {" · last added "}
          {lastTouchedLabel(deck.updatedAt ?? deck.createdAt)}
        </p>
      )}

      {/* What one tap will actually be able to finish. Continuous generation makes it
          easy to spend a month's allowance without meaning to, and being stopped
          part-way through a twenty-minute run is a worse way to learn this number.
          Omitted entirely when unknown rather than guessed. */}
      {!continuing && !finished && allowance && (
        <p className="mt-1 text-sm text-muted-foreground">
          {allowance.remaining === 0
            ? "You've used this month's generation allowance - it resets at the start of next month."
            : allowance.remaining < sectionsLeft
              ? `Your plan allows ${allowance.remaining} more ${allowance.remaining === 1 ? "section" : "sections"} this month, so this won't finish the book in one go.`
              : `Your plan allows ${allowance.remaining} more sections this month - enough to finish this.`}
        </p>
      )}

      {continuing && progress ? (
        <>
          <p className="mt-4 text-sm font-medium text-foreground">
            Generating section {progress.currentSection} of {progress.totalSections}...
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {progress.cardsSoFar} {progress.cardsSoFar === 1 ? "card" : "cards"} so far
            {progress.stopping ? " · finishing this section" : ""}
          </p>
          {/* The rate-limit wait, surfaced for the same reason /ingest surfaces it:
              a 62-second pause with nothing on screen reads as a hang, and this run
              can contain many of them. */}
          {progress.waitingReason && (
            <p className="mt-1 text-xs text-muted-foreground">{progress.waitingReason}</p>
          )}
          <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-foreground/10">
            <div
              className="h-full bg-accent transition-all"
              style={{
                width: `${Math.round((progress.currentSection / Math.max(1, progress.totalSections)) * 100)}%`,
              }}
            />
          </div>
          <button
            type="button"
            onClick={onStop}
            disabled={progress.stopping}
            className="mt-4 inline-flex items-center justify-center rounded-full border border-border bg-transparent px-6 py-3 text-sm font-semibold text-foreground transition-all duration-200 hover:bg-foreground/10 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {progress.stopping ? "Finishing this section..." : "Stop"}
          </button>
        </>
      ) : (
        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
          <button
            type="button"
            onClick={finished ? onStudy : onContinue}
            className="inline-flex items-center justify-center rounded-full bg-accent px-6 py-3 text-sm font-semibold text-accent-foreground ring-1 ring-inset ring-accent/30 shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_8px_28px_-6px_rgba(0,0,0,0.45)] transition-all duration-200 hover:bg-accent/90 active:scale-[0.98]"
          >
            {finished ? "Study this deck →" : "Continue this deck"}
          </button>
          <button
            type="button"
            onClick={onStartSeparate}
            className="text-sm font-medium text-muted-foreground underline decoration-muted-foreground/40 underline-offset-4 transition-colors hover:text-foreground"
          >
            Start a separate deck
          </button>
        </div>
      )}
    </div>
  );
}
