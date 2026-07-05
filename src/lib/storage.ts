import { useSyncExternalStore } from "react";
import type { Concept, Deck, StudyProgress } from "./types";

const STUDY_DECK_STORAGE_KEY = "flowrecall:studyDeck";
const SAVED_DECKS_STORAGE_KEY = "flowrecall:savedDecks";

function progressStorageKey(deckId: string): string {
  return `flowrecall:progress:${deckId}`;
}

// The native "storage" event only fires in *other* tabs/windows, never the
// one that made the change - so same-tab components (e.g. the library saving
// a deck and re-reading it) never hear about it on their own. Firing this
// custom event right after every write covers that gap; listening for both
// means the store stays in sync whether the change came from this tab or
// another one.
const LOCAL_STORAGE_UPDATE_EVENT = "local-storage-update";

function notifyLocalStorageUpdate() {
  window.dispatchEvent(new Event(LOCAL_STORAGE_UPDATE_EVENT));
}

function subscribeToStorage(onStoreChange: () => void) {
  window.addEventListener("storage", onStoreChange);
  window.addEventListener(LOCAL_STORAGE_UPDATE_EVENT, onStoreChange);
  return () => {
    window.removeEventListener("storage", onStoreChange);
    window.removeEventListener(LOCAL_STORAGE_UPDATE_EVENT, onStoreChange);
  };
}

type StudyHandoff = { deckId: string; concepts: Concept[] };

/** Hands a freshly generated (or resumed) deck off from the ingest page /
 * library to the study feed. Session-scoped: it's a one-time handoff, not
 * something worth persisting on its own - see saveProgress for the part
 * that actually needs to survive a closed tab. */
export function setStudyDeck(deckId: string, concepts: Concept[]) {
  window.sessionStorage.setItem(STUDY_DECK_STORAGE_KEY, JSON.stringify({ deckId, concepts }));
  notifyLocalStorageUpdate();
}

// useSyncExternalStore compares snapshots by reference, but JSON.parse
// returns a new array every call - cache by raw string so an unchanged
// value doesn't look like a change and trigger a re-render loop.
let cachedRawDeck: string | null = null;
let cachedDeck: StudyHandoff | null = null;

function getStudyDeck(): StudyHandoff | null {
  if (typeof window === "undefined") return null;
  const raw = window.sessionStorage.getItem(STUDY_DECK_STORAGE_KEY);
  if (raw === cachedRawDeck) return cachedDeck;

  cachedRawDeck = raw;
  try {
    cachedDeck = raw ? (JSON.parse(raw) as StudyHandoff) : null;
  } catch {
    cachedDeck = null;
  }
  return cachedDeck;
}

export function useStudyDeck(): StudyHandoff | null {
  return useSyncExternalStore(subscribeToStorage, getStudyDeck, () => null);
}

// A fresh `[]` on every getServerSnapshot() call would be a *different*
// reference each time - useSyncExternalStore compares by reference, so
// that alone can trigger the same infinite-render-loop class of bug as
// getStudyDeck's caching above. Use one stable empty array instead.
const EMPTY_DECKS: Deck[] = [];

// Same reference-stability problem as getStudyDeck: JSON.parse returns a
// new array every call, so cache by the raw string.
let cachedRawDecks: string | null = null;
let cachedDecks: Deck[] = EMPTY_DECKS;

export function getSavedDecks(): Deck[] {
  if (typeof window === "undefined") return EMPTY_DECKS;
  const raw = window.localStorage.getItem(SAVED_DECKS_STORAGE_KEY);
  if (raw === cachedRawDecks) return cachedDecks;

  cachedRawDecks = raw;
  try {
    cachedDecks = raw ? (JSON.parse(raw) as Deck[]) : EMPTY_DECKS;
  } catch {
    cachedDecks = EMPTY_DECKS;
  }
  return cachedDecks;
}

