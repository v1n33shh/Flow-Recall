import { prisma } from "@/lib/prisma";
import { wholeDaysBetween } from "@/lib/localDay";

// Grades per student per day, for /api/cloze-grade and /api/teach-back.
//
// This fires automatically during normal study - whenever a typed answer isn't an
// exact match - not on a deliberate action, so it is an abuse ceiling rather than a
// plan-gated feature limit like decksGeneratedToday. Applies to FREE and PRO alike,
// since grading always uses the same free model either way.
//
// **Sized from cost, which the old 200 never was.** 200 was set as a round number
// while Groq was free, and it was the loosest cap in the app by a wide margin: 6,000
// grades a month at a measured $0.0000546 a call is ~$0.33 per student per month,
// about FOUR TIMES the entire card-generation allowance (100 requests at $0.000867 =
// $0.087). At 100 it is ~$0.165, which puts the two in the same order.
//
// **Do not lower it further.** 100 is already well past any real session - it counts
// only answers that were not exact matches, so a student reviewing 100 cards spends
// far fewer - and the failure lands in the worst possible place: the route answers
// `429 "Daily grading limit reached."` mid-study, so a student who trips it loses
// grading in the middle of a session rather than at a button they chose to press.
export const DAILY_GRADE_CAP = 100;

// Same daily-rollover shape as /api/study/track's streak logic, plus the
// atomic conditional-increment guard from /api/define (updateMany with a
// `lt` where-clause avoids a race where two near-simultaneous requests both
// read the pre-increment count and both slip through past the cap).
export async function isOverDailyCap(userId: string, timezoneOffsetMinutes: number): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { clozeGradesToday: true, lastClozeGradeDate: true },
  });
  if (!user) return true;

  const now = new Date();
  const daysSinceLast = user.lastClozeGradeDate
    ? wholeDaysBetween(user.lastClozeGradeDate, now, timezoneOffsetMinutes)
    : null;
  const isNewDay = daysSinceLast === null || daysSinceLast > 0;

  if (isNewDay) {
    // First grade of a new day - reset unconditionally and let it through.
    await prisma.user.update({
      where: { id: userId },
      data: { clozeGradesToday: 1, lastClozeGradeDate: now },
    });
    return false;
  }

  const result = await prisma.user.updateMany({
    where: { id: userId, clozeGradesToday: { lt: DAILY_GRADE_CAP } },
    data: { clozeGradesToday: { increment: 1 }, lastClozeGradeDate: now },
  });
  return result.count === 0;
}
