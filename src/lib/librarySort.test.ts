import { describe, expect, it } from "vitest";
import { sortBooks } from "@/lib/librarySort";
import type { BookMeta } from "@/lib/types";

function book(partial: Partial<BookMeta> & { id: string }): BookMeta {
  return {
    type: "pdf",
    title: "Untitled",
    author: null,
    coverDataUrl: null,
    lastPosition: null,
    progress: 0,
    addedAt: 1_000,
    lastOpenedAt: null,
    ...partial,
  };
}

const ids = (books: BookMeta[]) => books.map((b) => b.id);

describe("recent", () => {
  it("puts the most recently opened first, and falls back to when a book was added", () => {
    const library = [
      book({ id: "added-first", addedAt: 100 }),
      book({ id: "opened-today", addedAt: 50, lastOpenedAt: 9_000 }),
      book({ id: "added-last", addedAt: 200 }),
      book({ id: "opened-yesterday", addedAt: 10, lastOpenedAt: 5_000 }),
    ];
    expect(ids(sortBooks(library, "recent"))).toEqual([
      "opened-today",
      "opened-yesterday",
      "added-last",
      "added-first",
    ]);
  });
});

describe("title", () => {
  it("ignores case and accents, and reads numbers as numbers", () => {
    const library = [
      book({ id: "ten", title: "Chapter 10" }),
      book({ id: "two", title: "chapter 2" }),
      book({ id: "eleve", title: "Élan" }),
      book({ id: "atlas", title: "atlas" }),
    ];
    expect(ids(sortBooks(library, "title"))).toEqual(["atlas", "two", "ten", "eleve"]);
  });

  it("groups duplicates together, oldest copy first", () => {
    // The case this sort exists for: three imports of one book, scattered
    // through the grid because IndexedDB hands them back in random id order.
    const library = [
      book({ id: "copy-b", title: "The Book of Wisdom", addedAt: 200 }),
      book({ id: "chess", title: "Chess: 5334 Problems" }),
      book({ id: "copy-c", title: "The Book of Wisdom", addedAt: 300 }),
      book({ id: "copy-a", title: "The Book of Wisdom", addedAt: 100 }),
    ];
    expect(ids(sortBooks(library, "title"))).toEqual(["chess", "copy-a", "copy-b", "copy-c"]);
  });
});

describe("progress", () => {
  it("puts the furthest-read first and never-opened books last", () => {
    const library = [
      book({ id: "untouched" }),
      book({ id: "half", progress: 0.5 }),
      book({ id: "nearly-done", progress: 0.92 }),
      book({ id: "just-started", progress: 0.03 }),
    ];
    expect(ids(sortBooks(library, "progress"))).toEqual(["nearly-done", "half", "just-started", "untouched"]);
  });
});

describe("every order is stable and non-destructive", () => {
  const library = [
    book({ id: "b", title: "Same", addedAt: 500, progress: 0.4, lastOpenedAt: 700 }),
    book({ id: "a", title: "Same", addedAt: 500, progress: 0.4, lastOpenedAt: 700 }),
    book({ id: "c", title: "Same", addedAt: 500, progress: 0.4, lastOpenedAt: 700 }),
  ];

  for (const sort of ["recent", "title", "progress"] as const) {
    it(`${sort} breaks a total tie deterministically`, () => {
      // Every key identical: without a final tiebreak the grid could reorder
      // itself on any re-render, which is unbearable while ticking checkboxes.
      expect(ids(sortBooks(library, sort))).toEqual(["a", "b", "c"]);
      expect(ids(sortBooks(library, sort))).toEqual(ids(sortBooks([...library].reverse(), sort)));
    });
  }

  it("leaves the array it was given alone", () => {
    const original = [book({ id: "z", title: "Z" }), book({ id: "a", title: "A" })];
    sortBooks(original, "title");
    expect(ids(original)).toEqual(["z", "a"]);
  });
});
