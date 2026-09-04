import { beforeEach, describe, expect, it } from "vitest";
import {
  appendConceptsToDeck,
  clearAllLocalUserData,
  DeckStorageFullError,
  deleteConcept,
  findDeckBySourceKey,
  getAllDeckRows,
  saveDeck,
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
