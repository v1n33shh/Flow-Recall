import { useSyncExternalStore } from "react";
import type { Concept, ConceptEdge, Deck, QueueItem, StudyProgress } from "./types";

const STUDY_DECK_STORAGE_KEY = "flowrecall:studyDeck";
const STUDY_SESSION_STORAGE_KEY = "flowrecall:studySession";
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
  // The two handoffs are mutually exclusive and /study prefers the session one, so
  // a leftover session would silently hijack every later "Study this deck" tap.
  window.sessionStorage.removeItem(STUDY_SESSION_STORAGE_KEY);
  notifyLocalStorageUpdate();
}

/** Hands a session built by the engine off to the feed. Separate from the deck
 * handoff because a session drawn from the whole library has no single deck: each
 * item carries its own unitId instead. */
export function setStudySession(items: QueueItem[]) {
  window.sessionStorage.setItem(STUDY_SESSION_STORAGE_KEY, JSON.stringify(items));
  window.sessionStorage.removeItem(STUDY_DECK_STORAGE_KEY);
  notifyLocalStorageUpdate();
}

let cachedRawSession: string | null = null;
let cachedSession: QueueItem[] | null = null;

function getStudySession(): QueueItem[] | null {
  if (typeof window === "undefined") return null;
  const raw = window.sessionStorage.getItem(STUDY_SESSION_STORAGE_KEY);
  if (raw === cachedRawSession) return cachedSession;
  cachedRawSession = raw;
  try {
    const parsed = raw ? (JSON.parse(raw) as QueueItem[]) : null;
    cachedSession = parsed && parsed.length > 0 ? parsed : null;
  } catch {
    cachedSession = null;
  }
  return cachedSession;
}

/** Same reference-stability rule as useStudyDeck: JSON.parse hands back a new array
 * every call, and useSyncExternalStore compares by reference, so the raw string is
 * what gets cached against. */
