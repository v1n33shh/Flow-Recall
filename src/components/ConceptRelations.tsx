"use client";

import type { MasteryLevel } from "@/lib/recallModel";
import type { ConceptEdge } from "@/lib/types";
import { groupForConcept } from "@/lib/conceptGraph";
import { vibrateTap } from "@/lib/haptics";

/** How one concept sits among the others.
 *
 * The three rows a deck needs to stop being a flat pile of facts: what to build on
 * first, what this one explains, and what a student actually mixes it up with.
 * Answering every card in a deck leaves all three unanswered, and no flashcard app
 * answers them - which is the whole reason this exists.
 *
 * Chips are real buttons with visible borders, never hover-revealed: this ships on
 * a phone, where `hover:` does not exist, and the repo has already lost weeks to a
 * hover-only control the user could not reach.
 *
 * Renders nothing at all when a concept has no relationships. A concept that
 * genuinely stands alone should look like it does, not carry three empty rows. */

const ROW_LABEL = {
  prerequisites: "Build on first",
  explains: "This explains",
  contrasts: "Don't confuse",
} as const;

/** Only `solid` and `fading` earn a dot. The middle states are real but not
 * actionable in a chip this size, and a dot on every chip is a dot that says
 * nothing - whereas "the thing this depends on is fading" is worth the ink. */
const DOT: Partial<Record<MasteryLevel, string>> = {
  solid: "bg-accent",
  fading: "bg-pending",
};

export default function ConceptRelations({
  conceptId,
  edges,
  labelOf,
  levelOf,
  onJump,
}: {
  conceptId: string;
  edges: readonly ConceptEdge[];
  labelOf: (id: string) => string | null;
  levelOf: (id: string) => MasteryLevel | null;
  onJump: (id: string) => void;
}) {
  const groups = groupForConcept(conceptId, edges);
  const rows = (["prerequisites", "explains", "contrasts"] as const)
    // A related concept deleted from the deck since the map was made has no label,
    // so it is dropped here rather than rendering a blank chip.
    .map((key) => ({ key, ids: groups[key].filter((id) => labelOf(id) !== null) }))
    .filter((row) => row.ids.length > 0);

  if (rows.length === 0) return null;

  return (
    <div className="mt-3 space-y-2 border-t border-border pt-3">
      {rows.map(({ key, ids }) => (
        <div key={key} className="flex flex-wrap items-baseline gap-x-2 gap-y-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            {ROW_LABEL[key]}
          </span>
          {ids.map((id) => {
            const level = levelOf(id);
            const dot = level ? DOT[level] : undefined;
            return (
              <button
                key={id}
                type="button"
                onClick={() => {
                  vibrateTap();
                  onJump(id);
                }}
                className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border bg-foreground/5 px-2.5 py-1 text-[11px] font-medium text-foreground transition-colors duration-200 active:bg-foreground/10"
              >
                {dot && <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} aria-hidden />}
                <span className="truncate">{labelOf(id)}</span>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
