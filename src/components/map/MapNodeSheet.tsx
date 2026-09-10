"use client";

import { useEffect, useRef } from "react";
import type { MasteryLevel } from "@/lib/recallModel";
import { unitIdFor } from "@/lib/recallModel";
import type { Concept, ConceptEdge } from "@/lib/types";
import { factSentence, readableBody } from "@/lib/conceptProse";
import { prerequisiteChain } from "@/lib/conceptGraph";
import ConceptAsk from "@/components/ConceptAsk";
import ConceptRelations from "@/components/ConceptRelations";
import { vibrateTap } from "@/lib/haptics";

/** Everything the deck knows about one concept, in the order understanding is built.
 *
 * This panel used to show a single sentence, and that was the whole reason the map was
 * hard to learn from: the generator is told, in buildConceptsPrompt's own words, that
 * `explanation` "must be a rich 3-4 sentence paragraph" and to "never write a short
 * phrase" - and then this threw the paragraph away, along with the misconception, the
 * source quote and the reason any of it matters. A student who tapped a node got
 * strictly less than the same concept gives them anywhere else in the app.
 *
 * Nothing here is new material. Every section renders a field the deck already carries
 * or a component the revision sheet already uses; the only new thing is the ORDER,
 * which is the order a person actually needs them in - what it is, how it works, what
 * you need first, why you care, and what you are probably getting wrong.
 */

const LEVEL_COPY: Record<MasteryLevel, string> = {
  solid: "Solid",
  fading: "Fading",
  holding: "Holding",
  familiar: "Familiar",
  met: "Met once",
};

export default function MapNodeSheet({
  deckId,
  concept,
  concepts,
  edges,
  level,
  labelOf,
  levelOf,
  onJump,
  onRead,
  onClose,
}: {
  deckId: string;
  concept: Concept;
  concepts: readonly Concept[];
  edges: readonly ConceptEdge[];
  level: MasteryLevel | null;
  labelOf: (id: string) => string | null;
  levelOf: (id: string) => MasteryLevel | null;
  /** Moves the map's focus to another concept - the chips and the chain call this. */
  onJump: (id: string) => void;
  /** Opens the revision sheet at THIS concept, not at the top of the deck. */
  onRead: () => void;
  onClose: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);

  // The panel renders under the map, which on a phone is under the fold - so without
  // this a student taps a node and nothing appears to happen. Keyed on the concept, so
  // following a relation chip brings the new one into view too.
  useEffect(() => {
    box.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [concept.id]);

  const fact = factSentence(concept);
  const body = readableBody(concept);
  // Only when the one-liner is not itself standing in as the body, or the same words
  // print twice - the same guard the revision sheet applies.
  const showFact = fact !== null && fact !== body;

  const chain = prerequisiteChain(
    concept.id,
    concepts.map((c) => c.id),
    edges,
  );

  return (
    <div
      ref={box}
      className="mt-3 rounded-2xl border border-border bg-surface/70 p-4 md:backdrop-blur-xl"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold leading-snug text-foreground">
            {concept.concept}
          </h2>
          {level !== null && (
            <p className="mt-0.5 text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
              {LEVEL_COPY[level]}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => {
            vibrateTap();
            onClose();
          }}
          aria-label="Close"
          className="-mr-1.5 -mt-1.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-lg leading-none text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
        >
          &times;
        </button>
      </div>

      {showFact && (
        <p className="mt-3 text-base font-medium leading-snug text-foreground">{fact}</p>
      )}
      {/* The paragraph. This is the thing the panel existed without. */}
      <p className={`text-sm leading-relaxed text-muted-foreground ${showFact ? "mt-2" : "mt-3"}`}>
        {body}
      </p>

      {/* The route in, for a concept that did not land. Nothing a flashcard list can
          offer: it is the deck's own prerequisite edges, read backwards. */}
      {chain.length > 0 && (
        <div className="mt-4 rounded-xl border border-border bg-background/40 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            Understand these first
          </p>
          {/* No arrows between these, deliberately. They were there, and they were a
              lie: measured on the device, "Preload → Afterload → Contractility →
              Stroke volume" drew a sequence through three concepts that are SIBLINGS -
              all three are prerequisites of stroke volume and none of them has to come
              before another. The list is in learningPath order, which is a sensible
              order to read them in; asserting that it is a required one is exactly the
              class of invented relationship validateEdges exists to prevent. */}
          <ul className="mt-2 flex flex-wrap items-center gap-1.5">
            {chain.map((id) => (
              <li key={id}>
                <button
                  type="button"
                  onClick={() => {
                    vibrateTap();
                    onJump(id);
                  }}
                  className="rounded-full border border-border bg-foreground/5 px-2.5 py-1 text-[11px] font-medium text-foreground transition-colors active:bg-foreground/10"
                >
                  {labelOf(id)}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {concept.whyItMatters && (
        <p className="mt-3 border-t border-border pt-3 text-sm leading-relaxed text-foreground">
          {concept.whyItMatters}
        </p>
      )}

      {/* The wrong belief, named - and it sits directly above the "don't confuse" row
          it explains. Those two have never been shown together anywhere in this app,
          and together they are the most exam-relevant thing on the screen: the trap,
          and the concepts it is set between. */}
      {concept.misconception && (
        <div className="mt-3 rounded-xl border border-pending/30 bg-pending/5 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-pending">
            The trap
          </p>
          <p className="mt-1 text-sm leading-relaxed text-foreground">{concept.misconception}</p>
        </div>
      )}

      <ConceptRelations
        conceptId={concept.id}
        edges={edges}
        labelOf={labelOf}
        levelOf={levelOf}
        onJump={onJump}
      />

      {/* Provenance is what stops a map reading as trivia: it is the student's own
          material, and they can see that it is. */}
      {concept.sourceQuote && (
        <figure className="mt-3">
          <figcaption className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            From your material
          </figcaption>
          <blockquote className="mt-1.5 border-l-2 border-l-border pl-3 text-sm italic leading-relaxed text-muted-foreground">
            {concept.sourceQuote}
          </blockquote>
        </figure>
      )}

      {/* The move a student has when they have read all of the above and still do not
          follow it. Collapsed until tapped, renders nothing signed out, and spends a
          lookup only on an explicit ask - exactly as it does on the revision sheet. */}
      <ConceptAsk unitId={unitIdFor(deckId, concept.id)} concept={concept} />

      <button
        type="button"
        onClick={() => {
          vibrateTap();
          onRead();
        }}
        className="mt-4 inline-flex min-h-11 items-center rounded-full bg-accent px-5 text-sm font-semibold text-accent-foreground ring-1 ring-inset ring-accent/30 shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_8px_24px_-6px_rgba(0,0,0,0.4)] transition-all duration-200 hover:bg-accent/90 active:scale-[0.98]"
      >
        Read this concept
      </button>
    </div>
  );
}
