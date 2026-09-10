import { beforeEach, describe, expect, it } from "vitest";
import {
  appendConceptsToDeck,
  clearAllLocalUserData,
  DeckStorageFullError,
  deleteConcept,
  deleteDeck,
  findDeckBySourceKey,
  getAllDeckRows,
  getFactCursor,
  getProgress,
  getSavedDecks,
  renameDeck,
  restoreDeck,
  saveDeck,
  setFactCursor,
  setStudyDeck,
  setStudySession,
  updateConcept,
} from "./storage";
import type { Concept, Deck, QueueItem } from "./types";

// vitest runs in the "node" environment (see vitest.config.ts), so there is no
// window. A minimal localStorage is enough for this: the point under test is
// which keys the sweep selects, not the storage implementation.
function installFakeStorage(seed: Record<string, string>) {
  const store = new Map(Object.entries(seed));
  const localStorage = {
    get length() {
      return store.size;
    },
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
  (globalThis as { window?: unknown }).window = {
    localStorage,
    dispatchEvent: () => true,
  };
  return store;
}

/** A device with no room left for another deck.
 *
 * Only `setItem` differs from installFakeStorage, which is exactly what makes the
 * real failure easy to miss: reads keep working, so everything downstream goes on
 * returning the decks as they were before the write that did not happen. */
function installFullStorage(error: unknown) {
  const store = new Map<string, string>([
    ["flowrecall:savedDecks", JSON.stringify([{ ...deck(), id: "existing" }])],
  ]);
  (globalThis as { window?: unknown }).window = {
    localStorage: {
      get length() {
        return store.size;
      },
      key: (i: number) => Array.from(store.keys())[i] ?? null,
      getItem: (k: string) => store.get(k) ?? null,
      setItem: () => {
        throw error;
      },
      removeItem: (k: string) => void store.delete(k),
    },
    dispatchEvent: () => true,
  };
}

describe("clearAllLocalUserData", () => {
  let store: Map<string, string>;

  beforeEach(() => {
    store = installFakeStorage({
      "flowrecall:savedDecks": "[]",
      "flowrecall:studyDeck": "{}",
      "flowrecall:progress:deck-a": "{}",
      "flowrecall:progress:deck-b": "{}",
      "flowrecall:progress:deck-c": "{}",
      "flowrecall:reader-prefs": "{}",
      "flowrecall.mobile-bridge-token": "tok",
      "flowrecall-theme": "dark",
      "unrelated-app-key": "keep me",
    });
  });

  it("removes every per-deck progress key, which a fixed key list cannot name", () => {
    clearAllLocalUserData();
    expect([...store.keys()].filter((k) => k.startsWith("flowrecall:progress:"))).toEqual([]);
  });

  it("removes decks, reader prefs and the auth bridge token", () => {
    clearAllLocalUserData();
    for (const key of [
      "flowrecall:savedDecks",
      "flowrecall:studyDeck",
      "flowrecall:reader-prefs",
      "flowrecall.mobile-bridge-token",
    ]) {
      expect(store.has(key)).toBe(false);
    }
  });

  // Wiping the theme would flip the UI light mid-teardown, which reads as a bug
  // at the moment the user most needs to trust what just happened.
  it("keeps the theme, a device preference rather than account data", () => {
    clearAllLocalUserData();
    expect(store.get("flowrecall-theme")).toBe("dark");
  });

  it("leaves keys belonging to anything else alone", () => {
    clearAllLocalUserData();
    expect(store.get("unrelated-app-key")).toBe("keep me");
  });

  it("is safe to run twice", () => {
    clearAllLocalUserData();
    const after = [...store.keys()].sort();
    clearAllLocalUserData();
    expect([...store.keys()].sort()).toEqual(after);
  });
});

// The two study handoffs are mutually exclusive, and /study prefers the session
// one. So a leftover from either write is not a harmless stale key: a stale
// session silently hijacks the next "Study this deck" tap, and a stale deck
// handoff would outlive the session it was replaced by. Each setter clearing the
// other is the whole guarantee, which makes it worth pinning.
describe("the study handoffs", () => {
  function installFakeSessionStorage() {
    const store = new Map<string, string>();
    (globalThis as { window?: unknown }).window = {
      sessionStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
        removeItem: (k: string) => void store.delete(k),
      },
      dispatchEvent: () => true,
    };
    return store;
  }

  const DECK_KEY = "flowrecall:studyDeck";
  const SESSION_KEY = "flowrecall:studySession";

  it("drops a deck handoff when the engine hands over a session", () => {
    const store = installFakeSessionStorage();
    setStudyDeck("deck-a", []);
    setStudySession([queueItem()]);
    expect(store.has(SESSION_KEY)).toBe(true);
    expect(store.has(DECK_KEY)).toBe(false);
  });

  it("drops a session when the student picks a deck, so it cannot hijack the tap", () => {
    const store = installFakeSessionStorage();
    setStudySession([queueItem()]);
    setStudyDeck("deck-a", []);
    expect(store.has(DECK_KEY)).toBe(true);
    expect(store.has(SESSION_KEY)).toBe(false);
  });
});

