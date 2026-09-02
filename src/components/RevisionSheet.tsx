"use client";

import { startTransition, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import { useSession } from "next-auth/react";
import type { Concept } from "@/lib/types";
import { factSentence, readableBody } from "@/lib/conceptProse";
import { deckMastery, type DeckMastery } from "@/lib/recallStorage";
import { unitIdFor, type MasteryLevel } from "@/lib/recallModel";
import { setStudyDeck, useSavedDecks } from "@/lib/storage";
import { vibrateTap } from "@/lib/haptics";
import ConceptAsk from "./ConceptAsk";
import ConceptEditor from "./ConceptEditor";
import ConceptRelations from "./ConceptRelations";
import ConceptTeachBack from "./ConceptTeachBack";
import DeckLearningPath, { useConceptMap } from "./DeckLearningPath";

/** Read the deck instead of answering it.
 *
 * Every concept the generator produces already carries a full explanation
 * paragraph, and until now the only way to reach one was to answer that card and
 * then look at the debrief. So the app could test a student on material it had
 * never let them study. This is that material, as continuous prose, in deck
 * order, with the engine's own view of what has stuck marked against each item.
 *
 * Deliberately no new generation and no AI call: `explanation` is already there,
 * and `factSentence` turns the cloze back into the statement it was cut from. */

type Filter = "all" | "needs-work" | "solid";

const LEVEL_LABEL: Record<MasteryLevel, string> = {
  met: "Met",
  familiar: "Familiar",
  holding: "Holding",
  solid: "Solid",
  fading: "Fading",
};

/** `--pending` and `--accent` rather than raw Tailwind colours, so both invert
 * with the theme. globals.css scopes success/danger/pending to answer-correctness
 * feedback in the study feed; this is that feed's own reading surface and a
 * fading concept is the one thing on the page worth interrupting for, which is
 * exactly what the token is for. Everything else stays achromatic. */
const LEVEL_CHIP: Record<MasteryLevel, string> = {
  solid: "border-accent/40 bg-accent/10 text-accent",
  fading: "border-pending/40 bg-pending/10 text-pending",
  holding: "border-border bg-foreground/5 text-muted-foreground",
  familiar: "border-border bg-foreground/5 text-muted-foreground",
  met: "border-border bg-foreground/5 text-muted-foreground",
};

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "needs-work", label: "Needs work" },
  { id: "solid", label: "Solid" },
];

