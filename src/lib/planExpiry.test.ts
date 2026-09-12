import { beforeEach, describe, expect, it, vi } from "vitest";

/** THE PAYMENT -> ENTITLEMENT -> EXPIRY PATH, which was the untested one.
 *
 * `billing.test.ts` beside this file covers `cancelRecurringBilling` - the gateway
 * call made when a user cancels. It does not cover the path every paying customer
 * actually takes: a verified payment grants PRO with a fixed `currentPeriodEnd`, and
 * `resolveEffectivePlan` is the only thing that ever takes it away again.
 *
 * That is worth testing precisely because it has already failed once in production.
 * `resolveEffectivePlan`'s own docblock records it: Razorpay is a ONE-TIME payment,
 * not a subscription, so nothing expires a grant except this check - and until the
 * function existed, "a single Rs299/mo payment silently granted Pro forever,
 * identical to the Rs2499/yr plan". A regression here does not throw or 500; it just
 * quietly gives the product away, which is the kind of bug only a test finds.
 *
 * Prisma is mocked rather than hit: the logic under test is the date arithmetic and
 * the revoke-on-read behaviour, not whether Postgres can store a timestamp. The DB
 * half already has real integration coverage in freeQuotaDb.test.ts.
 */
const updateMany = vi.fn();
vi.mock("@/lib/prisma", () => ({ prisma: { user: { updateMany: (...a: unknown[]) => updateMany(...a) } } }));
vi.mock("@/lib/stripe", () => ({ getStripe: () => ({ subscriptions: { cancel: vi.fn() } }) }));

const { resolveEffectivePlan, grantPro } = await import("./billing");

const DAY = 24 * 60 * 60 * 1000;

beforeEach(() => {
  updateMany.mockReset();
  updateMany.mockResolvedValue({ count: 1 });
});

describe("resolveEffectivePlan", () => {
  it("treats a PRO user inside their paid period as PRO", async () => {
    const user = { id: "u1", plan: "PRO", currentPeriodEnd: new Date(Date.now() + 5 * DAY) };
    await expect(resolveEffectivePlan(user)).resolves.toBe("PRO");
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("expires a PRO user whose period has passed, and revokes it in the DB", async () => {
    const user = { id: "u1", plan: "PRO", currentPeriodEnd: new Date(Date.now() - 1000) };
    await expect(resolveEffectivePlan(user)).resolves.toBe("FREE");
    // Self-healing: the stored row converges on reality rather than drifting.
    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(updateMany.mock.calls[0][0].data).toMatchObject({ plan: "FREE" });
  });

  it("treats a null period end as no expiry - a manually granted account", async () => {
    const user = { id: "u1", plan: "PRO", currentPeriodEnd: null };
    await expect(resolveEffectivePlan(user)).resolves.toBe("PRO");
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("never promotes a FREE user, whatever the period end says", async () => {
    const future = { id: "u1", plan: "FREE", currentPeriodEnd: new Date(Date.now() + 999 * DAY) };
    await expect(resolveEffectivePlan(future)).resolves.toBe("FREE");
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("fails closed for a missing user", async () => {
    await expect(resolveEffectivePlan(null)).resolves.toBe("FREE");
    await expect(resolveEffectivePlan(undefined)).resolves.toBe("FREE");
  });

  it("does not blow up when the revoke write fails - it still denies access", async () => {
    // The entitlement answer must not depend on the DB being reachable: a failed
    // revoke is a logged inconsistency, not a reason to hand out PRO.
    updateMany.mockRejectedValueOnce(new Error("db down"));
    const user = { id: "u1", plan: "PRO", currentPeriodEnd: new Date(Date.now() - 1000) };
    await expect(resolveEffectivePlan(user)).resolves.toBe("FREE");
  });
});

describe("grantPro", () => {
  it("writes the period end it is given, so 30- and 365-day grants differ", async () => {
    const end = new Date(Date.now() + 30 * DAY);
    await grantPro({ userId: "u1", gateway: "razorpay", currentPeriodEnd: end });
    expect(updateMany.mock.calls[0][0].data).toMatchObject({ plan: "PRO", currentPeriodEnd: end });
  });

  it("round-trips: a 30-day Razorpay grant is PRO now and FREE after it lapses", async () => {
    // The regression this whole file exists for - a monthly payment must not
    // outlive its month.
    const monthly = new Date(Date.now() + 30 * DAY);
    await grantPro({ userId: "u1", gateway: "razorpay", currentPeriodEnd: monthly });
    const granted = updateMany.mock.calls[0][0].data.currentPeriodEnd as Date;

    await expect(resolveEffectivePlan({ id: "u1", plan: "PRO", currentPeriodEnd: granted }))
      .resolves.toBe("PRO");

    const lapsed = new Date(granted.getTime() - 31 * DAY);
    await expect(resolveEffectivePlan({ id: "u1", plan: "PRO", currentPeriodEnd: lapsed }))
      .resolves.toBe("FREE");
  });
});
