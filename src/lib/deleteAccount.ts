/** Whether what the user typed into the delete-account sheet authorises the
 * deletion. Deliberately forgiving about the things a phone keyboard adds on
 * its own - surrounding whitespace and capitalisation - and unforgiving about
 * everything else: the point of the gate is that you cannot clear it without
 * knowing which account you are destroying.
 *
 * A blank expected address never matches. An account can have a null email
 * (the schema allows it), and treating "" as satisfied would turn the gate into
 * a single tap for exactly the users who have no other identifier to confirm. */
export function confirmationMatches(typed: string, expected: string | null | undefined): boolean {
  if (!expected) return false;
  return typed.trim().toLowerCase() === expected.trim().toLowerCase();
}
