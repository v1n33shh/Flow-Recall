import type { LibrarySort } from "@/lib/readerPreferences";
import type { BookMeta } from "@/lib/types";

export const LIBRARY_SORT_LABELS: Record<LibrarySort, string> = {
  recent: "Recent",
  title: "Title",
  progress: "Progress",
};

/** When a book was last touched: opened if it ever was, added otherwise. A
 * never-opened book sorts by when it arrived, which is the only date it has. */
function lastTouched(book: BookMeta): number {
  return book.lastOpenedAt ?? book.addedAt;
}

/** Case- and accent-insensitive, and numeric so "Chapter 2" precedes
 * "Chapter 10". Falls back to a plain comparison where Intl is unavailable. */
function compareTitles(a: BookMeta, b: BookMeta): number {
  return a.title.localeCompare(b.title, undefined, { sensitivity: "base", numeric: true });
}

/** Orders the library grid. Pure, and total: every comparison ends in a
 * tiebreak that cannot return 0 for two different books, so the grid never
 * reshuffles itself between renders on equal keys (three copies of the same
 * book under "Title" is exactly that case, and it is the one the user is
 * looking at when they come here to clear duplicates).
 *
 * Returns a new array - `useBooks` hands out the same array identity until the
 * library changes, and sorting in place would mutate it. */
export function sortBooks(books: BookMeta[], sort: LibrarySort): BookMeta[] {
  const ordered = [...books];

  if (sort === "title") {
    // Oldest copy first among identical titles, so the duplicate a user is
    // most likely to keep (the one they have been reading) stays put at the
    // front of the run rather than moving as the others are deleted.
    ordered.sort((a, b) => compareTitles(a, b) || a.addedAt - b.addedAt || a.id.localeCompare(b.id));
    return ordered;
  }

  if (sort === "progress") {
    // Furthest read first. A never-opened book has progress 0 and lands at the
    // end, which is where a "how far am I" view wants it.
    ordered.sort(
      (a, b) => b.progress - a.progress || lastTouched(b) - lastTouched(a) || a.id.localeCompare(b.id),
    );
    return ordered;
  }

  ordered.sort((a, b) => lastTouched(b) - lastTouched(a) || compareTitles(a, b) || a.id.localeCompare(b.id));
  return ordered;
}
