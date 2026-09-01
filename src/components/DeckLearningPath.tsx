"use client";

import { useMemo, useState } from "react";
import type { MasteryLevel } from "@/lib/recallModel";
import type { Concept, ConceptEdge } from "@/lib/types";
import { learningPath, validateEdges } from "@/lib/conceptGraph";
import { MAP_BATCH_SIZE } from "@/lib/conceptGraphSchema";
import { factSentence } from "@/lib/conceptProse";
import { API_FETCH_CREDENTIALS, apiUrl } from "@/lib/apiUrl";
import { saveConceptMap, useSavedDecks } from "@/lib/storage";
import { vibrateTap } from "@/lib/haptics";

/** The order to learn a deck in, and the one control that produces it.
 *
 * Mapping is a separate pass over a FINISHED deck rather than part of ingest,
 * because ingest is handed 1500 characters at a time and never sees two chunks at
 * once - so it could not relate a concept from chunk 1 to one from chunk 7, and it
 * would leave every deck the student already owns unmapped forever.
 *
 * The map is stored on the deck row and therefore syncs like any other deck edit,
 * so mapping on a phone shows up on a laptop without paying for it twice. */

type MapState = { busy: boolean; error: string | null; limitReached: boolean };

export type ConceptMap = MapState & {
  /** `null` means never mapped, which is NOT the same as an empty map - a deck whose
   * ideas genuinely do not relate is a real answer and has to look different from
   * one nobody has asked about yet. */
  edges: readonly ConceptEdge[] | null;
  run: () => Promise<void>;
};

export function useConceptMap(deckId: string, concepts: readonly Concept[]): ConceptMap {
  const decks = useSavedDecks();
  const stored = decks.find((deck) => deck.id === deckId)?.conceptMap;
  const [state, setState] = useState<MapState>({ busy: false, error: null, limitReached: false });

  async function run() {
    if (concepts.length < 2) return;
    setState({ busy: true, error: null, limitReached: false });

    // Every label in the deck goes with every batch, so a relationship that crosses
    // a batch boundary is still expressible. Labels are 2-6 words; this is cheap.
    const allLabels = [...new Set(concepts.map((c) => c.concept.trim()).filter(Boolean))];
    const raw: { from: string; to: string; relation: string }[] = [];

    try {
      for (let start = 0; start < concepts.length; start += MAP_BATCH_SIZE) {
        const batch = concepts.slice(start, start + MAP_BATCH_SIZE);
        const response = await fetch(apiUrl("/api/concept-map"), {
          method: "POST",
          headers: { "content-type": "application/json" },
          credentials: API_FETCH_CREDENTIALS,
          body: JSON.stringify({
            batch: batch.map((c) => ({ label: c.concept, fact: factSentence(c) ?? c.answer })),
            allLabels,
            // One mapping costs one lookup however many passes it takes.
            first: start === 0,
          }),
        });
        const data = await response.json().catch(() => null);

        if (response.status === 403 && data?.error === "LIMIT_REACHED") {
          setState({ busy: false, error: null, limitReached: true });
          return;
        }
        if (!response.ok) throw new Error(data?.error || `map failed: ${response.status}`);
        raw.push(...(Array.isArray(data?.edges) ? data.edges : []));
      }

      // Validated once over every batch's output rather than per batch, so a
      // relationship asserted twice across two passes collapses to one edge.
      saveConceptMap(deckId, validateEdges(raw, concepts));
      setState({ busy: false, error: null, limitReached: false });
    } catch (error) {
      console.error("concept map failed", error);
      setState({ busy: false, error: "Could not map this deck. Please try again.", limitReached: false });
    }
  }

  return { edges: stored ?? null, ...state, run };
}

export default function DeckLearningPath({
  concepts,
  map,
  labelOf,
  levelOf,
  onJump,
}: {
  concepts: readonly Concept[];
  map: ConceptMap;
  labelOf: (id: string) => string | null;
  levelOf: (id: string) => MasteryLevel | null;
  onJump: (id: string) => void;
}) {
  const { edges, busy, error, limitReached, run } = map;

  const path = useMemo(() => {
    if (!edges || !edges.some((e) => e.relation === "prerequisite")) return [];
    return learningPath(
      concepts.map((c) => c.id),
      edges,
    );
  }, [concepts, edges]);

  if (concepts.length < 2) return null;

  return (
    <section className="mt-6 rounded-2xl border border-border bg-surface/60 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] md:backdrop-blur-xl">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
        {path.length > 0 ? "Learning path" : "How this deck fits together"}
      </p>

      {path.length > 0 ? (
        <>
          <p className="mt-1 text-xs text-muted-foreground">
            Prerequisites first, then what they unlock.
          </p>
          <ol className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5">
            {path.map((id, index) => {
              const level = levelOf(id);
              return (
                <li key={id} className="min-w-0">
                  <button
                    type="button"
                    onClick={() => {
                      vibrateTap();
                      onJump(id);
                    }}
                    className="flex w-full min-w-0 items-center gap-1.5 rounded-lg px-1 py-0.5 text-left transition-colors duration-200 active:bg-foreground/10"
                  >
                    <span className="shrink-0 text-[10px] font-semibold tabular-nums text-muted-foreground">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <span
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                        level === "solid"
                          ? "bg-accent"
                          : level === "fading"
                            ? "bg-pending"
                            : "bg-foreground/20"
                      }`}
                      aria-hidden
                    />
                    <span className="truncate text-[11px] font-medium text-foreground">
                      {labelOf(id)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </>
      ) : (
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
          {edges === null
            ? "Answering every card still leaves you unable to say how any two of these ideas connect. One pass over the whole deck works out what has to be understood first, what explains what, and which pairs get mixed up."
            : edges.length === 0
              ? "We looked, and this deck's ideas do not lean on each other in a way worth drawing. Each concept stands on its own."
              : "Nothing here has to be learnt before anything else, but some concepts do explain or get confused with others - see the cards below."}
        </p>
      )}

      {limitReached ? (
        <p className="mt-3 text-sm leading-relaxed text-pending">
          You&apos;ve used all your free AI lookups. Pro maps as many decks as you like.
        </p>
      ) : (
        <button
          type="button"
          onClick={() => {
            vibrateTap();
            void run();
          }}
          disabled={busy}
          className={`mt-4 rounded-full px-4 py-2 text-xs font-semibold transition-all duration-200 active:scale-[0.98] ${
            edges === null
              ? "bg-accent text-accent-foreground ring-1 ring-inset ring-accent/30 shadow-[inset_0_1px_0_rgba(255,255,255,0.15),0_8px_24px_-6px_rgba(0,0,0,0.4)] hover:bg-accent/90"
              : "border border-border bg-foreground/5 text-muted-foreground hover:bg-foreground/10"
          } disabled:opacity-60`}
        >
          {busy
            ? "Working out the connections…"
            : edges === null
              ? "Map this deck"
              : "Map again"}
        </button>
      )}

      {edges === null && !busy && !limitReached && (
        <p className="mt-2 text-[11px] text-muted-foreground">One AI pass over the whole deck.</p>
      )}
      {error && <p className="mt-2 text-[11px] text-danger">{error}</p>}
    </section>
  );
}
