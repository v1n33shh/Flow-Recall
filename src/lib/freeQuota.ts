import { isNewLocalMonth } from "@/lib/localDay";

/** How many decks a FREE account may generate per calendar month.
 *
 * This used to be one deck for LIFE, and that was the single biggest thing
 * standing between the app and a second user: a student generated one deck, hit a
 * wall, and never reached the revision sheet, the concept map, teach-it-back or the
 * exam-day projection - which is to say, never reached any of the reasons to prefer
 * this to Anki, which is free. The differentiators have to land before the paywall
 * does, or they are not differentiators, they are screenshots.
 *
 * Monthly rather than lifetime because the cost being protected is per-generation
 * AI spend, and that recurs; a lifetime cap protects nothing a monthly one doesn't
 * while making the free tier feel like a demo. FREE stays pinned to Groq
 * (see /api/ingest), so the generosity here is in the count, not the model - which
 * is what PRO still sells.
 *
 * No prisma import in this file on purpose: the ingest page renders the number in
 * its paywall copy, and it is a client component in a static export where
 * src/app/api is moved aside (see scripts/build-capacitor.mjs). The database half
 * of the allowance lives in freeQuotaDb.ts. */
export const FREE_DECKS_PER_MONTH = 3;

/** How many AI lookups a FREE account may spend per calendar month, shared by
 * /api/define (a word looked up in the reader), /api/ask (asking a card anything)
 * and /api/concept-map (mapping a deck's structure).
 *
 * This was 20 for LIFE, and it was the crueller of the two old caps: it priced the
 * comprehension layer - the part of this app Anki has no answer to - out of the free
 * tier entirely. Mapping a single 120-concept deck costs three of it on its own
 * (MAP_BATCH_SIZE is 40), and every word a student looks up while reading spends one
 * more. A student could exhaust their lifetime supply before finishing one chapter.
 *
 * 60 is set from that arithmetic rather than a round number: a couple of decks mapped,
 * a dozen cards asked about, and a month of ordinary reading lookups all fit, and it
 * is still bounded spend on the free Groq model. */
export const FREE_LOOKUPS_PER_MONTH = 60;

/** The count that applies right now, treating a stored count from an earlier month
 * as spent-and-expired. Shared by both allowances above.
 *
 * Pure, so the paywall arithmetic is testable without a database: the route needs
 * this before generating (to refuse cheaply, rather than spending money on a request
 * it is about to reject) and the claim needs the same reading afterwards.
 *
 * A null `markedAt` returns the stored count unchanged rather than 0 - for every real
 * row that pairs with a count of 0 anyway, and inventing a rollover for a row with no
 * marker would hand a fresh allowance to anyone whose marker failed to write. */
export function countInCurrentMonth(
  storedCount: number,
  markedAt: Date | null,
  now: Date,
  timezoneOffsetMinutes: number,
): number {
  if (markedAt === null) return storedCount;
  return isNewLocalMonth(markedAt, now, timezoneOffsetMinutes) ? 0 : storedCount;
}