describe("correcting one card", () => {
  beforeEach(() => {
    installFakeStorage({ "flowrecall:savedDecks": JSON.stringify([deck()]) });
  });

  const cardsOf = () => getAllDeckRows()[0].concepts.map((c) => c.id);

  it("rewrites the card in place, keeping its id and its position", () => {
    // The id IS the history: memory rows are keyed deckId::conceptId, so a "fix"
    // that mints a new id would silently discard everything the student has proved.
    updateConcept("deck-a", { ...card("c2"), answer: "Corrected answer" });
    const rows = getAllDeckRows()[0];
    expect(cardsOf()).toEqual(["c1", "c2", "c3"]);
    expect(rows.concepts[1].answer).toBe("Corrected answer");
    expect(rows.concepts[0].answer).toBe("answer c1");
  });

  it("stamps updatedAt so sync carries the correction", () => {
    const before = getAllDeckRows()[0].updatedAt ?? 0;
    updateConcept("deck-a", { ...card("c2"), answer: "Corrected" });
    expect((getAllDeckRows()[0].updatedAt ?? 0)).toBeGreaterThan(before);
  });

  it("is a no-op for a card that is no longer in the deck", () => {
    updateConcept("deck-a", { ...card("gone"), answer: "x" });
    expect(cardsOf()).toEqual(["c1", "c2", "c3"]);
  });

  it("drops the card and every map edge that named it", () => {
    // A stored map outlives the concepts it names, and DeckLearningPath orders the
    // deck from these edges - a dangling one puts a deleted concept in the path.
    deleteConcept("deck-a", "c2");
    const row = getAllDeckRows()[0];
    expect(cardsOf()).toEqual(["c1", "c3"]);
    expect(row.conceptMap).toEqual([{ from: "c1", to: "c3", relation: "contrast" }]);
  });

  it("leaves no tombstone, because the deck row itself still travels", () => {
    deleteConcept("deck-a", "c2");
    expect(getAllDeckRows()[0].deletedAt).toBeUndefined();
  });
});

function card(id: string): Concept {
  return {
    id,
    concept: `label ${id}`,
    question: `question ${id}`,
    answer: `answer ${id}`,
    distractor: `distractor ${id}`,
    cloze: `the fact about ${id} is _____.`,
  };
}

function deck(): Deck {
  return {
    id: "deck-a",
    title: "Cardiac cycle",
    createdAt: 1_000,
    updatedAt: 2_000,
    concepts: [card("c1"), card("c2"), card("c3")],
    conceptMap: [
      { from: "c1", to: "c2", relation: "prerequisite" },
      { from: "c2", to: "c3", relation: "explains" },
      { from: "c1", to: "c3", relation: "contrast" },
    ],
  };
}

function queueItem(): QueueItem {
  return {
    key: "c1::1::0",
    concept: {
      id: "c1",
      concept: "Stroke volume",
      question: "What is stroke volume?",
      answer: "The blood ejected per beat",
      distractor: "The blood ejected per minute",
      cloze: "Stroke volume is the blood ejected _____.",
    },
    level: 1,
    lane: 1,
    attempt: 0,
    unitId: "deck-a::c1",
  };
}

