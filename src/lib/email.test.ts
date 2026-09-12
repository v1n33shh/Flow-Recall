import { beforeEach, describe, expect, it, vi } from "vitest";

/** lib/email.ts's FAIL-SOFT contract, which the renewal cron depends on.
 *
 * The cron loops over subscribers and sends one email each. If a send can throw, one
 * bad address abandons every user after it in the list - so "never throws" is not a
 * nicety here, it is the property that makes a batch job safe. These tests pin it. */
const send = vi.fn();
vi.mock("resend", () => ({ Resend: class { emails = { send }; constructor(_k: string) {} } }));

const { sendEmail, isEmailConfigured } = await import("./email");

const ENV = { ...process.env };
beforeEach(() => {
  send.mockReset();
  process.env = { ...ENV, RESEND_API_KEY: "re_test", RESEND_FROM_EMAIL: "FlowRecall <a@b.com>" };
});

describe("isEmailConfigured", () => {
  it("needs both the key and a verified from address", () => {
    expect(isEmailConfigured()).toBe(true);
    delete process.env.RESEND_FROM_EMAIL;
    expect(isEmailConfigured()).toBe(false);
    process.env.RESEND_FROM_EMAIL = "FlowRecall <a@b.com>";
    delete process.env.RESEND_API_KEY;
    expect(isEmailConfigured()).toBe(false);
  });
});

describe("sendEmail", () => {
  it("skips - rather than errors - when unconfigured, and sends nothing", async () => {
    delete process.env.RESEND_API_KEY;
    const r = await sendEmail({ to: "s@x.com", subject: "s", text: "t" });
    expect(r).toMatchObject({ ok: false, skipped: true });
    expect(send).not.toHaveBeenCalled();
  });

  it("reports a provider error without throwing", async () => {
    send.mockResolvedValue({ data: null, error: { message: "domain not verified" } });
    const r = await sendEmail({ to: "s@x.com", subject: "s", text: "t" });
    expect(r).toMatchObject({ ok: false, skipped: false, reason: "domain not verified" });
  });

  it("swallows a thrown network error - the batch must continue", async () => {
    send.mockRejectedValue(new Error("ECONNRESET"));
    const r = await sendEmail({ to: "s@x.com", subject: "s", text: "t" });
    expect(r).toMatchObject({ ok: false, skipped: false, reason: "ECONNRESET" });
  });

  it("returns the id on success", async () => {
    send.mockResolvedValue({ data: { id: "email_123" }, error: null });
    await expect(sendEmail({ to: "s@x.com", subject: "s", text: "t" })).resolves.toEqual({
      ok: true,
      id: "email_123",
    });
  });
});

/** The cron's idempotency rule, extracted so it can be asserted directly: a daily job
 * must email once per billing period, not once per day. */
function alreadyRemindedFor(renewalReminderFor: Date | null, currentPeriodEnd: Date): boolean {
  return renewalReminderFor?.getTime() === currentPeriodEnd.getTime();
}

describe("renewal reminder idempotency", () => {
  const period = new Date("2026-10-01T00:00:00Z");

  it("sends when no reminder has ever been sent", () => {
    expect(alreadyRemindedFor(null, period)).toBe(false);
  });

  it("does not send twice for the same period - the daily-spam case", () => {
    expect(alreadyRemindedFor(new Date(period), period)).toBe(true);
  });

  it("sends again after a renewal moves the period end", () => {
    const renewed = new Date("2026-11-01T00:00:00Z");
    expect(alreadyRemindedFor(new Date(period), renewed)).toBe(false);
  });
});