export function useStudySession(): QueueItem[] | null {
  return useSyncExternalStore(subscribeToStorage, getStudySession, () => null);
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

let cachedRawAllDecks: string | null = null;
let cachedAllDecks: Deck[] = EMPTY_DECKS;

/** Every deck row as stored, tombstones included.
 *
 * This, not getSavedDecks, is what every WRITER below must build its next array
 * from: getSavedDecks hides tombstones, so writing back its output would drop the
 * record of a deletion and the next pull from another device would hand the deck
 * straight back. Also what /api/sync pushes. */
export function getAllDeckRows(): Deck[] {
  if (typeof window === "undefined") return EMPTY_DECKS;
  const raw = window.localStorage.getItem(SAVED_DECKS_STORAGE_KEY);
  if (raw === cachedRawAllDecks) return cachedAllDecks;
  cachedRawAllDecks = raw;
  try {
    cachedAllDecks = raw ? (JSON.parse(raw) as Deck[]) : EMPTY_DECKS;
  } catch {
    cachedAllDecks = EMPTY_DECKS;
  }
  return cachedAllDecks;
}

/** The decks the student actually has. Tombstones are filtered here and nowhere
 * else, so nothing above this file needs to know they exist. */
export function getSavedDecks(): Deck[] {
  if (typeof window === "undefined") return EMPTY_DECKS;
  const raw = window.localStorage.getItem(SAVED_DECKS_STORAGE_KEY);
  if (raw === cachedRawDecks) return cachedDecks;

  cachedRawDecks = raw;
  try {
    const all = raw ? (JSON.parse(raw) as Deck[]) : EMPTY_DECKS;
    const live = all.filter((deck) => deck.deletedAt === undefined || deck.deletedAt === null);
    // Keep the stable empty reference when nothing is left, for the same
    // render-loop reason EMPTY_DECKS exists at all.
    cachedDecks = live.length === 0 ? EMPTY_DECKS : live;
  } catch {
    cachedDecks = EMPTY_DECKS;
  }
  return cachedDecks;
}

/** A deck write localStorage had no room for.
 *
 * Its own type because it is the one storage failure a caller can act on, and the
 * one that must never surface as a generic "something went wrong". The write that
 * failed is the same write that would have marked those sections generated, so
 * without it the student's next tap regenerates - and re-pays for - work that has
 * already been done, and the tap after that does it again. See runChunksContinuous,
 * which ends a run on this rather than spending another batch it cannot keep.
 *
 * The message is the student-facing one on purpose: every path that catches this
 * shows it directly, and "delete a deck you've finished" is the only thing that
 * actually resolves it. */
export class DeckStorageFullError extends Error {
  constructor() {
    super(
      "Your device is out of space for saved decks. Delete a deck you've finished, then tap again to carry on.",
    );
    this.name = "DeckStorageFullError";
  }
}

/** Quota exhaustion, under every name browsers actually throw it as.
 *
 * Chromium and WebKit raise `QuotaExceededError` (legacy code 22); Gecko raises
 * `NS_ERROR_DOM_QUOTA_REACHED` (1014). Matched on name and code rather than
 * message, which is stable nowhere - and the app's Android WebView is whichever
 * Chromium the device shipped with. */
function isQuotaExceeded(error: unknown): boolean {
  if (typeof DOMException !== "undefined" && error instanceof DOMException) {
    return (
      error.name === "QuotaExceededError" ||
      error.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
      error.code === 22 ||
      error.code === 1014
    );
  }
  // Not every WebView throws a real DOMException; some throw a plain Error whose
  // name is all that is left of the quota. Checked by name only - never by message.
  return error instanceof Error && error.name === "QuotaExceededError";
}

function persistDecks(next: Deck[]): void {
  try {
    window.localStorage.setItem(SAVED_DECKS_STORAGE_KEY, JSON.stringify(next));
  } catch (error) {
    // Typed and rethrown, never swallowed. A silent no-op here would be the worst
    // outcome available: every reader below still returns the decks as they were
    // before the write, so a run would look like it was saving work it had dropped.
    if (isQuotaExceeded(error)) throw new DeckStorageFullError();
    throw error;
  }
  // Only on a write that landed. A listener woken by a failed write would re-read
  // the same unchanged decks and report them as fresh.
  notifyLocalStorageUpdate();
}

/** Writes pulled decks in, by id. The caller has already decided which of these
 * win (planSync in recallSync.ts); this only persists that decision. */
export function mergeRemoteDecks(remote: readonly Deck[]): void {
  if (remote.length === 0) return;
  const byId = new Map(getAllDeckRows().map((deck) => [deck.id, deck]));
  for (const deck of remote) byId.set(deck.id, deck);
  // Newest first, matching saveDeck's own ordering.
  persistDecks([...byId.values()].sort((a, b) => b.createdAt - a.createdAt));
}

/** Persists a freshly generated deck so it survives a page refresh. Newest
 * first. `pendingChunks` carries any leftover text the Speed-First Cap
 * didn't process yet - see appendConceptsToDeck for JIT-generating it later.
 * `model` records what generated it, so a later continuation reuses the same
 * model instead of silently falling back to the free one. `sourceKey` records
 * which text it came from, so a re-upload finds this deck rather than making a
 * second one - see findDeckBySourceKey. */
export function saveDeck(
  title: string,
  concepts: Concept[],
  // An options bag rather than four more positional parameters. `model`, `userId`
  // and `sourceKey` are all `string | undefined` and would sit adjacent, where
  // transposing two of them type-checks cleanly and silently records a user id as
  // a model - the kind of mistake that only shows up as a deck nobody owns.
  options: {
    pendingChunks?: string[];
    model?: string;
    userId?: string;
    sourceKey?: string;
  } = {},
): Deck {
  const { pendingChunks = [], model, userId, sourceKey } = options;
  const now = Date.now();
  const deck: Deck = {
    id: crypto.randomUUID(),
    title: title.trim() || "Untitled Notes",
    createdAt: now,
    updatedAt: now,
    ...(userId ? { userId } : {}),
    concepts,
    ...(pendingChunks.length > 0 ? { pendingChunks } : {}),
    ...(model ? { model } : {}),
    ...(sourceKey ? { sourceKey } : {}),
  };

  persistDecks([deck, ...getAllDeckRows()]);
  return deck;
}

/** The deck this text has already been made into cards from, or null.
 *
 * Reads `getSavedDecks()` so tombstones are filtered in one place, as everything
 * above this file relies on. Two decks can share a key - a student who chose
 * "start a separate deck" has said they want that - so this answers with the most
 * recently touched one, which is what "the book I'm working on" means.
 *
 * `userId` scoping follows the convention Deck.userId already documents: decks
 * live in localStorage, which is per device, and a deck saved before sync existed
 * carries no owner and is treated as the current user's. */
export function findDeckBySourceKey(sourceKey: string, userId?: string): Deck | null {
  if (!sourceKey) return null;
  let best: Deck | null = null;
  for (const deck of getSavedDecks()) {
    if (deck.sourceKey !== sourceKey) continue;
    if (userId && deck.userId && deck.userId !== userId) continue;
    if (!best || touchedAt(deck) > touchedAt(best)) best = deck;
  }
  return best;
}

/** When a deck last changed. `updatedAt` is absent on every deck saved before sync
 * existed, and createdAt is the honest reading for those: nothing has touched it. */
function touchedAt(deck: Deck): number {
  return deck.updatedAt ?? deck.createdAt;
}

/** Appends a JIT-generated batch of concepts to an already-saved deck and
 * records whatever pending text is still left after this batch - a no-op if
 * the deck has since been deleted. */
export function appendConceptsToDeck(
  deckId: string,
  newConcepts: Concept[],
  remainingPendingChunks: string[],
): void {
  persistDecks(
    getAllDeckRows().map((deck) =>
      deck.id === deckId
        ? {
            ...deck,
            concepts: [...deck.concepts, ...newConcepts],
            pendingChunks: remainingPendingChunks.length > 0 ? remainingPendingChunks : undefined,
            updatedAt: Date.now(),
          }
        : deck,
    ),
  );
}

/** Appends freshly generated concepts (e.g. from Infinite Recall Mode) to an
 * already-saved deck, leaving its `pendingChunks` untouched - a no-op if the
 * deck has since been deleted. Unlike appendConceptsToDeck (which rewrites
 * pendingChunks from the JIT continuation flow), this never clears leftover
 * source text, so shuffling and continuing a deck don't clobber each other. */
export function addConceptsToDeck(deckId: string, newConcepts: Concept[]): void {
  if (newConcepts.length === 0) return;
  persistDecks(
    getAllDeckRows().map((deck) =>
      deck.id === deckId
        ? { ...deck, concepts: [...deck.concepts, ...newConcepts], updatedAt: Date.now() }
        : deck,
    ),
  );
}

/** Rewrites one card in place, keeping its id and therefore its whole history.
 *
 * The id is deliberate, not incidental: a memory row is keyed `deckId::conceptId`,
 * so an edit that preserves the id leaves every review, every memory row and every
 * saved question attached. That is right for what this is FOR - correcting a card the
 * generator got wrong - because a student who fixes a typo has not stopped knowing
 * the concept, and resetting their evidence would punish them for the model's
 * mistake. Anyone tempted to "fix" that by minting a new id should read this twice.
 *
 * Stamps `updatedAt` so sync carries the correction to the account's other devices
 * like any other deck edit. A no-op if the deck or the card has since been deleted.
 *
 * Does NOT refresh the engine's copy: `unit.concept` embeds the card, so the caller
 * follows this with `importDeck` (recallStorage.ts) to bring the unit into line -
 * the same split setDeckExamDate makes, and for the same reason: this module knows
 * nothing about IndexedDB. */
export function updateConcept(deckId: string, concept: Concept): void {
  persistDecks(
    getAllDeckRows().map((deck) =>
      deck.id === deckId
        ? {
            ...deck,
            concepts: deck.concepts.map((existing) =>
              existing.id === concept.id ? concept : existing,
            ),
            updatedAt: Date.now(),
          }
        : deck,
    ),
  );
}

/** Removes one card from a deck, and the map edges that named it.
 *
 * Pruning the edges is not tidiness: `conceptMap` stores ids, and a stored map
 * outlives the concepts it names. ConceptRelations already drops a chip whose label
 * has gone, but DeckLearningPath orders the deck from these edges, so leaving a
 * dangling one puts a concept that no longer exists into the numbered path.
 *
 * Stamps `updatedAt` so the removal syncs. Unlike deleteDeck there is no tombstone
 * and none is needed: the deck row itself still travels, and last-write-wins on a
 * deck whose `concepts` array is one shorter says exactly what happened.
 *
 * Leaves the engine alone for the caller to clean up - see `forgetUnit`
 * (recallStorage.ts), which drops the unit and its memory rows while KEEPING the
 * reviews. */
export function deleteConcept(deckId: string, conceptId: string): void {
  persistDecks(
    getAllDeckRows().map((deck) =>
      deck.id === deckId
        ? {
            ...deck,
            concepts: deck.concepts.filter((concept) => concept.id !== conceptId),
            conceptMap: deck.conceptMap?.filter(
              (edge) => edge.from !== conceptId && edge.to !== conceptId,
            ),
            updatedAt: Date.now(),
          }
        : deck,
    ),
  );
}

/** Records how a deck's concepts relate, replacing any previous map wholesale.
 *
 * Replace rather than merge, because a mapping pass looks at the whole deck at once:
 * its answer supersedes one made when the deck was smaller, and merging would keep
 * edges from a pass that never had the chance to reconsider them. Stamps `updatedAt`
 * so sync carries the map to the account's other devices like any other deck edit.
 * A no-op if the deck has since been deleted. */
export function saveConceptMap(deckId: string, edges: readonly ConceptEdge[]): void {
  persistDecks(
    getAllDeckRows().map((deck) =>
      deck.id === deckId ? { ...deck, conceptMap: [...edges], updatedAt: Date.now() } : deck,
    ),
  );
}

/** Sets or clears the day this deck is examined.
 *
 * Stamps `updatedAt` so sync carries it, exactly as saveConceptMap does. Pass `null`
 * to clear - a deck with no exam is not the same as a deck whose exam has passed,
 * and the caller needs to be able to say so.
 *
 * Does NOT touch scheduling state on its own: existing memory rows carry the
 * retention target that was in force when they were last written, so the caller
 * follows this with `applyExamDateToMemory` (recallStorage.ts) to bring them into
 * line. Split that way because this module knows nothing about IndexedDB. */
export function setDeckExamDate(deckId: string, examDate: number | null): void {
  persistDecks(
    getAllDeckRows().map((deck) =>
      deck.id === deckId
        ? { ...deck, examDate: examDate ?? undefined, updatedAt: Date.now() }
        : deck,
    ),
  );
}

/** Deletes a deck by TOMBSTONING it, not by dropping the row.
 *
 * A row that simply vanishes cannot propagate: the next pull from another device
 * would find a deck the server still has and hand it straight back, so a student
 * who deleted something on their phone would watch it reappear. The tombstone is
 * what travels. Concepts, leftover source text and the concept map are all stripped,
 * so what remains is a few bytes rather than the whole deck. */
export function deleteDeck(id: string): void {
  const now = Date.now();
  persistDecks(
    getAllDeckRows().map((deck) =>
      deck.id === id
        ? {
            ...deck,
            concepts: [],
            pendingChunks: undefined,
            conceptMap: undefined,
            deletedAt: now,
            updatedAt: now,
          }
        : deck,
    ),
  );
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

// ── Sync cursor ──────────────────────────────────────────────────────────────
//
// Per user, because signing into a different account on the same device must not
// inherit the previous one's position - it would skip straight past that account's
// entire history and report nothing to pull. Swept by clearAllLocalUserData's
// prefix walk along with everything else.

function syncCursorKey(userId: string): string {
  return `flowrecall:syncCursor:${userId}`;
}

/** null means "never synced", which is what makes the first sync push everything. */
export function getSyncCursor(userId: string): number | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(syncCursorKey(userId));
  if (raw === null) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

export function setSyncCursor(userId: string, cursor: number): void {
  window.localStorage.setItem(syncCursorKey(userId), String(cursor));
}

/** Clears a session's saved progress - used when starting a fully-mastered
 * deck over again, so it doesn't resume straight into "nothing left to do." */
export function clearProgress(deckId: string): void {
  window.localStorage.removeItem(progressStorageKey(deckId));
  notifyLocalStorageUpdate();
}

// Kept across account deletion: a device display preference, not account data.
// Wiping it would flip the whole UI from dark to light mid-teardown, which
// reads as a bug at the exact moment the user needs to trust what just happened.
const THEME_STORAGE_KEY = "flowrecall-theme";

const OWNED_KEY_PREFIXES = ["flowrecall:", "flowrecall-", "flowrecall."];

/** The localStorage half of account deletion: saved decks, the in-progress
 * study deck, per-deck progress and reader preferences.
 *
 * Sweeps by PREFIX rather than from a list of known keys, because progress is
 * stored per deck under `flowrecall:progress:${deckId}` (see
 * progressStorageKey) - an enumerated list cannot name those, and would leave
 * one row behind per deck the user ever studied. */
export function clearAllLocalUserData(): void {
  const doomed: string[] = [];
  for (let i = 0; i < window.localStorage.length; i++) {
    const key = window.localStorage.key(i);
    if (key === null || key === THEME_STORAGE_KEY) continue;
    if (OWNED_KEY_PREFIXES.some((prefix) => key.startsWith(prefix))) doomed.push(key);
  }
  // Collected first, removed after: removing during the walk reindexes
  // localStorage under the cursor and silently skips the next key.
  for (const key of doomed) window.localStorage.removeItem(key);
  notifyLocalStorageUpdate();
}
