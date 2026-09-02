import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { claimDeckAllowance, claimLookupAllowance } from "./freeQuotaDb";
import { FREE_DECKS_PER_MONTH, FREE_LOOKUPS_PER_MONTH } from "./freeQuota";

// Integration test against real Postgres, for the same reason
// clozeGradeRateLimit.test.ts is one: everything these two functions do IS Prisma's
// atomic conditional-increment and month-rollover semantics, so a mocked client
// would only test the mock. The guarantee being checked here does not live in this
// repo's code at all - it lives in Postgres taking a row lock and then
// re-evaluating the UPDATE's WHERE clause against the committed row. Nothing but a
// real connection can show that.
//
// This is also the one test the plan for this tranche asked for by name: "the race
// guard needs a test that two concurrent first chunks cannot both pass." These two
// functions gate revenue, and both of the money-losing failures are concurrent:
// two requests both taking the last free slot, and two requests at a month boundary
// each being handed its own fresh month.
//
// Every test creates its own disposable user and never touches a real account. They
// are all cleaned up in one statement at the end rather than one per test: at roughly
// a second per round-trip to the pooler, the deletes alone were a sixth of the file's
// runtime. It costs about 70s, which is the price of testing the thing itself instead
// of a mock of it.

const UTC = 0;
/** UTC+5:30, the zone this app is actually used in. getTimezoneOffset() reports UTC
 * minus local, so a zone ahead of UTC is negative. */
const IST = -330;

const NOW = new Date("2026-09-15T10:00:00.000Z");
const EARLIER_THIS_MONTH = new Date("2026-09-02T10:00:00.000Z");
const LAST_MONTH = new Date("2026-08-20T10:00:00.000Z");

/** 00:30 IST on 1 September, which is still 19:00 UTC on 31 August - the one instant
 * where the student's calendar month and the server's disagree. */
const JUST_AFTER_IST_MIDNIGHT = new Date("2026-08-31T19:00:00.000Z");
/** 23:00 IST on 31 August: the previous month for that student, the same month in UTC. */
const LATE_ON_IST_AUG_31 = new Date("2026-08-31T17:30:00.000Z");

type Counters = {
  decksGeneratedToday?: number;
  lastDeckGeneratedDate?: Date | null;
  definitionsUsed?: number;
  lookupsResetAt?: Date | null;
};

const createdUserIds: string[] = [];

afterAll(async () => {
  // By prefix as well as by id, so a run that was killed mid-file does not leave
  // rows behind for the next one to trip over.
  await prisma.user
    .deleteMany({
      where: {
        OR: [{ id: { in: createdUserIds } }, { email: { startsWith: "freequota-test-" } }],
      },
    })
    .catch(() => {});
});

/** Counters are set in the CREATE rather than a follow-up update, purely to keep one
 * round-trip out of every test in a file that pays real network latency per query. */
async function makeTestUser(counters: Counters = {}): Promise<string> {
  const user = await prisma.user.create({
    data: {
      email: `freequota-test-${Date.now()}-${Math.random().toString(36).slice(2)}@example.invalid`,
      plan: "FREE",
      ...counters,
    },
  });
  createdUserIds.push(user.id);
  return user.id;
}

async function read(userId: string) {
  const row = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      decksGeneratedToday: true,
      lastDeckGeneratedDate: true,
      definitionsUsed: true,
      lookupsResetAt: true,
    },
  });
  if (!row) throw new Error("the disposable test user vanished mid-test");
  return row;
}

