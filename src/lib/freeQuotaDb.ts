import { prisma } from "@/lib/prisma";
import { startOfLocalMonth } from "@/lib/localDay";
import { FREE_DECKS_PER_MONTH, FREE_LOOKUPS_PER_MONTH } from "@/lib/freeQuota";

/** Spends one deck from this month's FREE allowance, or returns false if it is gone.
 *
 * Split from freeQuota.ts because that file's constant is rendered in the ingest
 * page's paywall copy, and a client component in the Capacitor static export cannot
 * import prisma. Same division of labour as clozeGradeRateLimit.ts, which is only
 * ever reached from a route.
 *
 * Called AFTER a successful generation, never before: a model failure must not cost
 * a student one of their three. The cost of that ordering is that a lost race has
 * already spent real money, which is why the caller checks the return value rather
 * than assuming it.
 *
 * Race-safe in two statements rather than the one clozeGradeRateLimit needs, because
 * this one gates revenue. The reset is a conditional `updateMany` whose data is
 * idempotent - two concurrent requests at a month boundary both write count 0 and the
 * same marker, after which the row is no longer stale and no further reset fires, so
 * the `lt` guard on the increment still sees a single shared count. An unconditional
 * reset-to-1, which is what the daily cap does, would instead hand each of those two
 * requests its own fresh month. */
export async function claimDeckAllowance(
  userId: string,
  now: Date,
  timezoneOffsetMinutes: number,
): Promise<boolean> {
  const monthStart = startOfLocalMonth(now, timezoneOffsetMinutes);

  await prisma.user.updateMany({
    where: { id: userId, lastDeckGeneratedDate: { lt: monthStart } },
    // The marker, not `now`: it keeps the write idempotent and leaves the row
    // non-stale, so the increment below is the only thing that can move the count.
    data: { decksGeneratedToday: 0, lastDeckGeneratedDate: monthStart },
  });

  const result = await prisma.user.updateMany({
    where: { id: userId, decksGeneratedToday: { lt: FREE_DECKS_PER_MONTH } },
    data: { decksGeneratedToday: { increment: 1 }, lastDeckGeneratedDate: now },
  });
  return result.count > 0;
}

/** Spends one AI lookup from this month's FREE allowance, or returns false if it is
 * gone. Shared by /api/define, /api/ask and /api/concept-map, which all draw on the
 * one `definitionsUsed` counter.
 *
 * **The lookup month is UTC, not the student's** - the one place this file departs
 * from the convention every other date calculation here follows, and the reason is
 * `/api/define`'s only caller: the reader's DefinitionPopover, which is finished work
 * and must not be edited to add an offset to its request. One counter cannot have
 * three different month boundaries without the routes disagreeing about whether it is
 * stale, so all three use the same one. A student in UTC+5:30 gets their lookups back
 * at 05:30 on the 1st rather than midnight; against a 60-a-month allowance that is
 * not worth touching the reader for.
 *
 * Same two-statement, idempotent-reset shape as claimDeckAllowance - see there for
 * why the reset is conditional rather than an unconditional set-to-1. */
export async function claimLookupAllowance(userId: string, now: Date): Promise<boolean> {
  const monthStart = startOfLocalMonth(now, 0);

  await prisma.user.updateMany({
    where: { id: userId, lookupsResetAt: { lt: monthStart } },
    data: { definitionsUsed: 0, lookupsResetAt: monthStart },
  });

  const result = await prisma.user.updateMany({
    where: { id: userId, definitionsUsed: { lt: FREE_LOOKUPS_PER_MONTH } },
    data: { definitionsUsed: { increment: 1 }, lookupsResetAt: now },
  });
  return result.count > 0;
}

/** Spends one generation request from this month's allowance, or returns false if it
 * is gone. Drawn on by /api/ingest for EVERY chunk and by /api/decks/[id]/shuffle,
 * with the caller's plan deciding the ceiling (generationLimitForPlan).
 *
 * Called BEFORE the model call, which is the opposite of claimDeckAllowance and
 * deliberate. That one claims afterwards so a model failure cannot cost a student one
 * of their three decks. This one is metering money, and the money is spent the moment
 * the request goes out - a generation that fails still burned the tokens. Claiming
 * afterwards would leave the ceiling advisory, since a stream of failures would spend
 * without ever being counted.
 *
 * Same two-statement, idempotent-reset shape as the two allowances above - see
 * claimDeckAllowance for why the reset is conditional rather than an unconditional
 * set-to-1. The month follows the student's own timezone like the deck allowance
 * does, not UTC like the lookup one: both of this allowance's callers already send
 * `timezoneOffsetMinutes`, so there is no finished-work constraint to work around. */
export async function claimGenerationRequest(
  userId: string,
  now: Date,
  timezoneOffsetMinutes: number,
  limit: number,
): Promise<boolean> {
  const monthStart = startOfLocalMonth(now, timezoneOffsetMinutes);

  await prisma.user.updateMany({
    where: { id: userId, generationResetAt: { lt: monthStart } },
    data: { generationRequestsUsed: 0, generationResetAt: monthStart },
  });

  const result = await prisma.user.updateMany({
    where: { id: userId, generationRequestsUsed: { lt: limit } },
    data: { generationRequestsUsed: { increment: 1 }, generationResetAt: now },
  });
  return result.count > 0;
}
