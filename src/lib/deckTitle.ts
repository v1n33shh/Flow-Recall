/** What a student typed into a deck's title, reduced to what should be stored.
 *
 * `null` means "this is not a title" - every caller reads that as KEEP THE OLD ONE
 * rather than as "clear it". A deck with no name is not a state this app has any
 * screen for: the library card, the revision sheet and the recognition card all
 * render `deck.title` directly, and an empty string leaves a nameless row a student
 * then cannot tell apart from any other.
 *
 * Whitespace is collapsed rather than merely trimmed because a phone keyboard's
 * autocomplete inserts trailing spaces freely, and "Krebs  Cycle" and "Krebs Cycle"
 * being two different titles is a distinction no student means to make.
 */

/** Cap on a stored title.
 *
 * Well under the 500 `/api/sync`'s `deckSchema` accepts, deliberately: the sync cap
 * is the point past which a payload is refused, and this is the point past which a
 * title stops fitting the card that has to show it. Enforced here AND as the input's
 * own `maxLength`, so a paste that overshoots is cut rather than rejected. */
export const MAX_DECK_TITLE = 120;

export function normaliseDeckTitle(raw: string): string | null {
  const collapsed = raw.trim().replace(/\s+/g, " ");
  if (collapsed.length === 0) return null;
  // trimEnd again after slicing: cutting mid-string can leave the space that used to
  // sit between two words dangling at the end.
  return collapsed.slice(0, MAX_DECK_TITLE).trimEnd();
}