/** Persists a freshly generated deck so it survives a page refresh. Newest
 * first. `pendingChunks` carries any leftover text the Speed-First Cap
 * didn't process yet - see appendConceptsToDeck for JIT-generating it later. */
export function saveDeck(title: string, concepts: Concept[], pendingChunks: string[] = []): Deck {
  const deck: Deck = {
    id: crypto.randomUUID(),
    title: title.trim() || "Untitled Notes",
    createdAt: Date.now(),
    concepts,
    ...(pendingChunks.length > 0 ? { pendingChunks } : {}),
  };

  const next = [deck, ...getSavedDecks()];
  window.localStorage.setItem(SAVED_DECKS_STORAGE_KEY, JSON.stringify(next));
  notifyLocalStorageUpdate();
  return deck;
}

/** Appends a JIT-generated batch of concepts to an already-saved deck and
 * records whatever pending text is still left after this batch - a no-op if
 * the deck has since been deleted. */
export function appendConceptsToDeck(
  deckId: string,
  newConcepts: Concept[],
  remainingPendingChunks: string[],
): void {
  const next = getSavedDecks().map((deck) =>
    deck.id === deckId
      ? {
          ...deck,
          concepts: [...deck.concepts, ...newConcepts],
          pendingChunks: remainingPendingChunks.length > 0 ? remainingPendingChunks : undefined,
        }
      : deck,
  );
  window.localStorage.setItem(SAVED_DECKS_STORAGE_KEY, JSON.stringify(next));
  notifyLocalStorageUpdate();
}

/** Appends freshly generated concepts (e.g. from Infinite Recall Mode) to an
 * already-saved deck, leaving its `pendingChunks` untouched - a no-op if the
 * deck has since been deleted. Unlike appendConceptsToDeck (which rewrites
 * pendingChunks from the JIT continuation flow), this never clears leftover
 * source text, so shuffling and continuing a deck don't clobber each other. */
export function addConceptsToDeck(deckId: string, newConcepts: Concept[]): void {
  if (newConcepts.length === 0) return;
  const next = getSavedDecks().map((deck) =>
    deck.id === deckId
      ? { ...deck, concepts: [...deck.concepts, ...newConcepts] }
      : deck,
  );
  window.localStorage.setItem(SAVED_DECKS_STORAGE_KEY, JSON.stringify(next));
  notifyLocalStorageUpdate();
}

export function deleteDeck(id: string): void {
  const next = getSavedDecks().filter((deck) => deck.id !== id);
  window.localStorage.setItem(SAVED_DECKS_STORAGE_KEY, JSON.stringify(next));
  // A deleted deck's saved session progress is meaningless orphaned data -
  // clean it up too rather than leaking it in localStorage forever.
  window.localStorage.removeItem(progressStorageKey(id));
  notifyLocalStorageUpdate();
}

export function useSavedDecks(): Deck[] {
  return useSyncExternalStore(subscribeToStorage, getSavedDecks, () => EMPTY_DECKS);
}

/** Persists an in-progress (or finished) study session so closing the tab
 * mid-deck doesn't lose the queue, streak, or mastered concepts. Called
 * directly (not via a hook) - StudyFeed reads it once on mount to hydrate,
 * and the library page reads it fresh on each render to show a progress bar. */
export function saveProgress(deckId: string, progress: StudyProgress): void {
  window.localStorage.setItem(progressStorageKey(deckId), JSON.stringify(progress));
  notifyLocalStorageUpdate();
}

export function getProgress(deckId: string): StudyProgress | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(progressStorageKey(deckId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StudyProgress;
  } catch {
    return null;
  }
}

/** Clears a session's saved progress - used when starting a fully-mastered
 * deck over again, so it doesn't resume straight into "nothing left to do." */
export function clearProgress(deckId: string): void {
  window.localStorage.removeItem(progressStorageKey(deckId));
  notifyLocalStorageUpdate();
}