describe("claimDeckAllowance", () => {
  it("allows the first deck a student ever generates", async () => {
    // A brand-new row: count 0, and no marker at all. The reset cannot fire on a
    // NULL marker (SQL `lt` never matches NULL), so this proves the claim does not
    // depend on one having been written first.
    const userId = await makeTestUser();
    expect(await claimDeckAllowance(userId, NOW, IST)).toBe(true);
    expect((await read(userId)).decksGeneratedToday).toBe(1);
  });

  it("allows exactly the month's allowance and blocks the next one", async () => {
    const userId = await makeTestUser({
      decksGeneratedToday: FREE_DECKS_PER_MONTH - 1,
      lastDeckGeneratedDate: EARLIER_THIS_MONTH,
    });

    // The allowance-th deck of the month must still land.
    expect(await claimDeckAllowance(userId, NOW, IST)).toBe(true);
    expect((await read(userId)).decksGeneratedToday).toBe(FREE_DECKS_PER_MONTH);

    // One past it must be refused, and must not move the count - a blocked request
    // that still increments would push a student further from their next allowance
    // every time they hit the wall.
    expect(await claimDeckAllowance(userId, NOW, IST)).toBe(false);
    expect((await read(userId)).decksGeneratedToday).toBe(FREE_DECKS_PER_MONTH);
  });

  it("returns the whole allowance at the start of a new month", async () => {
    const userId = await makeTestUser({
      decksGeneratedToday: FREE_DECKS_PER_MONTH,
      lastDeckGeneratedDate: LAST_MONTH,
    });

    expect(await claimDeckAllowance(userId, NOW, IST)).toBe(true);
    // 1, not FREE_DECKS_PER_MONTH + 1: the rollover zeroes the count rather than
    // raising the ceiling, so this month's remaining decks are the full allowance
    // minus the one just spent.
    expect((await read(userId)).decksGeneratedToday).toBe(1);
  });

  it("does not roll over inside the same month", async () => {
    const userId = await makeTestUser({
      decksGeneratedToday: FREE_DECKS_PER_MONTH,
      lastDeckGeneratedDate: EARLIER_THIS_MONTH,
    });
    expect(await claimDeckAllowance(userId, NOW, IST)).toBe(false);
  });

  it("cannot be made to roll over by a marker in the future", async () => {
    // A corrected device clock, or a marker written by a machine whose clock was
    // ahead. The reset guard is `lt monthStart`, so a later month never matches and
    // the count stands - a wrong clock must not be able to mint an allowance.
    const userId = await makeTestUser({
      decksGeneratedToday: FREE_DECKS_PER_MONTH,
      lastDeckGeneratedDate: new Date("2026-11-05T10:00:00.000Z"),
    });
    expect(await claimDeckAllowance(userId, NOW, IST)).toBe(false);
  });

  it("counts the month in the student's timezone, not the server's", async () => {
    // 00:30 IST on 1 September against a marker at 23:00 IST on 31 August. For the
    // student that is a new month; read as raw UTC both instants are still August.
    // Vercel's process clock is UTC, so without the offset a student in IST would
    // wait five and a half hours past their own midnight for their decks back.
    const userId = await makeTestUser({
      decksGeneratedToday: FREE_DECKS_PER_MONTH,
      lastDeckGeneratedDate: LATE_ON_IST_AUG_31,
    });
    expect(await claimDeckAllowance(userId, JUST_AFTER_IST_MIDNIGHT, IST)).toBe(true);

    // Same row, same two instants, offset 0: the server's month has not turned over,
    // so the allowance is still spent.
    await prisma.user.update({
      where: { id: userId },
      data: {
        decksGeneratedToday: FREE_DECKS_PER_MONTH,
        lastDeckGeneratedDate: LATE_ON_IST_AUG_31,
      },
    });
    expect(await claimDeckAllowance(userId, JUST_AFTER_IST_MIDNIGHT, UTC)).toBe(false);
  });

  it("cannot let two concurrent first chunks both take the last slot", async () => {
    // The failure this exists to prevent: two ingest requests read the same
    // pre-increment count, both pass the route's cheap check, and both generate a
    // deck. The route's check cannot stop that - only the conditional UPDATE can,
    // because Postgres re-evaluates `decksGeneratedToday < N` after the row lock,
    // by which time the winner's increment is committed.
    const userId = await makeTestUser({
      decksGeneratedToday: FREE_DECKS_PER_MONTH - 1,
      lastDeckGeneratedDate: EARLIER_THIS_MONTH,
    });

    const results = await Promise.all([
      claimDeckAllowance(userId, NOW, IST),
      claimDeckAllowance(userId, NOW, IST),
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
    expect((await read(userId)).decksGeneratedToday).toBe(FREE_DECKS_PER_MONTH);
  });

  it("hands out one allowance at a month boundary, not one per concurrent request", async () => {
    // The subtler race, and the reason the reset is a conditional updateMany whose
    // data is idempotent rather than the unconditional set-to-1 the daily cap uses:
    // every racer here sees the same stale marker. Because the reset writes the
    // marker itself, the first one to commit leaves the row non-stale, so no second
    // reset can fire and wipe out a claim that has already been counted.
    const userId = await makeTestUser({
      decksGeneratedToday: FREE_DECKS_PER_MONTH,
      lastDeckGeneratedDate: LAST_MONTH,
    });

    const results = await Promise.all(
      Array.from({ length: FREE_DECKS_PER_MONTH + 1 }, () =>
        claimDeckAllowance(userId, NOW, IST),
      ),
    );

    expect(results.filter(Boolean)).toHaveLength(FREE_DECKS_PER_MONTH);
    expect((await read(userId)).decksGeneratedToday).toBe(FREE_DECKS_PER_MONTH);
  });
});

describe("claimLookupAllowance", () => {
  it("allows exactly the month's lookups and blocks the next one", async () => {
    const userId = await makeTestUser({
      definitionsUsed: FREE_LOOKUPS_PER_MONTH - 1,
      lookupsResetAt: EARLIER_THIS_MONTH,
    });

    expect(await claimLookupAllowance(userId, NOW)).toBe(true);
    expect((await read(userId)).definitionsUsed).toBe(FREE_LOOKUPS_PER_MONTH);

    expect(await claimLookupAllowance(userId, NOW)).toBe(false);
    expect((await read(userId)).definitionsUsed).toBe(FREE_LOOKUPS_PER_MONTH);
  });

  it("returns the whole allowance at the start of a new month", async () => {
    const userId = await makeTestUser({
      definitionsUsed: FREE_LOOKUPS_PER_MONTH,
      lookupsResetAt: LAST_MONTH,
    });

    expect(await claimLookupAllowance(userId, NOW)).toBe(true);
    expect((await read(userId)).definitionsUsed).toBe(1);
  });

  it("carries a count from the old lifetime cap and starts rolling over from the next lookup", async () => {
    // The live state of every row this migration touched: a count spent under the old
    // "20 for life" rule, and lookupsResetAt NULL because nothing had ever written
    // it. NULL must NOT read as "new month" - that would hand a fresh allowance to
    // anyone whose marker failed to write - so the old count stands, and the first
    // successful claim is what stamps the month the rollover will measure from.
    const userId = await makeTestUser({ definitionsUsed: 20, lookupsResetAt: null });

    expect(await claimLookupAllowance(userId, NOW)).toBe(true);
    const row = await read(userId);
    expect(row.definitionsUsed).toBe(21);
    expect(row.lookupsResetAt).not.toBeNull();
  });

  it("counts the lookup month in UTC even for a student who is not, deliberately", async () => {
    // The one place this codebase does not use the student's own month, and it is a
    // decision rather than an oversight: /api/define is called by the reader's
    // DefinitionPopover, which is finished work and must not be edited to add an
    // offset to its request. One counter cannot carry three different month
    // boundaries without the three routes disagreeing about whether it is stale, so
    // all three read UTC. A student in IST gets their lookups back at 05:30 on the
    // 1st rather than midnight.
    //
    // This is the assertion to come back to if that ever stops being acceptable: the
    // fix is to plumb the offset through all three routes, which means touching the
    // reader, and the deck allowance above shows what the other answer looks like.
    const userId = await makeTestUser({
      definitionsUsed: FREE_LOOKUPS_PER_MONTH,
      lookupsResetAt: LATE_ON_IST_AUG_31,
    });
    expect(await claimLookupAllowance(userId, JUST_AFTER_IST_MIDNIGHT)).toBe(false);
  });

  it("cannot let two concurrent lookups both take the last slot", async () => {
    const userId = await makeTestUser({
      definitionsUsed: FREE_LOOKUPS_PER_MONTH - 1,
      lookupsResetAt: EARLIER_THIS_MONTH,
    });

    const results = await Promise.all([
      claimLookupAllowance(userId, NOW),
      claimLookupAllowance(userId, NOW),
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
    expect((await read(userId)).definitionsUsed).toBe(FREE_LOOKUPS_PER_MONTH);
  });
});

describe("both allowances", () => {
  it("fail closed for a user who no longer exists", async () => {
    // A JWT outlives the row it names (src/auth.ts keeps a token valid when the
    // lookup finds nothing), so a token held across account deletion reaches these
    // functions. updateMany matching no row must read as "refused", never as
    // "allowed" - the routes guard this too, and this is the second line.
    const ghost = "deleted-user-id-that-cannot-exist";
    expect(await claimDeckAllowance(ghost, NOW, IST)).toBe(false);
    expect(await claimLookupAllowance(ghost, NOW)).toBe(false);
  });
});
