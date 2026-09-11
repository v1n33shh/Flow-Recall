/** The Pro launch discount, and the date it stops being true.
 *
 * The pricing page used to show ₹499 struck through beside ₹299 unconditionally, with no
 * end date and nothing on the page saying what the offer was. A "was" price that is always
 * shown is not a discount, it is a decoration that claims to be one - and fabricated
 * reference pricing is specifically named in India's 2023 CCPA dark-pattern guidelines,
 * which is a real exposure for a product billing in rupees.
 *
 * So the offer is now a date rather than a decoration. Everything about the strikethrough
 * is gated on `launchOfferActive`, which means the honest outcome is the DEFAULT one: when
 * this date passes, the struck price and its caption remove themselves and the page simply
 * shows what Pro costs. Nobody has to remember to take it down, which is exactly how it
 * became permanent the first time.
 *
 * TO EXTEND THE OFFER: move this date, deliberately, and know you are re-making the claim.
 * TO END IT: move it into the past, or delete the two constants and their call sites.
 */

/** Local midnight at the end of the offer. Month is 0-indexed, per Date. */
export const LAUNCH_OFFER_ENDS = new Date(2026, 9, 31, 23, 59, 59).getTime();

/** What Pro cost before the launch discount. Only ever rendered while the offer holds. */
export const LAUNCH_OFFER_WAS = { monthly: "₹499", yearly: "₹3588" } as const;

/** Whether the struck-through price may still be shown.
 *
 * Takes `now` so it is testable without mocking the clock, which is what lets the
 * expiry itself be asserted rather than trusted. */
export function launchOfferActive(now: number = Date.now()): boolean {
  return now <= LAUNCH_OFFER_ENDS;
}

/** "until 31 October", for the caption under the price.
 *
 * Deliberately no year: the caption sits beside a date weeks away, and a year on it reads
 * as a legal notice rather than a deadline. */
export function launchOfferEndLabel(locale?: string): string {
  return new Date(LAUNCH_OFFER_ENDS).toLocaleDateString(locale, {
    day: "numeric",
    month: "long",
  });
}