describe("findDeckBySourceKey", () => {
  function seedDecks(decks: Deck[]) {
    installFakeStorage({ "flowrecall:savedDecks": JSON.stringify(decks) });
  }

  function deck(partial: Partial<Deck> & { id: string }): Deck {
    return {
      title: partial.id,
      createdAt: 1_000,
      concepts: [],
      ...partial,
    };
  }

  it("finds the deck a source has already been made into cards from", () => {
    seedDecks([deck({ id: "other", sourceKey: "9:zzz" }), deck({ id: "match", sourceKey: "9:aaa" })]);
    expect(findDeckBySourceKey("9:aaa")?.id).toBe("match");
  });

  it("returns null for a source nothing has been generated from", () => {
    seedDecks([deck({ id: "other", sourceKey: "9:zzz" })]);
    expect(findDeckBySourceKey("9:aaa")).toBeNull();
  });

  it("never matches a deck saved before sourceKey existed", () => {
    // Such a deck has no recoverable identity, so it degrades to a new deck rather
    // than to a wrong match - and an empty key must not match it either.
    seedDecks([deck({ id: "legacy" })]);
    expect(findDeckBySourceKey("9:aaa")).toBeNull();
    expect(findDeckBySourceKey("")).toBeNull();
  });

  it("ignores deleted decks", () => {
    // A tombstone is still in the row set; offering to continue one would resurrect
    // a deck the student deleted.
    seedDecks([deck({ id: "gone", sourceKey: "9:aaa", deletedAt: 2_000 })]);
    expect(findDeckBySourceKey("9:aaa")).toBeNull();
  });

  it("prefers the most recently touched match", () => {
    // Two decks share a key once a student has chosen "start a separate deck". The
    // one they are working on is the one they mean.
    seedDecks([
      deck({ id: "older", sourceKey: "9:aaa", createdAt: 1_000, updatedAt: 5_000 }),
      deck({ id: "newer", sourceKey: "9:aaa", createdAt: 2_000, updatedAt: 9_000 }),
    ]);
    expect(findDeckBySourceKey("9:aaa")?.id).toBe("newer");
  });

  it("falls back to createdAt for a deck that predates updatedAt", () => {
    seedDecks([
      deck({ id: "no-updated-at", sourceKey: "9:aaa", createdAt: 8_000 }),
      deck({ id: "updated-earlier", sourceKey: "9:aaa", createdAt: 1_000, updatedAt: 3_000 }),
    ]);
    expect(findDeckBySourceKey("9:aaa")?.id).toBe("no-updated-at");
  });

  it("does not offer another account's deck", () => {
    seedDecks([deck({ id: "theirs", sourceKey: "9:aaa", userId: "them" })]);
    expect(findDeckBySourceKey("9:aaa", "me")).toBeNull();
    // Unowned decks predate sync and are treated as the current user's, exactly as
    // they are everywhere else.
    seedDecks([deck({ id: "unowned", sourceKey: "9:aaa" })]);
    expect(findDeckBySourceKey("9:aaa", "me")?.id).toBe("unowned");
  });
});

describe("a device with no room left", () => {
  const quota = () => new DOMException("exceeded the quota", "QuotaExceededError");

  it("names a quota failure as one instead of leaking a DOMException", () => {
    installFullStorage(quota());

    // The type is the point: it is what lets runChunksContinuous end a run cleanly
    // and what lets the UI show a student something they can act on, rather than
    // "Failed to execute 'setItem' on 'Storage'".
    expect(() => saveDeck("Osho", [])).toThrow(DeckStorageFullError);
    expect(() => saveDeck("Osho", [])).toThrow(/out of space/);
  });

  it("fails a continuation's append rather than reporting cards it did not store", () => {
    installFullStorage(quota());

    expect(() => appendConceptsToDeck("existing", [], ["leftover"])).toThrow(DeckStorageFullError);
    // And the deck is untouched. A caller that took the write for granted would show
    // these sections as generated while their cards do not exist anywhere.
    expect(getAllDeckRows()[0].pendingChunks).toBeUndefined();
  });

  it("recognises the name Gecko uses for the same thing", () => {
    installFullStorage(new DOMException("out of space", "NS_ERROR_DOM_QUOTA_REACHED"));

    expect(() => saveDeck("Osho", [])).toThrow(DeckStorageFullError);
  });

  it("does not disguise an unrelated storage failure as a full device", () => {
    installFullStorage(new TypeError("localStorage is not available"));

    // Telling a student to delete a deck would be wrong here, and would hide a real
    // bug behind advice that cannot help.
    expect(() => saveDeck("Osho", [])).toThrow(TypeError);
    expect(() => saveDeck("Osho", [])).not.toThrow(DeckStorageFullError);
  });
});

