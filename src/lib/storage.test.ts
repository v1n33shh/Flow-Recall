import { beforeEach, describe, expect, it } from "vitest";
import { clearAllLocalUserData, setStudyDeck, setStudySession } from "./storage";
import type { QueueItem } from "./types";

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
