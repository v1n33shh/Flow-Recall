import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { DAILY_GRADE_CAP, isOverDailyCap } from "./clozeGradeRateLimit";

// Integration test, not a pure unit test - isOverDailyCap's whole job is
// getting Prisma's atomic conditional-increment and daily-rollover
// semantics right against a real Postgres connection, so mocking Prisma
// here would just test my mock, not the actual behavior. Every test creates
// and deletes its own disposable user - never touches a real account.
let testUserId: string | null = null;

afterEach(async () => {
  if (testUserId) {
    await prisma.user.delete({ where: { id: testUserId } }).catch(() => {});
    testUserId = null;
  }
});

async function makeTestUser() {
  const user = await prisma.user.create({
    data: { email: `ratelimit-test-${Date.now()}-${Math.random().toString(36).slice(2)}@example.invalid`, plan: "FREE" },
  });
  testUserId = user.id;
  return user.id;
}

describe("isOverDailyCap", () => {
  it("allows the first grade a user ever requests", async () => {
    const userId = await makeTestUser();
    expect(await isOverDailyCap(userId, 0)).toBe(false);
  });

  it("allows exactly up to the cap and blocks the next one", async () => {
    const userId = await makeTestUser();
    await prisma.user.update({
      where: { id: userId },
      data: { clozeGradesToday: DAILY_GRADE_CAP - 1, lastClozeGradeDate: new Date() },
    });

    // This call is the cap-th grade of the day - must still pass.
    expect(await isOverDailyCap(userId, 0)).toBe(false);
    const afterCapHit = await prisma.user.findUnique({ where: { id: userId }, select: { clozeGradesToday: true } });
    expect(afterCapHit?.clozeGradesToday).toBe(DAILY_GRADE_CAP);

    // One past the cap - must block, and must not increment further.
    expect(await isOverDailyCap(userId, 0)).toBe(true);
    const afterBlocked = await prisma.user.findUnique({ where: { id: userId }, select: { clozeGradesToday: true } });
    expect(afterBlocked?.clozeGradesToday).toBe(DAILY_GRADE_CAP);
  });

  it("resets the count on a new calendar day even if yesterday hit the cap", async () => {
    const userId = await makeTestUser();
    const yesterday = new Date(Date.now() - 25 * 60 * 60 * 1000);
    await prisma.user.update({
      where: { id: userId },
      data: { clozeGradesToday: DAILY_GRADE_CAP, lastClozeGradeDate: yesterday },
    });

    expect(await isOverDailyCap(userId, 0)).toBe(false);
    const row = await prisma.user.findUnique({ where: { id: userId }, select: { clozeGradesToday: true } });
    expect(row?.clozeGradesToday).toBe(1);
  });

  it("does not reset within the same calendar day", async () => {
    const userId = await makeTestUser();
    await prisma.user.update({
      where: { id: userId },
      data: { clozeGradesToday: 5, lastClozeGradeDate: new Date() },
    });

    expect(await isOverDailyCap(userId, 0)).toBe(false);
    const row = await prisma.user.findUnique({ where: { id: userId }, select: { clozeGradesToday: true } });
    expect(row?.clozeGradesToday).toBe(6);
  });

  it("fails closed for a nonexistent user", async () => {
    expect(await isOverDailyCap("this-user-does-not-exist", 0)).toBe(true);
  });
});
