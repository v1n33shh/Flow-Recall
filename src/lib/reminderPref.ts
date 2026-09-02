/** Whether the student wants a nightly reminder, and at what hour.
 *
 * localStorage rather than the account, and deliberately: a notification is delivered
 * by one device to one person in one timezone, so "remind me at 20:00" is a property
 * of this phone, not of the account. Syncing it would mean a laptop buzzing at a time
 * chosen on a phone five hours away. Same reasoning that keeps `flowrecall-theme` out
 * of the sync payload.
 *
 * Off until asked for. A study app that starts notifying before the student has
 * chosen to be notified is the reason notification permissions exist. */

const KEY = "flowrecall:reminder";

/** 20:00. Late enough that the day's other obligations are done, early enough that a
 * 20-minute session does not push into sleep - which is when the consolidation this
 * whole engine models actually happens. */
export const DEFAULT_REMINDER_HOUR = 20;

export type ReminderPref = { enabled: boolean; hour: number };

const OFF: ReminderPref = { enabled: false, hour: DEFAULT_REMINDER_HOUR };

/** Reads the preference, degrading to "off" on anything unreadable rather than
 * throwing. A corrupt value must not be able to break a study session. */
export function readReminderPref(): ReminderPref {
  if (typeof window === "undefined") return OFF;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return OFF;
    const parsed = JSON.parse(raw) as Partial<ReminderPref>;
    return {
      enabled: parsed.enabled === true,
      hour: normaliseHour(parsed.hour),
    };
  } catch {
    return OFF;
  }
}

export function writeReminderPref(pref: ReminderPref): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    KEY,
    JSON.stringify({ enabled: pref.enabled, hour: normaliseHour(pref.hour) }),
  );
}

/** Clamps to a real hour of a real day. A stored 25 would schedule the reminder into
 * the next day silently; a stored NaN would make `setHours` throw the whole schedule
 * away. */
export function normaliseHour(hour: unknown): number {
  const n = typeof hour === "number" && Number.isFinite(hour) ? Math.round(hour) : NaN;
  if (Number.isNaN(n)) return DEFAULT_REMINDER_HOUR;
  return Math.max(0, Math.min(23, n));
}
