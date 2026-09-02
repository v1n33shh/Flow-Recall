import { describe, expect, it } from "vitest";
import { REMINDER_ID, nextReminderAt, reminderFor } from "@/lib/studyReminder";
import { DEFAULT_REMINDER_HOUR, normaliseHour } from "@/lib/reminderPref";
import type { SessionPlan } from "@/lib/sessionBuilder";
import type { QueueItem } from "@/lib/types";

function plan(overrides: Partial<SessionPlan> = {}): SessionPlan {
  return {
    items: [],
    estimatedMinutes: 0,
    slipping: 0,
    urgent: 0,
    fresh: 0,
    building: 0,
    resting: 0,
    deckCount: 0,
    deferred: 0,
    ...overrides,
  };
}

const cards = (n: number) => Array.from({ length: n }, () => ({}) as QueueItem);

describe("nextReminderAt", () => {
  it("lands on today's hour when it is still ahead", () => {
    const now = new Date(2026, 8, 2, 14, 30);
    const at = nextReminderAt(20, now);
    expect(at.getDate()).toBe(2);
    expect(at.getHours()).toBe(20);
    expect(at.getMinutes()).toBe(0);
  });

  it("rolls to tomorrow once the hour has passed", () => {
    const at = nextReminderAt(20, new Date(2026, 8, 2, 21, 5));
    expect(at.getDate()).toBe(3);
    expect(at.getHours()).toBe(20);
  });

  it("rolls forward on the exact hour rather than firing immediately", () => {
    // Scheduling at an instant that has already arrived either fires at once or is
    // dropped, and both are worse than waiting a day.
    const at = nextReminderAt(20, new Date(2026, 8, 2, 20, 0, 0));
    expect(at.getDate()).toBe(3);
  });

  it("crosses a month boundary", () => {
    const at = nextReminderAt(9, new Date(2026, 8, 30, 22, 0));
    expect(at.getMonth()).toBe(9);
    expect(at.getDate()).toBe(1);
  });
});

describe("reminderFor", () => {
  it("says nothing at all when the session would be empty", () => {
    // The restraint that makes the rest credible: this app tells a student when NOT
    // to study, so a buzz on a night with nothing due contradicts its own home screen.
    expect(reminderFor(plan({ resting: 40 }), null)).toBeNull();
  });

  it("leads with the exam when one is close", () => {
    const text = reminderFor(
      plan({ items: cards(12), estimatedMinutes: 9, slipping: 4, urgent: 2 }),
      6,
    );
    expect(text?.title).toBe("Your exam is in 6 days");
    expect(text?.body).toContain("12 cards");
  });

  it("says tomorrow and today rather than counting to one or zero", () => {
    expect(reminderFor(plan({ items: cards(3), estimatedMinutes: 2 }), 1)?.title).toBe(
      "Your exam is tomorrow",
    );
    expect(reminderFor(plan({ items: cards(3), estimatedMinutes: 2 }), 0)?.title).toBe(
      "Your exam is today",
    );
  });

  it("ignores an exam that has already passed", () => {
    const text = reminderFor(plan({ items: cards(5), estimatedMinutes: 4, slipping: 5 }), -3);
    expect(text?.title).toBe("5 concepts slipping");
  });

  it("prefers what is nearly gone over what is merely slipping", () => {
    const text = reminderFor(
      plan({ items: cards(8), estimatedMinutes: 6, slipping: 8, urgent: 3 }),
      null,
    );
    expect(text?.title).toBe("3 concepts nearly gone");
  });

  it("gets the singular right", () => {
    expect(
      reminderFor(plan({ items: cards(1), estimatedMinutes: 1, slipping: 1 }), null)?.title,
    ).toBe("1 concept slipping");
    expect(
      reminderFor(plan({ items: cards(1), estimatedMinutes: 1, slipping: 1 }), null)?.body,
    ).toContain("1 card");
  });

  it("still invites a student whose work is all new rather than decaying", () => {
    const text = reminderFor(plan({ items: cards(6), estimatedMinutes: 5, fresh: 6 }), null);
    expect(text?.title).toBe("Ready when you are");
  });

  it("never rounds an estimate down to zero minutes", () => {
    const text = reminderFor(plan({ items: cards(1), estimatedMinutes: 0.2, fresh: 1 }), null);
    expect(text?.body).toContain("about 1 min");
  });
});

describe("the reminder's identity and hour", () => {
  it("uses one fixed id, so rescheduling replaces rather than stacks", () => {
    // recordReview and every sync pull fire recall-engine-update, so without a fixed
    // id a long session would queue a dozen notifications for the same evening.
    expect(REMINDER_ID).toBe(1);
  });

  it("clamps a stored hour to a real hour of a real day", () => {
    expect(normaliseHour(20)).toBe(20);
    expect(normaliseHour(25)).toBe(23);
    expect(normaliseHour(-4)).toBe(0);
    expect(normaliseHour("20")).toBe(DEFAULT_REMINDER_HOUR);
    expect(normaliseHour(undefined)).toBe(DEFAULT_REMINDER_HOUR);
    expect(normaliseHour(NaN)).toBe(DEFAULT_REMINDER_HOUR);
  });
});
