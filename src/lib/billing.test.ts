import { beforeEach, describe, expect, it, vi } from "vitest";

// Both mocked so this stays hermetic: billing.ts imports prisma at module load,
// and the point under test is which gateway calls happen, not what they do.
const cancel = vi.fn();
vi.mock("@/lib/stripe", () => ({ getStripe: () => ({ subscriptions: { cancel } }) }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

const { cancelRecurringBilling } = await import("./billing");

describe("cancelRecurringBilling", () => {
  beforeEach(() => {
    cancel.mockReset();
  });

  it("cancels a live Stripe subscription", async () => {
    cancel.mockResolvedValue({});
    await expect(cancelRecurringBilling({ stripeSubscriptionId: "sub_123" })).resolves.toEqual({
      ok: true,
    });
    expect(cancel).toHaveBeenCalledWith("sub_123");
  });

  // Razorpay is a one-time order, not a subscription (api/razorpay/verify), so
  // there is nothing recurring to stop and no gateway call to make.
  it("makes no gateway call for a user with no Stripe subscription", async () => {
    await expect(cancelRecurringBilling({ stripeSubscriptionId: null })).resolves.toEqual({
      ok: true,
    });
    expect(cancel).not.toHaveBeenCalled();
  });

  // Already gone is the outcome we wanted; refusing the deletion here would
  // strand the user permanently.
  it("treats an already-cancelled subscription as success", async () => {
    cancel.mockRejectedValue(Object.assign(new Error("No such subscription"), {
      code: "resource_missing",
    }));
    await expect(cancelRecurringBilling({ stripeSubscriptionId: "sub_gone" })).resolves.toEqual({
      ok: true,
    });
  });

  // The case the whole ordering exists for: a card that might still be charged
  // must block the deletion rather than be deleted around.
  it("refuses on any other gateway failure", async () => {
    cancel.mockRejectedValue(Object.assign(new Error("api down"), { code: "api_error" }));
    const result = await cancelRecurringBilling({ stripeSubscriptionId: "sub_123" });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toMatch(/nothing was deleted/i);
  });

  it("refuses when the gateway throws something without a code", async () => {
    cancel.mockRejectedValue(new Error("socket hang up"));
    expect((await cancelRecurringBilling({ stripeSubscriptionId: "sub_123" })).ok).toBe(false);
  });
});
