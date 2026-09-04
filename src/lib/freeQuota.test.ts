import { describe, expect, it } from "vitest";
import {
  FREE_DECKS_PER_MONTH,
  FREE_GENERATION_REQUESTS_PER_MONTH,
  FREE_LOOKUPS_PER_MONTH,
  PRO_GENERATION_REQUESTS_PER_MONTH,
  countInCurrentMonth,
  generationLimitForPlan,
} from "@/lib/freeQuota";
import { isNewLocalMonth, startOfLocalMonth } from "@/lib/localDay";

// UTC+5:30, the offset this app is actually used in. getTimezoneOffset() reports
// UTC minus local, so a zone ahead of UTC is negative.
const IST = -330;
const UTC = 0;

describe("startOfLocalMonth", () => {
  it("reads the month in the student's zone, not the server's", () => {
    // 00:30 IST on 1 September is still 19:00 UTC on 31 August. A student in IST
    // has started a new month; the raw UTC month says they have not.
    const justAfterMidnightIST = new Date("2026-08-31T19:00:00.000Z");
    expect(startOfLocalMonth(justAfterMidnightIST, IST).toISOString()).toBe(
      "2026-09-01T00:00:00.000Z",
    );
    expect(startOfLocalMonth(justAfterMidnightIST, UTC).toISOString()).toBe(
      "2026-08-01T00:00:00.000Z",
    );
  });

  it("is stable anywhere inside the same local month", () => {
    const first = startOfLocalMonth(new Date("2026-09-01T04:00:00.000Z"), IST);
    const last = startOfLocalMonth(new Date("2026-09-30T18:00:00.000Z"), IST);
    expect(first.getTime()).toBe(last.getTime());
  });
});

describe("isNewLocalMonth", () => {
  it("is true across a month boundary and false within one", () => {
    const aug = new Date("2026-08-20T10:00:00.000Z");
    const sep = new Date("2026-09-02T10:00:00.000Z");
    expect(isNewLocalMonth(aug, sep, IST)).toBe(true);
    expect(isNewLocalMonth(aug, new Date("2026-08-31T10:00:00.000Z"), IST)).toBe(false);
  });

  it("crosses a year boundary", () => {
    expect(
      isNewLocalMonth(new Date("2026-12-28T10:00:00.000Z"), new Date("2027-01-02T10:00:00.000Z"), IST),
    ).toBe(true);
  });

  it("refuses to run backwards, so a wrong clock cannot mint an allowance", () => {
    const sep = new Date("2026-09-02T10:00:00.000Z");
    const aug = new Date("2026-08-20T10:00:00.000Z");
    expect(isNewLocalMonth(sep, aug, IST)).toBe(false);
  });
});

describe("countInCurrentMonth", () => {
  const now = new Date("2026-09-02T10:00:00.000Z");

  it("keeps a count spent in the current month", () => {
    expect(countInCurrentMonth(3, new Date("2026-09-01T05:00:00.000Z"), now, IST)).toBe(3);
  });

  it("expires a count spent in an earlier month", () => {
    expect(countInCurrentMonth(3, new Date("2026-08-28T05:00:00.000Z"), now, IST)).toBe(0);
  });

  it("does not invent a rollover for a row with no date", () => {
    // A count with no date should not exist, and if it does, treating it as a new
    // month would hand a free allowance to anyone whose date failed to write.
    expect(countInCurrentMonth(3, null, now, IST)).toBe(3);
  });

  it("rolls over on the student's month boundary, not UTC's", () => {
    // Spent at 23:00 IST on 31 August = 17:30 UTC. "Now" is 00:30 IST on 1
    // September = 19:00 UTC on 31 August: a new month for the student, the same
    // month in UTC. The student gets their allowance back.
    const spent = new Date("2026-08-31T17:30:00.000Z");
    const justAfterMidnightIST = new Date("2026-08-31T19:00:00.000Z");
    expect(countInCurrentMonth(FREE_DECKS_PER_MONTH, spent, justAfterMidnightIST, IST)).toBe(0);
    expect(countInCurrentMonth(FREE_DECKS_PER_MONTH, spent, justAfterMidnightIST, UTC)).toBe(
      FREE_DECKS_PER_MONTH,
    );
  });

  it("is what the paywall compares against", () => {
    // The gate the route applies, stated once here so the two cannot drift.
    const atCap = countInCurrentMonth(FREE_DECKS_PER_MONTH, now, now, IST);
    expect(atCap >= FREE_DECKS_PER_MONTH).toBe(true);
    expect(countInCurrentMonth(FREE_DECKS_PER_MONTH - 1, now, now, IST) >= FREE_DECKS_PER_MONTH).toBe(
      false,
    );
  });
});

describe("the two allowances", () => {
  it("are both generous enough to reach the features they gate", () => {
    // Not arbitrary: one deck must be mappable (ceil(120/40) = 3 lookups) with room
    // left for reading and asking, and a month's decks must exceed the one-deck
    // lifetime cap this replaced.
    expect(FREE_DECKS_PER_MONTH).toBeGreaterThan(1);
    expect(FREE_LOOKUPS_PER_MONTH).toBeGreaterThan(3 * FREE_DECKS_PER_MONTH);
  });
});

describe("generationLimitForPlan", () => {
  it("gives PRO the fair-use ceiling and FREE the budget", () => {
    expect(generationLimitForPlan("PRO")).toBe(PRO_GENERATION_REQUESTS_PER_MONTH);
    expect(generationLimitForPlan("FREE")).toBe(FREE_GENERATION_REQUESTS_PER_MONTH);
  });

  it("treats an unknown plan as FREE", () => {
    // Fails closed: a plan string this app does not recognise must not be handed the
    // PRO ceiling. `plan` is a plain String column, so an unexpected value is possible.
    expect(generationLimitForPlan("")).toBe(FREE_GENERATION_REQUESTS_PER_MONTH);
    expect(generationLimitForPlan("TRIAL")).toBe(FREE_GENERATION_REQUESTS_PER_MONTH);
  });

  it("bounds PRO as well as FREE", () => {
    // The point of the ceiling: uncapped PRO generation is an unbounded bill against a
    // fixed subscription price. It must be a real number, and above the free budget.
    expect(Number.isFinite(PRO_GENERATION_REQUESTS_PER_MONTH)).toBe(true);
    expect(PRO_GENERATION_REQUESTS_PER_MONTH).toBeGreaterThan(FREE_GENERATION_REQUESTS_PER_MONTH);
  });
});