export default function RevisionSheet({
  deckId,
  title,
  concepts: handedOff,
}: {
  deckId: string;
  title: string;
  /** The deck as the study handoff had it. Used only until the live deck row is
   * readable - see `concepts` below. */
  concepts: Concept[];
}) {
  const router = useRouter();
  const { data: session } = useSession();
  const userId = session?.user?.id;

  const [mastery, setMastery] = useState<DeckMastery | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [editing, setEditing] = useState<string | null>(null);

  // Read from the live deck row rather than the handoff prop, so a card corrected or
  // deleted below appears corrected or deleted immediately. useSavedDecks is a
  // useSyncExternalStore over the same localStorage the mutations write, so this
  // needs no event of its own. Falls back to the handoff for the first render, where
  // the server snapshot is empty.
  const savedDecks = useSavedDecks();
  const concepts = savedDecks.find((deck) => deck.id === deckId)?.concepts ?? handedOff;

  // Re-read on the engine's own event, so finishing a session and coming back
  // here shows the new state without a reload. Signed out, this simply never
  // runs and the sheet renders as plain material - which is the right degradation,
  // since the reading half of this page needs no account at all.
  useEffect(() => {
    if (!userId) return;
    let alive = true;
    const read = () => {
      void deckMastery(userId, deckId)
        .then((m) => { if (alive) setMastery(m); })
        .catch((error) => console.error("deckMastery failed", error));
    };
    read();
    window.addEventListener("recall-engine-update", read);
    return () => {
      alive = false;
      window.removeEventListener("recall-engine-update", read);
    };
  }, [userId, deckId]);

  function levelForId(conceptId: string): MasteryLevel | null {
    return mastery?.byUnit.get(unitIdFor(deckId, conceptId))?.level ?? null;
  }

  function levelOf(concept: Concept): MasteryLevel | null {
    return levelForId(concept.id);
  }

  const map = useConceptMap(deckId, concepts);
  const labelById = useMemo(
    () => new Map(concepts.map((concept) => [concept.id, concept.concept])),
    [concepts],
  );
  const labelOf = (conceptId: string) => labelById.get(conceptId) ?? null;

  const visible = concepts.filter((concept) => {
    if (filter === "all") return true;
    const level = levelOf(concept);
    // With no engine record yet, a concept has not been shown to be solid - so it
    // belongs under "needs work" and not under "solid". Erring the other way would
    // quietly hide unstudied material from the filter a student uses to revise.
    if (filter === "solid") return level === "solid";
    return level !== "solid";
  });

  /** Scrolls a related concept into view.
   *
   * `block: "center"` rather than the default: the sticky glass header owns the top
   * of the viewport and would sit over a concept aligned to it.
   *
   * The filter is the trap here. A chip can point at a concept the current filter is
   * hiding, and `scrollIntoView` on an element React has not rendered does nothing
   * at all - a tap that silently accomplishes nothing. So drop the filter first, and
   * scroll only once the row is actually back on the page. */
  function jumpTo(conceptId: string) {
    const scroll = () =>
      document
        .getElementById(`concept-${conceptId}`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });

    const target = concepts.find((concept) => concept.id === conceptId);
    if (target && !visible.includes(target)) {
      setFilter("all");
      // Two frames, not one: the first is the render that puts the row back, and the
      // element only exists to be scrolled to in the frame after it.
      requestAnimationFrame(() => requestAnimationFrame(scroll));
      return;
    }
    scroll();
  }

  function handleStudy() {
    vibrateTap();
    setStudyDeck(deckId, concepts);
    startTransition(() => router.push("/study"));
  }

  const summary = mastery?.summary;

  return (
    <main className="mx-auto w-full max-w-2xl px-5 pb-16 sm:px-6">
      {/* Sticky glass header. The primary CTA lives up here rather than in a
          floating footer on purpose: MobileTabBar is fixed at z-50 and renders
          after page content, so anything anchored to the bottom has to outrank it
          and this app has already lost a release to exactly that collision. */}
      <div className="sticky top-0 z-10 -mx-5 border-b border-border bg-background/80 px-5 pb-3.5 pt-4 backdrop-blur-xl sm:-mx-6 sm:px-6">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          Revision sheet
        </p>
        {/* The title gets the full width and wraps. Sharing a row with the CTA
            truncated a four-word deck name to "Cardiac cycle - lec…" on the
            device, which is the one thing on the page a student needs to
            recognise at a glance. */}
        <h1 className="mt-0.5 line-clamp-2 text-xl font-semibold leading-tight tracking-tight text-foreground">
          {title}
        </h1>

        <div className="mt-2 flex items-center justify-between gap-3">
          <p className="min-w-0 truncate text-xs text-muted-foreground tabular-nums">
            {concepts.length} concept{concepts.length === 1 ? "" : "s"}
            {summary && summary.units > 0 && (
              <>
                {" · "}
                <span className="text-accent">{summary.solid} solid</span>
                {summary.fading > 0 && (
                  <>
                    {" · "}
                    <span className="text-pending">{summary.fading} fading</span>
                  </>
                )}
              </>
            )}
          </p>
          <button
            type="button"
            onClick={handleStudy}
            className="shrink-0 rounded-full bg-accent px-4 py-2 text-xs font-semibold text-accent-foreground ring-1 ring-inset ring-accent/30 shadow-[inset_0_1px_0_rgba(255,255,255,0.15),0_8px_24px_-6px_rgba(0,0,0,0.4)] transition-all duration-200 hover:bg-accent/90 active:scale-[0.98]"
          >
            Study this deck
          </button>
        </div>

        <div className="mt-3 flex gap-2">
          {FILTERS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              onClick={() => {
                vibrateTap();
                setFilter(id);
              }}
              aria-pressed={filter === id}
              className={`rounded-full border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-widest transition-all duration-200 active:scale-[0.98] ${
                filter === id
                  ? "border-accent/30 bg-accent text-accent-foreground ring-1 ring-inset ring-accent/30"
                  : "border-border bg-foreground/5 text-muted-foreground hover:bg-foreground/10"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <DeckLearningPath
        concepts={concepts}
        map={map}
        labelOf={labelOf}
        levelOf={levelForId}
        onJump={jumpTo}
      />

      {visible.length === 0 ? (
        <p className="mt-10 text-center text-sm text-muted-foreground">
          {filter === "solid"
            ? "Nothing is solid yet. A concept turns solid once you've answered it two different ways, including once after a week away."
            : "Everything here is solid. Nothing needs work right now."}
        </p>
      ) : (
        <ol className="mt-6 space-y-4">
          {visible.map((concept, index) => {
            const level = levelOf(concept);
            const fact = factSentence(concept);
            const body = readableBody(concept);
            // Only when the fact sentence is usable AND is not itself standing in
            // as the body, or the same words print twice.
            const showFact = fact !== null && fact !== body;

            return (
              <motion.li
                key={concept.id}
                id={`concept-${concept.id}`}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  type: "spring",
                  stiffness: 280,
                  damping: 24,
                  // Caps at ~0.2s: a 60-concept deck must not spend twelve seconds
                  // staggering itself in.
                  delay: Math.min(index * 0.03, 0.2),
                }}
                className="rounded-2xl border border-border bg-surface/60 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] md:backdrop-blur-xl"
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="flex min-w-0 items-baseline gap-2">
                    <span className="text-[10px] font-semibold tabular-nums text-muted-foreground">
                      {String(concepts.indexOf(concept) + 1).padStart(2, "0")}
                    </span>
                    <span className="truncate text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                      {concept.concept}
                    </span>
                  </p>
                  {level && (
                    <span
                      className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest ${LEVEL_CHIP[level]}`}
                    >
                      {LEVEL_LABEL[level]}
                    </span>
                  )}
                </div>

                {showFact && (
                  <p className="mt-3 text-base font-medium leading-snug text-foreground">{fact}</p>
                )}
                <p className={`text-sm leading-relaxed text-muted-foreground ${showFact ? "mt-2" : "mt-3"}`}>
                  {body}
                </p>

                {concept.whyItMatters && (
                  <p className="mt-3 border-t border-border pt-3 text-sm leading-relaxed text-foreground">
                    {concept.whyItMatters}
                  </p>
                )}

                {/* Where this concept sits among the others. Below the material and
                    above the provenance, because it is only worth asking how an idea
                    connects once you have read what the idea is. */}
                {map.edges && (
                  <ConceptRelations
                    conceptId={concept.id}
                    edges={map.edges}
                    labelOf={labelOf}
                    levelOf={levelForId}
                    onJump={jumpTo}
                  />
                )}

                {/* The sentence this card came from. Provenance is what stops a
                    revision sheet reading as trivia: it is the student's own
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

                {/* Reading is where a question actually forms - the explanation is
                    right there and either it landed or it did not. Asking comes
                    first and explaining back second, because that is the order a
                    student uses them in: understand it, then find out whether you
                    actually do. */}
                <ConceptAsk unitId={unitIdFor(deckId, concept.id)} concept={concept} />
                <ConceptTeachBack unitId={unitIdFor(deckId, concept.id)} concept={concept} />

                {/* Last, because correcting a card is the rarest thing done here and
                    the most destructive - but a real bordered control rather than
                    something revealed on hover, which does not exist on a phone. */}
                {editing === concept.id ? (
                  <ConceptEditor
                    deckId={deckId}
                    concept={concept}
                    userId={userId}
                    onDone={() => setEditing(null)}
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      vibrateTap();
                      setEditing(concept.id);
                    }}
                    className="mt-3 rounded-full border border-border bg-foreground/5 px-3 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors duration-200 active:bg-foreground/10"
                  >
                    Fix this card
                  </button>
                )}
              </motion.li>
            );
          })}
        </ol>
      )}
    </main>
  );
}
