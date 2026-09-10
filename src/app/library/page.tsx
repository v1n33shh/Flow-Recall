"use client";

import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { Deck, StudyProgress } from "@/lib/types";
import {
  appendConceptsToDeck,
  clearProgress,
  deleteDeck,
  getFactCursor,
  getProgress,
  restoreDeck,
  setFactCursor,
  setStudyDeck,
  useSavedDecks,
} from "@/lib/storage";
import { searchDecks } from "@/lib/deckSearch";
import { factAt, nextCursor } from "@/lib/brainFacts";
import {
  continuationMessage,
  CONTINUE_BATCH_SIZE,
  runChunksContinuous,
  type ContinuousProgress,
} from "@/lib/ingestChunks";
import { useIsNative } from "@/lib/useIsNative";
import ContinuationProgress from "@/components/ContinuationProgress";
import DeckExamDate from "@/components/DeckExamDate";
import DeckTitle from "@/components/DeckTitle";
import DeckUndoBar, { type PendingDelete } from "@/components/DeckUndoBar";
import FilmGrain from "@/components/FilmGrain";

/** Every deck the student has made, on a screen of its own.
 *
 * Moved wholesale out of src/app/page.tsx, which had grown into two pages wearing
 * one route: an action centre ("what should I study tonight?") and an archive
 * ("everything I have ever generated"). The archive always won on height - a
 * student with fifteen books scrolled past all of them to reach the one thing the
 * engine actually wanted them to do. Home keeps TodaySession and MemoryOverview;
 * the shelf lives here.
 *
 * The behaviour below is the SAME behaviour, deliberately - the handlers, the
 * sessionStorage handoff, and the continuation runner are moved, not rewritten, so
 * this refactor cannot change what a tap does. What is new is only the frame around
 * them: a hydration skeleton, an empty state, and layout animation on removal.
 *
 * No auth gate: decks live in localStorage, which exists signed out, and the
 * Capacitor build is a static export with no server to gate on anyway.
 */

// A harsh, high-stiffness/low-damping spring so elements snap aggressively into
// place instead of gently fading in. Same constant, same feel as the home hero.
const SNAP = { type: "spring" as const, stiffness: 700, damping: 18 };

// Card entrances stagger, but a 40-deck library must not spend 1.2 seconds
// dealing itself out - the last card is capped at this delay regardless of index.
const MAX_STAGGER_S = 0.24;
const STAGGER_STEP_S = 0.03;

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** True only after the first client render.
 *
 * `useSavedDecks` is a useSyncExternalStore whose SERVER snapshot is a stable empty
 * array (see EMPTY_DECKS in storage.ts), so the first paint of this route always has
 * zero decks - on the web export and inside the Capacitor shell alike. On the old
 * home screen that was invisible, because an empty library rendered nothing at all.
 * On a page whose entire subject is the library, it would flash "Your library is
 * empty" at every student who owns fifteen books. This is what tells the two states
 * apart. */
// Module-level so the reference is stable across renders; nothing ever changes,
// so the subscription is a no-op and the returned unsubscribe is never useful.
const subscribeNever = () => () => {};

function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );
}

/** The stacked-spines mark, at the size the empty state wants it. Shares its
 * geometry with MobileTabBar's LibraryIcon so the tab a student taps and the
 * screen it opens carry the same shape. */
function LibraryGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <rect x="3.75" y="9.75" width="16.5" height="10.5" rx="2.25" stroke="currentColor" strokeWidth="1.8" />
      <path d="M6.25 6.75h11.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M8.25 3.75h7.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

/** What the shelf looks like before the store has answered. Three cards at the
 * real card's height, so the grid does not resize when the decks arrive - the
 * skeleton IS the zero-layout-shift guarantee, not a decoration.
 *
 * `animate-pulse` is opacity-only, which keeps it inside the same performance
 * contract as StreakCounter and PageTransition: never animate filter or blur. */
function DeckSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="flex animate-pulse flex-col rounded-2xl border border-border bg-surface/40 p-5"
        >
          <div className="h-3 w-16 rounded-full bg-foreground/10" />
          <div className="mt-3 h-5 w-3/4 rounded-full bg-foreground/10" />
          <div className="mt-2 h-3 w-24 rounded-full bg-foreground/10" />
          <div className="mt-6 flex gap-2">
            <div className="h-10 flex-1 rounded-full bg-foreground/10" />
            <div className="h-10 w-20 rounded-full bg-foreground/[0.06]" />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function LibraryPage() {
  const router = useRouter();
  const decks = useSavedDecks();
  const hydrated = useHydrated();
  // Ambient glow orbs are web-only, exactly as on the home hero: they were tuned
  // for a tall desktop viewport and read as isolated grey blobs on a phone.
  const isNative = useIsNative();
  // A student who has asked for less motion gets none of the layout choreography -
  // the shelf still reorders, it just does it instantly.
  const reduceMotion = useReducedMotion();

  const [query, setQuery] = useState("");
  /** The deck the student just deleted, held only for as long as Undo is offered.
   *
   * The deletion has ALREADY happened - this is not a pending action, it is a
   * snapshot of what would have to be written back, and `deleteDeck` strips the row
   * of everything but a date (see restoreDeck). Progress goes with it because
   * deleteDeck removes that key too. */
  const [pendingDelete, setPendingDelete] = useState<
    { deck: Deck; progress: StudyProgress | null } | null
  >(null);
  const [generatingDeckIds, setGeneratingDeckIds] = useState<Set<string>>(new Set());
  const [jitErrors, setJitErrors] = useState<Record<string, string>>({});
  // What each in-flight continuation is doing, keyed by deck id. "Generating..."
  // for four chunks with a rate-limit wait inside it is up to a minute of a button
  // that looks stuck; this says which part, and what it is waiting for.
  const [jitProgress, setJitProgress] = useState<Record<string, ContinuousProgress>>({});
  // Deck ids the student has asked to stop. A ref, not state: runChunksContinuous
  // polls this from inside a loop that closed over the render that started it, so a
  // state value read there would stay false forever.
  const stopRequests = useRef<Set<string>>(new Set());

  // Recomputed per keystroke and no oftener: a 20-deck library is a few thousand
  // short string compares, but a sync landing mid-search should not pay for them
  // again.
  const matches = useMemo(() => searchDecks(decks, query), [decks, query]);
  const searching = query.trim().length > 0;

  /** A different brain fact every visit, in order, so a student meets all of them
   * before meeting any of them twice.
   *
   * Read once per mount and written in an effect, which is what keeps the line still
   * for the whole visit: recomputing per render would swap it under someone mid-read
   * on every keystroke of the search box. The write is a side effect and belongs in
   * an effect; it is deliberately not held in state, since nothing on this screen
   * re-renders because of it (and `react-hooks/set-state-in-effect` is an error in
   * this repo - see useHydrated above, which the same rule pushed onto
   * useSyncExternalStore). */
  const factCursor = useMemo(() => getFactCursor(), []);
  useEffect(() => {
    setFactCursor(nextCursor(factCursor));
  }, [factCursor]);

  function handleStudyNow(deck: Deck, isFullyMastered: boolean) {
    // A 100%-mastered session resuming normally would hydrate a queue with
    // nothing left to answer and dump the user straight at the completion
    // slide - clear it so "Review Again" actually starts a fresh pass.
    if (isFullyMastered) {
      clearProgress(deck.id);
    }
    setStudyDeck(deck.id, deck.concepts);
    // Marks the route change (and /study's heavier initial render) as a low
    // priority transition, so the button's own tap feedback isn't blocked
    // waiting for that render to commit - see PageTransition.tsx.
    startTransition(() => {
      router.push("/study");
    });
  }

  /** Same sessionStorage handoff `/study` uses, so the revision sheet needs no
   * dynamic route - which `output: "export"` could not build for localStorage
   * deck ids anyway. */
  function handleRead(deck: Deck) {
    setStudyDeck(deck.id, deck.concepts);
    startTransition(() => {
      router.push("/revise");
    });
  }

  /** Deletes immediately and offers Undo, rather than asking first.
   *
   * The confirm this replaces was a `window.confirm`, which on Android draws a white
   * system dialog titled with the app's own localhost origin - the exact thing
   * ConceptEditor and the reader's SelectionBar each went out of their way to avoid.
   * Both of those answered it with a two-tap confirm; this can do better, because
   * `deleteDeck` tombstones rather than removes and `restoreDeck` can put the deck
   * and its session back with a newer `updatedAt`. So the common case - a deliberate
   * deletion - costs one tap, and the rare mistake costs one more.
   *
   * The snapshot is taken BEFORE the delete, in this order, because deleteDeck
   * strips the row and removes the progress key. */
  function handleDelete(deck: Deck) {
    const progress = getProgress(deck.id);
    deleteDeck(deck.id);
    setPendingDelete({ deck, progress });
  }

  function undoDelete() {
    if (!pendingDelete) return;
    restoreDeck(pendingDelete.deck, pendingDelete.progress);
    setPendingDelete(null);
  }

  // Stable, so DeckUndoBar's countdown is not restarted by every unrelated render -
  // a search keystroke would otherwise hand back a fresh six seconds each time.
  const forgetPendingDelete = useCallback(() => setPendingDelete(null), []);

  /** Keeps generating this deck's leftovers until they run out, the student taps
   * Stop, or something stops it for them - one tap instead of the ~115 that
   * finishing a book used to take at four sections a time.
   *
   * Every batch is persisted as it completes (see onBatch), so an interrupted run -
   * Stop, a failure, a killed app - leaves the deck holding exactly the sections it
   * has not generated. Tapping again resumes; nothing is repeated and nothing is
   * paid for twice. */
  async function handleGenerateNextSection(deck: Deck) {
    const pending = deck.pendingChunks;
    if (!pending || pending.length === 0) return;

    stopRequests.current.delete(deck.id);
    setGeneratingDeckIds((prev) => new Set(prev).add(deck.id));
    setJitErrors((prev) => {
      const next = { ...prev };
      delete next[deck.id];
      return next;
    });

    try {
      const run = await runChunksContinuous(pending, {
        // model: deck.model - without this an unset model falls back to the free
        // model server-side regardless of plan, silently downgrading a Pro user's
        // continuation sections to the cheap model they didn't pick.
        model: deck.model,
        // countsFirstChunk: false - this continues a deck the student already spent
        // one of their monthly generations on, not a new one. Without it the
        // server's allowance gate (which only checks on a first chunk) treats an
        // unmarked request as a first chunk and wrongly re-blocks a free user
        // part-way through their own already-started deck.
        countsFirstChunk: false,
        batchSize: CONTINUE_BATCH_SIZE,
        shouldStop: () => stopRequests.current.has(deck.id),
        // Keep what succeeded, batch by batch. Those cards cost real tokens and are
        // already paid for; discarding them and leaving their text in pendingChunks
        // means the next tap regenerates - and re-pays for - finished work.
        onBatch: (concepts, remaining) => appendConceptsToDeck(deck.id, concepts, remaining),
        onProgress: (progress) => setJitProgress((prev) => ({ ...prev, [deck.id]: progress })),
      });

      // Shared with /ingest's recognition card, which ends a run the same way - see
      // continuationMessage for which failures must not say "tap again".
      if (run.error) {
        const message = continuationMessage({
          error: run.error,
          code: run.code,
          kept: run.concepts.length,
        });
        setJitErrors((prev) => ({ ...prev, [deck.id]: message }));
      }
    } catch (err) {
      setJitErrors((prev) => ({
        ...prev,
        [deck.id]: err instanceof Error ? err.message : "Something went wrong.",
      }));
    } finally {
      stopRequests.current.delete(deck.id);
      setJitProgress((prev) => {
        const next = { ...prev };
        delete next[deck.id];
        return next;
      });
      setGeneratingDeckIds((prev) => {
        const next = new Set(prev);
        next.delete(deck.id);
        return next;
      });
    }
  }

  /** Asks a running continuation to stop. Honoured at the next section boundary,
   * never mid-section: the requests already in flight are paid for either way, so
   * abandoning them would spend a student's allowance for nothing. */
  function handleStopGenerating(deck: Deck) {
    stopRequests.current.add(deck.id);
    setJitProgress((prev) => {
      const current = prev[deck.id];
      return current ? { ...prev, [deck.id]: { ...current, stopping: true } } : prev;
    });
  }

  return (
    <main className="relative mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-10 sm:px-6 sm:py-16">
      <FilmGrain />

      {/* Ambient glow orbs - purely decorative, blurred washes that give the shelf
          depth on a wide screen. pointer-events-none and -z-10 keep them clear of
          every card and button. Web only, for the same reason the home hero drops
          them on native: at phone width they read as isolated grey blobs rather
          than as a wash. */}
      {!isNative && (
        <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
          <div className="absolute -top-32 left-1/2 h-72 w-72 -translate-x-1/2 rounded-full bg-foreground/5 blur-3xl md:h-[34rem] md:w-[34rem]" />
          <div className="absolute bottom-0 right-[-6rem] hidden h-[26rem] w-[26rem] rounded-full bg-foreground/[0.03] blur-3xl md:block" />
        </div>
      )}

      {/* ============================ HEADER ============================ */}
      <motion.header
        initial={reduceMotion ? false : { opacity: 0, y: -16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={SNAP}
        className="relative z-10 flex gap-4 sm:items-start sm:justify-between"
      >
        <div className="min-w-0">
          {/* No eyebrow pill above this, deliberately. "Everything you have made"
              sat directly on top of a heading that says "Your Library" - the same
              sentence twice, in a hero device borrowed from the landing page, on a
              screen whose job is to get out of the way. /reader, this screen's
              sibling, has never had one either. */}
          <h1 className="font-sans text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            Your Library
          </h1>
          {/* One true thing about the brain, different every visit. Deliberately
              unattributed - see BRAIN_FACTS in src/lib/brainFacts.ts for why, and for
              the effect behind each line. The hairline rule reads as a pull-quote
              without claiming to be a quotation.

              This sits where "N decks · N concepts" used to. That total was a
              scoreboard for work already done, and the student it was sized for -
              a real shelf, an exam coming - is the one it discouraged. Nothing counts
              anything at anybody here now; the only number left on the screen is the
              one a search asks for. */}
          {hydrated && (
            <motion.p
              initial={reduceMotion ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.4, delay: 0.1 }}
              className="mt-4 max-w-md border-l border-border pl-3.5 text-[15px] leading-relaxed text-muted-foreground [text-wrap:balance] sm:text-base"
            >
              {factAt(factCursor)}
            </motion.p>
          )}

          {/* Feedback on a query rather than a total, so it exists only while there
              is a query - and takes its space with it when there is not. */}
          {hydrated && searching && (
            <p className="mt-3 text-sm tabular-nums text-muted-foreground">
              {matches.length} of {decks.length} deck{decks.length === 1 ? "" : "s"}
            </p>
          )}
        </div>

        {/* sm: and up only. Below that this was a ghost pill duplicating the Ingest
            tab sitting 60px underneath it in the thumb zone, and it cost the shelf
            58px of the first screen to say the same thing twice. MobileTabBar is
            hidden from sm: upward, which is exactly where this has to reappear. */}
        <Link
          href="/ingest"
          className="hidden shrink-0 rounded-full border border-border bg-foreground/5 px-5 py-2.5 text-sm font-medium text-foreground backdrop-blur-md transition-all duration-200 hover:scale-[1.03] hover:bg-foreground/10 active:scale-[0.97] sm:block"
        >
          New deck
        </Link>
      </motion.header>

      {/* ============================= SHELF ============================= */}
      {/* The glass panel the grid sits in - from md: upward, and NOT below it.
          On a phone the blur was already gated at md: (it is charged per-pixel every
          frame on the hardware this ships to), so what was left underneath was a
          bordered rounded rectangle holding bordered rounded rectangles inset 17px:
          a frame around a frame, which is the cheapest-looking thing a dark UI can
          do. At md: it becomes a real surface - blur, shadow, three columns inside
          it - and earns the border it draws.

          `layout` so removing a deck closes the gap by animating the container's own
          height instead of snapping it. */}
      <motion.section
        layout={!reduceMotion}
        transition={{ type: "spring", stiffness: 320, damping: 34 }}
        aria-labelledby="library-heading"
        className="relative z-10 mt-6 md:mt-8 md:rounded-3xl md:border md:border-border md:bg-surface/40 md:p-6 md:shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_24px_64px_-32px_rgba(0,0,0,0.85)] md:backdrop-blur-xl"
      >
        <h2 id="library-heading" className="sr-only">
          Saved decks
        </h2>

        {/* Held back until there is a shelf worth searching: a control that can only
            ever filter one deck down to one deck is noise on a new student's screen.
            Behind `hydrated` with everything else, so it does not flash in and out as
            the store answers. */}
        {hydrated && decks.length > 1 && (
          <div className="relative mb-4">
            <SearchIcon className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search your decks"
              aria-label="Search your decks"
              enterKeyHint="search"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              className="min-h-11 w-full rounded-xl border border-border bg-background/60 py-2.5 pl-11 pr-11 text-base text-foreground placeholder-muted-foreground outline-none transition-colors focus:border-accent/60 [&::-webkit-search-cancel-button]:hidden"
            />
            {searching && (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-lg leading-none text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
              >
                &times;
              </button>
            )}
          </div>
        )}

        {!hydrated ? (
          <DeckSkeleton />
        ) : decks.length === 0 ? (
          /* ========================= EMPTY STATE ========================= */
          <motion.div
            initial={reduceMotion ? false : { opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={SNAP}
            className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border px-6 py-16 text-center sm:py-24"
          >
            <span className="relative flex h-16 w-16 items-center justify-center rounded-2xl border border-border bg-foreground/5 text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_0_40px_-8px_hsl(var(--pulse-accent)/0.35)]">
              <LibraryGlyph className="h-7 w-7" />
            </span>
            <h3 className="mt-6 text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
              Your library is empty.
            </h3>
            <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground [text-wrap:balance]">
              Time to ingest some knowledge. Drop in a PDF, a chapter or a page of
              notes, and it comes back as cards you can actually be tested on.
            </p>
            <Link
              href="/ingest"
              className="mt-7 rounded-full bg-accent px-6 py-3 text-sm font-semibold text-accent-foreground ring-1 ring-inset ring-accent/30 shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_8px_28px_-6px_rgba(0,0,0,0.45)] transition-all duration-200 hover:scale-[1.03] hover:bg-accent/90 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_12px_40px_-6px_rgba(0,0,0,0.55)] active:scale-[0.97]"
            >
              Ingest your first source
            </Link>
            <p className="mt-4 text-xs text-muted-foreground">
              PDF, EPUB or pasted text · about a minute
            </p>
          </motion.div>
        ) : matches.length === 0 ? (
          /* Nothing matched. Deliberately NOT the empty-library state: the shelf is
             not empty, the query is wrong, and offering "ingest your first source"
             to someone holding fifteen decks would read as the app having lost them. */
          <motion.div
            initial={reduceMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border px-6 py-14 text-center"
          >
            <p className="text-base font-medium text-foreground">
              Nothing matches &ldquo;{query.trim()}&rdquo;
            </p>
            <p className="mt-1.5 max-w-xs text-sm text-muted-foreground">
              Searches deck names and the concepts inside them.
            </p>
            <button
              type="button"
              onClick={() => setQuery("")}
              className="mt-5 rounded-full border border-border bg-foreground/5 px-5 py-2.5 text-sm font-medium text-foreground transition-all duration-200 hover:bg-foreground/10 active:scale-[0.97]"
            >
              Clear search
            </button>
          </motion.div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
            {/* popLayout, deliberately: it takes a deleted card OUT of flow before
                its exit animation runs, so the cards after it slide up into the gap
                at the same time rather than waiting for it to finish shrinking.
                Without it a deletion reads as two steps - fade, then jump. */}
            <AnimatePresence mode="popLayout" initial={false}>
              {matches.map(({ deck, cardMatches }, index) => {
                const progress = getProgress(deck.id);
                const masteredCount = progress?.masteredIds.length ?? 0;
                const pct =
                  deck.concepts.length > 0 ? Math.min(masteredCount / deck.concepts.length, 1) : 0;
                const isFullyMastered = Boolean(progress) && pct >= 1;
                const buttonLabel = !progress ? "Study Now" : isFullyMastered ? "Review Again" : "Resume";

                return (
                  <motion.div
                    key={deck.id}
                    layout={!reduceMotion}
                    initial={reduceMotion ? false : { opacity: 0, y: 12, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.94 }}
                    transition={{
                      ...SNAP,
                      delay: reduceMotion ? 0 : Math.min(index * STAGGER_STEP_S, MAX_STAGGER_S),
                      opacity: { duration: 0.18 },
                    }}
                    className="group relative flex flex-col rounded-2xl border border-border bg-surface/60 p-5 text-left shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] transition-transform hover:-translate-y-0.5 md:backdrop-blur-xl"
                  >
                    {/* The title leads the card. The date used to, in uppercase
                        tracked-out caps above it - the least useful thing on the card
                        in its strongest position - and it is now one item in the meta
                        line below, where it belongs.

                        Delete sits ON the title's row rather than absolutely in the
                        corner, which is what lets the title start at the top of the
                        card at all: an absolutely-positioned × would sit on top of
                        the rename input the moment the title moved up under it. */}
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <DeckTitle deck={deck} />
                      </div>
                      <button
                        type="button"
                        onClick={() => handleDelete(deck)}
                        aria-label="Delete deck"
                        className="-mr-1.5 -mt-1.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-lg leading-none text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
                      >
                        &times;
                      </button>
                    </div>
                    <p className="mt-1.5 text-sm text-muted-foreground">
                      {deck.concepts.length} concept{deck.concepts.length === 1 ? "" : "s"}
                      {" · "}
                      {formatDate(deck.createdAt)}
                      {/* Why this deck is in the results when its name gives nothing
                          away - without it, a title-less match looks like a bug. */}
                      {cardMatches > 0 && (
                        <span className="text-foreground">
                          {" · "}
                          {cardMatches} card{cardMatches === 1 ? "" : "s"} match
                        </span>
                      )}
                    </p>

                    {progress && (
                      <div className="mt-3">
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-foreground/10">
                          <div
                            className="h-full bg-accent transition-all"
                            style={{ width: `${pct * 100}%` }}
                          />
                        </div>
                        <p className="mt-1.5 text-xs text-muted-foreground">
                          {masteredCount}/{deck.concepts.length} mastered
                        </p>
                      </div>
                    )}

                    {/* One filled pill, sized to its own words rather than stretched
                        across the card, and a text button beside it. Three cards down
                        a phone screen used to mean three full-width white slabs; the
                        hierarchy is the same and roughly a third of the white is left.
                        Both keep a 44px tap target (min-h-11) - the padding shrank,
                        the thumb target did not. */}
                    <div className="mt-4 flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => handleStudyNow(deck, isFullyMastered)}
                        className="inline-flex min-h-11 items-center rounded-full bg-accent px-5 text-sm font-semibold text-accent-foreground ring-1 ring-inset ring-accent/30 shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_8px_24px_-6px_rgba(0,0,0,0.4)] transition-all duration-200 hover:bg-accent/90 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_10px_32px_-6px_rgba(0,0,0,0.5)] active:scale-[0.98]"
                      >
                        {buttonLabel}
                      </button>
                      {/* The deck as material rather than as a test. Every concept
                          already carries a full explanation paragraph that was only
                          ever reachable one card at a time, after answering it. */}
                      <button
                        type="button"
                        onClick={() => handleRead(deck)}
                        className="inline-flex min-h-11 items-center rounded-full px-4 text-sm font-medium text-muted-foreground transition-colors duration-200 hover:bg-foreground/5 hover:text-foreground active:scale-[0.98]"
                      >
                        Read
                      </button>
                    </div>

                    {/* When the paper is. Not a label - inside three weeks it lifts this
                        deck's retention floor to 0.95, so every interval in it shortens
                        and the home projection anchors to a real date. */}
                    <DeckExamDate deck={deck} />

                    {deck.pendingChunks && deck.pendingChunks.length > 0 && (
                      <>
                        {generatingDeckIds.has(deck.id) ? (
                          <ContinuationProgress
                            progress={jitProgress[deck.id]}
                            onStop={() => handleStopGenerating(deck)}
                          />
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleGenerateNextSection(deck)}
                            className="mt-2 rounded-full border border-border bg-transparent px-4 py-2.5 text-sm font-medium text-foreground transition-all duration-200 hover:bg-foreground/10 active:scale-[0.97]"
                          >
                            {/* "all" rather than "next": one tap now works through
                                every remaining section instead of four. */}
                            Generate all {deck.pendingChunks.length} remaining{" "}
                            {deck.pendingChunks.length === 1 ? "section" : "sections"}
                          </button>
                        )}
                        {jitErrors[deck.id] && (
                          <p className="mt-2 text-xs text-muted-foreground">{jitErrors[deck.id]}</p>
                        )}
                      </>
                    )}
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        )}
      </motion.section>

      {/* Outside the panel: it is fixed to the viewport, and nesting it inside a
          `layout`-animated section would drag it around as the shelf resizes. */}
      <DeckUndoBar
        pending={pendingDelete ? toPending(pendingDelete.deck) : null}
        onUndo={undoDelete}
        onExpire={forgetPendingDelete}
      />
    </main>
  );
}

function toPending(deck: Deck): PendingDelete {
  return { id: deck.id, title: deck.title };
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <circle cx="11" cy="11" r="6.25" stroke="currentColor" strokeWidth="1.8" />
      <path d="m15.5 15.5 4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
