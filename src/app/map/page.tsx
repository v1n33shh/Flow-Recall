"use client";

import { startTransition, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { motion } from "motion/react";
import type { Concept, Deck } from "@/lib/types";
import { unitIdFor, type DeckMastery, type MasteryLevel } from "@/lib/recallModel";
import { deckMastery } from "@/lib/recallStorage";
import { keystone } from "@/lib/conceptGraph";
import { setReviseFocus, setStudyDeck, useSavedDecks, useStudyDeck } from "@/lib/storage";
import { useIsNative } from "@/lib/useIsNative";
import DeckLearningPath, { useConceptMap } from "@/components/DeckLearningPath";
import ConceptMapView from "@/components/map/ConceptMapView";
import MapNodeSheet from "@/components/map/MapNodeSheet";
import FilmGrain from "@/components/FilmGrain";
import { vibrateTap } from "@/lib/haptics";

/** The deck as a subject rather than a pile.
 *
 * Everything drawn here already existed: /api/concept-map has been generating
 * `prerequisite` / `explains` / `contrast` edges over finished decks, validateEdges
 * has been resolving them to concept ids, learningPath has been ordering them, and the
 * result has been syncing on the deck row - all of it rendered, until now, as a
 * numbered two-column list at the bottom of the revision sheet. This is the same data
 * with its shape restored, and it costs nothing new to run: mapping a deck spends one
 * AI lookup exactly as it always did, and looking at the result spends nothing.
 *
 * Static-export safe. The deck arrives through the same sessionStorage handoff
 * `/revise` uses rather than a `/map/[id]` segment, which `output: "export"` could not
 * prerender for ids that only exist in a student's own localStorage.
 */
export default function MapPage() {
  const router = useRouter();
  const decks = useSavedDecks();
  const handoff = useStudyDeck();
  const isNative = useIsNative();
  const { data: session } = useSession();
  const userId = session?.user?.id;

  // A tab is opened cold, with nothing handed over, far more often than it is reached
  // from a deck - so the picker is the default and the handoff is the shortcut.
  const [chosenId, setChosenId] = useState<string | null>(null);
  const deckId = chosenId ?? handoff?.deckId ?? null;
  const deck = decks.find((row) => row.id === deckId) ?? null;

  return (
    <main className="relative mx-auto flex w-full max-w-4xl flex-1 flex-col px-4 py-10 sm:px-6 sm:py-16">
      <FilmGrain />
      {!isNative && (
        <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
          <div className="absolute -top-32 left-1/2 h-72 w-72 -translate-x-1/2 rounded-full bg-foreground/5 blur-3xl md:h-[34rem] md:w-[34rem]" />
        </div>
      )}

      <header className="relative z-10">
        <h1 className="font-sans text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
          {deck ? deck.title : "Mindmap"}
        </h1>
        <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
          {deck
            ? "How these ideas hold each other up."
            : "Answering every card still leaves you unable to say how any two ideas connect. Pick a deck and see its shape."}
        </p>
        {deck && decks.length > 1 && (
          <button
            type="button"
            onClick={() => {
              vibrateTap();
              setChosenId(null);
            }}
            className="mt-3 text-sm font-medium text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
          >
            Choose another deck
          </button>
        )}
      </header>

      {deck ? (
        <DeckMap key={deck.id} deck={deck} userId={userId} router={router} />
      ) : (
        <DeckPicker decks={decks} onChoose={setChosenId} />
      )}
    </main>
  );
}

function DeckPicker({
  decks,
  onChoose,
}: {
  decks: readonly Deck[];
  onChoose: (id: string) => void;
}) {
  if (decks.length === 0) {
    return (
      <div className="relative z-10 mt-8 flex flex-col items-center rounded-2xl border border-dashed border-border px-6 py-16 text-center">
        <p className="text-base font-medium text-foreground">Nothing to map yet.</p>
        <p className="mt-1.5 max-w-xs text-sm text-muted-foreground">
          A map needs a deck with at least a couple of ideas in it to relate.
        </p>
        <Link
          href="/ingest"
          className="mt-6 inline-flex min-h-11 items-center rounded-full bg-accent px-5 text-sm font-semibold text-accent-foreground ring-1 ring-inset ring-accent/30 transition-all duration-200 hover:bg-accent/90 active:scale-[0.97]"
        >
          Make your first deck
        </Link>
      </div>
    );
  }

  return (
    <ul className="relative z-10 mt-6 flex flex-col gap-2">
      {decks.map((deck) => (
        <li key={deck.id}>
          <button
            type="button"
            onClick={() => {
              vibrateTap();
              onChoose(deck.id);
            }}
            className="flex w-full items-center justify-between gap-3 rounded-2xl border border-border bg-surface/60 px-4 py-3.5 text-left transition-transform hover:-translate-y-0.5 active:scale-[0.99] md:backdrop-blur-xl"
          >
            <span className="min-w-0">
              <span className="block truncate text-base font-semibold text-foreground">
                {deck.title}
              </span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                {deck.concepts.length} concept{deck.concepts.length === 1 ? "" : "s"}
                {/* Absent means never mapped, which is not the same as "no
                    relationships" - see Deck.conceptMap. Saying so here stops the
                    student picking a deck and meeting an offer they did not expect. */}
                {deck.conceptMap === undefined ? " · not mapped yet" : ""}
              </span>
            </span>
            <span aria-hidden className="shrink-0 text-muted-foreground">
              &rsaquo;
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function DeckMap({
  deck,
  userId,
  router,
}: {
  deck: Deck;
  userId: string | undefined;
  router: ReturnType<typeof useRouter>;
}) {
  const concepts = deck.concepts;
  const map = useConceptMap(deck.id, concepts);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mastery, setMastery] = useState<DeckMastery | null>(null);

  // Same read, same listener as RevisionSheet: the engine's answer for this deck,
  // refreshed whenever anything in it is answered.
  useEffect(() => {
    if (!userId) return;
    let alive = true;
    const read = () => {
      deckMastery(userId, deck.id)
        .then((m) => {
          if (alive) setMastery(m);
        })
        .catch((error) => console.error("deckMastery failed", error));
    };
    read();
    window.addEventListener("recall-engine-update", read);
    return () => {
      alive = false;
      window.removeEventListener("recall-engine-update", read);
    };
  }, [userId, deck.id]);

  const labelById = useMemo(
    () => new Map(concepts.map((c) => [c.id, c.concept])),
    [concepts],
  );
  const labelOf = (id: string) => labelById.get(id) ?? null;
  const levelOf = useMemo(
    () => (id: string): MasteryLevel | null =>
      mastery?.byUnit.get(unitIdFor(deck.id, id))?.level ?? null,
    [mastery, deck.id],
  );

  const edges = map.edges;

  /** The one concept worth fixing first. Signed out there is no memory to judge
   * against, so nothing is claimed - an unstudied deck where "everything is weak"
   * would name its first concept and mean nothing by it. */
  const weakest = useMemo(() => {
    if (!edges || !userId || mastery === null) return null;
    return keystone(
      concepts.map((c) => c.id),
      edges,
      (id) => levelOf(id) !== "solid",
    );
  }, [edges, concepts, levelOf, userId, mastery]);

  function readConcept(conceptId: string) {
    setReviseFocus(conceptId);
    setStudyDeck(deck.id, concepts);
    startTransition(() => router.push("/revise"));
  }

  const selected: Concept | null =
    concepts.find((concept) => concept.id === selectedId) ?? null;

  if (concepts.length < 2) {
    return (
      <p className="relative z-10 mt-8 rounded-2xl border border-dashed border-border px-6 py-12 text-center text-sm text-muted-foreground">
        A map needs at least two ideas to relate. This deck has {concepts.length}.
      </p>
    );
  }

  // Never mapped, or mapped and genuinely unrelated: both are handled by the control
  // that already exists for them, rather than by a second copy of it here.
  if (!edges || edges.length === 0) {
    return (
      <div className="relative z-10">
        <DeckLearningPath
          concepts={concepts}
          map={map}
          labelOf={labelOf}
          levelOf={levelOf}
          onJump={readConcept}
        />
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
      className="relative z-10 mt-6"
    >
      {/* The line that makes this a diagnosis rather than a diagram. Nothing else in
          this app can say it, because nothing else holds a dependency graph and a
          memory model at the same time. */}
      {weakest && (
        <button
          type="button"
          onClick={() => {
            vibrateTap();
            setSelectedId(weakest.id);
          }}
          className="mb-3 flex w-full items-center gap-3 rounded-2xl border border-border bg-surface/60 px-4 py-3 text-left transition-colors hover:bg-surface md:backdrop-blur-xl"
        >
          <span className="h-2 w-2 shrink-0 rounded-full bg-pending shadow-[0_0_8px_2px_hsl(var(--pending)/0.5)]" />
          <span className="min-w-0 text-sm text-foreground">
            <span className="font-semibold">{labelOf(weakest.id)}</span> needs work, and{" "}
            {weakest.dependents} concept{weakest.dependents === 1 ? "" : "s"} here build
            {weakest.dependents === 1 ? "s" : ""} on it.
          </span>
        </button>
      )}

      <ConceptMapView
        concepts={concepts}
        edges={edges}
        levelOf={levelOf}
        selectedId={selectedId}
        onSelect={setSelectedId}
      />

      {/* Two keys, because the map speaks two languages: the dots say how well you know
          something, the lines say how the ideas relate. The line styles had no key at
          all, which made solid-versus-dashed a code nobody was given. */}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-muted-foreground">
        <Key className="bg-accent" label="Solid" />
        <Key className="bg-pending" label="Fading" />
        <Key className="bg-foreground/25" label="Not yet" />
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-muted-foreground">
        <LineKey label="Build on first" />
        <LineKey label="Explains" thin />
        <LineKey label="Don't confuse" dashed />
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">
        Tap a concept to open it · tap it again to close · drag to move
      </p>

      {selected && (
        <MapNodeSheet
          deckId={deck.id}
          concept={selected}
          concepts={concepts}
          edges={edges}
          level={levelOf(selected.id)}
          labelOf={labelOf}
          levelOf={levelOf}
          onJump={setSelectedId}
          onRead={() => readConcept(selected.id)}
          onClose={() => setSelectedId(null)}
        />
      )}
    </motion.div>
  );
}

/** A 22px sample of the line it names. Drawn rather than described, because "dashed"
 * is a word and the thing on the canvas is a picture. */
function LineKey({ label, thin, dashed }: { label: string; thin?: boolean; dashed?: boolean }) {
  return (
    <span className="flex items-center gap-1.5">
      <svg width="22" height="8" viewBox="0 0 22 8" aria-hidden className="shrink-0">
        <line
          x1="1"
          y1="4"
          x2={dashed ? 21 : 17}
          y2="4"
          strokeDasharray={dashed ? "4 3" : undefined}
          strokeWidth={thin ? 1 : 1.6}
          className={thin ? "stroke-foreground/25" : "stroke-foreground/45"}
        />
        {!dashed && <path d="M16 1.5 L21 4 L16 6.5 z" className="fill-foreground/45" />}
      </svg>
      {label}
    </span>
  );
}

function Key({ className, label }: { className: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`h-2 w-2 rounded-full ${className}`} aria-hidden />
      {label}
    </span>
  );
}