// Renaming and undoing a deletion are the two writes the library screen makes that
// can lose a student's work if they are wrong in the wrong direction: one can blank
// a title, and the other is the only thing standing between a mis-tap and a deck.
describe("renameDeck", () => {
  beforeEach(() => {
    installFakeStorage({ "flowrecall:savedDecks": JSON.stringify([deck()]) });
  });

  it("renames the deck and stamps updatedAt, so sync carries it", () => {
    const before = getAllDeckRows()[0].updatedAt!;
    renameDeck("deck-a", "Krebs Cycle — Lecture 4");

    const row = getAllDeckRows()[0];
    expect(row.title).toBe("Krebs Cycle — Lecture 4");
    expect(row.updatedAt!).toBeGreaterThan(before);
  });

  it("changes nothing else about the deck", () => {
    renameDeck("deck-a", "New name");

    const row = getAllDeckRows()[0];
    expect(row.concepts).toHaveLength(3);
    expect(row.conceptMap).toHaveLength(3);
    expect(row.id).toBe("deck-a");
    expect(row.createdAt).toBe(1_000);
  });

  it("is a no-op for a deck that does not exist", () => {
    const before = JSON.stringify(getAllDeckRows());
    renameDeck("deck-missing", "New name");
    expect(JSON.stringify(getAllDeckRows())).toBe(before);
  });

  // Writing to a tombstone would revive a row the student deleted on purpose, and
  // last-write-wins would then push that revival to every other device.
  it("refuses to touch a tombstone", () => {
    deleteDeck("deck-a");
    renameDeck("deck-a", "Back from the dead");

    expect(getAllDeckRows()[0].title).toBe("Cardiac cycle");
    expect(getAllDeckRows()[0].deletedAt).toBeDefined();
  });
});

describe("restoreDeck", () => {
  const progress = { deckId: "deck-a", masteredIds: ["c1", "c2"], queue: [] };

  beforeEach(() => {
    installFakeStorage({
      "flowrecall:savedDecks": JSON.stringify([deck()]),
      "flowrecall:progress:deck-a": JSON.stringify(progress),
    });
  });

  it("brings back a deck the student just deleted, contents and all", () => {
    const original = getSavedDecks()[0];
    const savedProgress = getProgress("deck-a");
    deleteDeck("deck-a");
    expect(getSavedDecks()).toHaveLength(0);

    restoreDeck(original, savedProgress);

    const back = getSavedDecks();
    expect(back).toHaveLength(1);
    expect(back[0].title).toBe("Cardiac cycle");
    // deleteDeck strips these, which is exactly why restore takes the whole deck.
    expect(back[0].concepts).toHaveLength(3);
    expect(back[0].conceptMap).toHaveLength(3);
    expect(back[0].deletedAt).toBeUndefined();
  });

  it("brings the session back with it", () => {
    const original = getSavedDecks()[0];
    const savedProgress = getProgress("deck-a");
    deleteDeck("deck-a");
    expect(getProgress("deck-a")).toBeNull();

    restoreDeck(original, savedProgress);

    expect(getProgress("deck-a")?.masteredIds).toEqual(["c1", "c2"]);
  });

  // The tombstone may already have synced. A restore that did not out-stamp it
  // would be undone by the next pull.
  it("stamps a newer updatedAt than the tombstone it replaces", () => {
    const original = getSavedDecks()[0];
    deleteDeck("deck-a");
    const tombstonedAt = getAllDeckRows()[0].updatedAt!;

    restoreDeck(original, null);

    expect(getAllDeckRows()[0].updatedAt!).toBeGreaterThanOrEqual(tombstonedAt);
  });

  it("restores a deck whose row has gone entirely, not just been tombstoned", () => {
    const original = getSavedDecks()[0];
    installFakeStorage({ "flowrecall:savedDecks": "[]" });

    restoreDeck(original, null);

    expect(getSavedDecks().map((d) => d.id)).toEqual(["deck-a"]);
  });

  it("does not write a progress key when there was no session to restore", () => {
    const original = getSavedDecks()[0];
    deleteDeck("deck-a");

    restoreDeck(original, null);

    expect(getProgress("deck-a")).toBeNull();
  });
});

// The line under "Your Library" advances one step per visit, and this is the whole of
// its state. Worth pinning because the failure is silent: a cursor that reads back as
// NaN would freeze the header on one fact forever without anything appearing broken.
describe("the brain-fact cursor", () => {
  it("starts at zero on a device that has never shown one", () => {
    installFakeStorage({});
    expect(getFactCursor()).toBe(0);
  });

  it("round-trips", () => {
    installFakeStorage({});
    setFactCursor(7);
    expect(getFactCursor()).toBe(7);
  });

  it("reads garbage as zero rather than as NaN", () => {
    installFakeStorage({ "flowrecall:factCursor": "not a number" });
    expect(getFactCursor()).toBe(0);
  });

  it("is swept with the rest of the account's local data", () => {
    const store = installFakeStorage({ "flowrecall:factCursor": "3" });
    clearAllLocalUserData();
    expect(store.has("flowrecall:factCursor")).toBe(false);
  });
});
