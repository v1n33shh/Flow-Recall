import { localMidnight } from "@/lib/recallModel";

/** When the concepts you just studied come back.
 *
 * The scheduler computes a due date for every card the instant it is answered -
 * `recordReview` writes `dueAt` into the memory record and hands it back to the caller,
 * where StudyFeed has always thrown it away. So the app knew exactly when it would next
 * ask about each concept and never once said so.
 *
 * This is that number, at the one moment it has been earned: the completion slide, after
 * the student has finished a session. It is the spacing effect made concrete on their own
 * material - not "reviews should be spaced", but "these four come back tomorrow and those
 * six in a fortnight, because that is when you are predicted to be about to forget them".
 *
 * Buckets rather than a list, because a 40-card session would otherwise print 40 dates.
 */

export type ReturnSchedule = {
  /** Due again before tomorrow - a lapse, usually: FSRS puts a failed card hours out. */
  today: number;
  tomorrow: number;
  /** Inside the next seven days, past tomorrow. */
  thisWeek: number;
  later: number;
  /** Everything counted above, so a caller can skip the block when there is nothing. */
  total: number;
  /** The furthest-out due date in the set, for "the longest gap you have earned". Null
   * when nothing was scheduled. */
  furthestDays: number | null;
};

const DAY_MS = 86_400_000;

/** Bucket a set of due dates relative to `now`.
 *
 * Calendar days, not elapsed hours: "tomorrow" means the next date on the student's
 * calendar, which is what they mean by it. A card due in 20 hours is tomorrow if it
 * crosses midnight and today if it does not, and `localMidnight` is already the app's
 * answer to that question everywhere else.
 */
export function returnSchedule(
  dueDates: Iterable<number>,
  now: number = Date.now(),
): ReturnSchedule {
  const startOfToday = localMidnight(now);
  const startOfTomorrow = startOfToday + DAY_MS;
  const startOfDayEight = startOfToday + DAY_MS * 8;

  const out: ReturnSchedule = {
    today: 0,
    tomorrow: 0,
    thisWeek: 0,
    later: 0,
    total: 0,
    furthestDays: null,
  };

  let furthest = -Infinity;
  for (const due of dueDates) {
    if (!Number.isFinite(due)) continue;
    out.total += 1;
    if (due > furthest) furthest = due;

    if (due < startOfTomorrow) out.today += 1;
    else if (due < startOfTomorrow + DAY_MS) out.tomorrow += 1;
    else if (due < startOfDayEight) out.thisWeek += 1;
    else out.later += 1;
  }

  if (out.total > 0) {
    // Whole days between calendar dates, so "in 2 days" cannot be an artefact of the
    // hour a session happened to end.
    out.furthestDays = Math.max(0, Math.round((localMidnight(furthest) - startOfToday) / DAY_MS));
  }
  return out;
}

/** A gap in words, for one interval in days.
 *
 * The real range is wider than it looks: a lapsed card comes back in about five hours,
 * and a well-established one in roughly 175 days, so neither "in N days" nor a date alone
 * reads well across the whole span. */
export function formatInterval(days: number): string {
  if (!Number.isFinite(days) || days < 0) return "soon";
  if (days < 1) {
    const hours = Math.max(1, Math.round(days * 24));
    return hours === 1 ? "in about an hour" : `in about ${hours} hours`;
  }
  const whole = Math.round(days);
  if (whole === 1) return "tomorrow";
  if (whole < 14) return `in ${whole} days`;
  if (whole < 60) {
    const weeks = Math.round(whole / 7);
    return `in ${weeks} weeks`;
  }
  const months = Math.round(whole / 30);
  return months === 1 ? "in a month" : `in ${months} months`;
}
