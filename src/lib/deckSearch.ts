import type { Deck } from "./types";

/** Finding a deck by typing, over the two things a student actually remembers about
 * one: what they called it, and what was in it.
 *
 * Card LABELS are searched, not card bodies. The label is the 2-6 words naming the
 * idea (see ConceptEditor's own field hints), so a hit on it is a hit on a concept;
 * `explanation` is a paragraph, which would make "the" match every deck a student
 * owns and drag ~30x more text through every keystroke for the privilege.
 *
 * Pure and total, like librarySort.ts next door: no window, no clock, and the input
 * order is preserved so the caller keeps deciding what "first" means.
 */

/** One deck that matched, and how much of it did.
 *
 * `cardMatches` is separate from inclusion on purpose: a deck can be in these results
 * because its TITLE matched and hold no matching cards at all, and the UI needs to
 * tell those apart to decide whether "3 cards match" is worth saying. */
export type DeckMatch = {
  deck: Deck;
  cardMatches: number;
};

/** Lower-cased and stripped of diacritics, so "Krebs" finds "krebs" and "resume"
 * finds "résumé".
 *
 * NFD-decompose-and-strip rather than librarySort's `localeCompare(..., {sensitivity:
 * "base"})`: that call orders two whole strings and has no substring form, and this
 * needs to ask whether one string occurs INSIDE another. Unicode property escapes are
 * ES2018 - fine on the Chrome 111 floor capacitor.config.ts already enforces. */
function fold(value: string): string {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

/** Every whitespace-separated piece of the query, folded. Empty when the query is
 * blank, which is what makes a blank query mean "everything" below. */
function tokenise(query: string): string[] {
  return fold(query).split(/\s+/).filter((token) => token.length > 0);
}

/** True when EVERY token occurs in this one haystack.
 *
 * All tokens against a single haystack, never spread across several: a query that
 * matched because one word is in the title and another is in some unrelated card
 * would return decks a student cannot see the reason for, which reads as the search
 * being broken rather than as being clever. */
function containsAll(haystack: string, tokens: readonly string[]): boolean {
  const folded = fold(haystack);
  return tokens.every((token) => folded.includes(token));
}

/** Decks matching `query`, in the order they were given.
 *
 * A blank query is not a filter: every deck comes back, with `cardMatches: 0` so no
 * card hint is shown for a search nobody ran. */
export function searchDecks(decks: readonly Deck[], query: string): DeckMatch[] {
  const tokens = tokenise(query);
  if (tokens.length === 0) return decks.map((deck) => ({ deck, cardMatches: 0 }));

  const matches: DeckMatch[] = [];
  for (const deck of decks) {
    const titleHit = containsAll(deck.title, tokens);
    let cardMatches = 0;
    for (const concept of deck.concepts) {
      if (containsAll(concept.concept, tokens)) cardMatches += 1;
    }
    if (titleHit || cardMatches > 0) matches.push({ deck, cardMatches });
  }
  return matches;
}
