import { Capacitor } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";
import { REMINDER_ID, nextReminderAt, type ReminderText } from "@/lib/studyReminder";

/** The Capacitor half of study reminders, kept as thin as it can be because none of
 * it can be tested in vitest - the decisions all live in studyReminder.ts.
 *
 * **The permission is the whole trap.** On Android 13+ (API 33, and this app targets
 * 36) POST_NOTIFICATIONS is a runtime permission, and if it is never requested every
 * call below still RESOLVES SUCCESSFULLY while nothing whatsoever appears on the
 * phone. That is the same failure shape as the WebView silently swallowing
 * `<a download>` blob URLs: the API said 200, the file never existed. So this is not
 * done until a notification has been seen on a real device with the app closed - a
 * resolved promise proves nothing.
 *
 * Web is a no-op rather than a fallback to the Notification API: a browser tab that
 * is closed cannot fire a local notification anyway, so a half-working version would
 * only teach the student the feature is unreliable. */

function unavailable(): boolean {
  return !Capacitor.isNativePlatform();
}

/** Asks for permission, returning whether it was granted.
 *
 * Only ever called from a real tap (the settings toggle). Asking on launch is how an
 * app gets denied permanently: Android remembers a refusal, and a student who has not
 * yet seen what the app does has no reason to say yes. */
export async function requestReminderPermission(): Promise<boolean> {
  if (unavailable()) return false;
  try {
    const current = await LocalNotifications.checkPermissions();
    if (current.display === "granted") return true;
    const asked = await LocalNotifications.requestPermissions();
    return asked.display === "granted";
  } catch (error) {
    console.error("notification permission request failed", error);
    return false;
  }
}

/** Whether the student has already granted it, without asking again. */
export async function hasReminderPermission(): Promise<boolean> {
  if (unavailable()) return false;
  try {
    return (await LocalNotifications.checkPermissions()).display === "granted";
  } catch {
    return false;
  }
}

/** Schedules the one reminder, or cancels it when there is nothing to say.
 *
 * `text` comes from `reminderFor`, which returns null on an evening with no work -
 * and null here means cancel, not skip. Skipping would leave yesterday's pending
 * notification to fire tonight and tell the student about cards they have since
 * answered, which is worse than saying nothing. */
export async function scheduleReminder(text: ReminderText | null, hour: number): Promise<void> {
  if (unavailable()) return;
  try {
    if (text === null) {
      await cancelReminder();
      return;
    }
    // Cancel first: schedule() with the same id replaces on Android, but doing it
    // explicitly makes the "exactly one pending reminder" invariant local to this
    // function rather than a plugin behaviour to be trusted.
    await LocalNotifications.cancel({ notifications: [{ id: REMINDER_ID }] });
    await LocalNotifications.schedule({
      notifications: [
        {
          id: REMINDER_ID,
          title: text.title,
          body: text.body,
          schedule: { at: nextReminderAt(hour, new Date()), allowWhileIdle: true },
        },
      ],
    });
  } catch (error) {
    // Never worth breaking a study session over - the same posture recordReview and
    // syncNow take.
    console.error("scheduling a study reminder failed", error);
  }
}

export async function cancelReminder(): Promise<void> {
  if (unavailable()) return;
  try {
    await LocalNotifications.cancel({ notifications: [{ id: REMINDER_ID }] });
  } catch (error) {
    console.error("cancelling a study reminder failed", error);
  }
}
