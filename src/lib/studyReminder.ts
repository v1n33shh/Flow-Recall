import type { SessionPlan } from "@/lib/sessionBuilder";

/** When to tell a student it is time, and what to say - or that there is nothing
 * worth saying.
 *
 * The gap this closes: the engine has always known the hour each concept's recall
 * falls below its own target, and had no way to tell anyone. A spaced-repetition app
 * that cannot say "it is time" is asking the student to remember to remember, which
 * is the one job it was supposed to take off them. Anki Android has had reminders for
 * years; this is the last row where it plainly beat us.
 *
 * **Silence is a feature here, not a gap in the implementation.** This app's whole
 * thesis is that it will tell you when NOT to study - the home screen prints the
 * number of concepts it has deliberately decided not to ask about. A nightly buzz on
 * an evening with nothing due would contradict that on the same screen, and it is
 * exactly how a study app trains a student to swipe it away unread. So the text comes
 * from the session the engine would actually build, and when that session is empty
 * there is no notification at all.
 *
 * Everything here is pure: no plugin, no clock of its own, no permissions. The
 * Capacitor half lives in notifications.ts, which is untestable in vitest and
 * therefore kept as thin as it can be. */

/** One fixed id, so rescheduling REPLACES the pending reminder rather than adding a
 * second one. The engine fires `recall-engine-update` after every answer and every
 * sync pull, so without this a long session would queue a dozen notifications for the
 * same evening. */
export const REMINDER_ID = 1;

export type ReminderText = { title: string; body: string };

/** The next time the chosen local hour comes round, strictly in the future.
 *
 * Strictly: scheduling at an instant that has already passed either fires
 * immediately or is dropped, and both are worse than waiting a day. Built from local
 * date parts rather than by adding milliseconds, so it lands on the wall-clock hour
 * the student picked across a DST change rather than an hour either side of it. */
export function nextReminderAt(hour: number, now: Date): Date {
  const at = new Date(now);
  at.setHours(hour, 0, 0, 0);
  if (at.getTime() <= now.getTime()) at.setDate(at.getDate() + 1);
  return at;
}

/** What to say, or null when the honest answer is nothing.
 *
 * Ordered by what the student would want to hear first: a paper that is close, then
 * knowledge actually slipping away, then ordinary work waiting. Every number is one
 * the app already shows on the home screen, so the notification cannot promise
 * something the screen then contradicts. */
export function reminderFor(plan: SessionPlan, daysUntilExam: number | null): ReminderText | null {
  const cards = plan.items.length;
  if (cards === 0) return null;

  const minutes = Math.max(1, Math.round(plan.estimatedMinutes));
  const tail = `${cards} card${cards === 1 ? "" : "s"} · about ${minutes} min`;

  if (daysUntilExam !== null && daysUntilExam >= 0) {
    const when =
      daysUntilExam === 0 ? "today" : daysUntilExam === 1 ? "tomorrow" : `in ${daysUntilExam} days`;
    return { title: `Your exam is ${when}`, body: tail };
  }

  // "Nearly gone" rather than a percentage: the student has never been shown a
  // retrievability number and a notification is the wrong place to introduce one.
  if (plan.urgent > 0) {
    return {
      title: `${plan.urgent} concept${plan.urgent === 1 ? "" : "s"} nearly gone`,
      body: tail,
    };
  }

  if (plan.slipping > 0) {
    return {
      title: `${plan.slipping} concept${plan.slipping === 1 ? "" : "s"} slipping`,
      body: tail,
    };
  }

  // Nothing decaying, but there is work: cards never answered in a format, or ones
  // still being built up. Worth a nudge, worded as an offer rather than a warning.
  return { title: `Ready when you are`, body: tail };
}
