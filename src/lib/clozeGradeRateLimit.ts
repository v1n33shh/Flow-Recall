import { prisma } from "@/lib/prisma";
import { wholeDaysBetween } from "@/lib/localDay";

// This fires automatically during normal study (whenever a typed answer
// isn't an exact match), not on a deliberate action - so it's an abuse
// ceiling, not a plan-gated feature limit like decksGeneratedToday. Applies
// to FREE and PRO alike since grading always uses the same free model
// either way. Kept generous enough that heavy legitimate studying never
// comes close - see the schema comment on User.clozeGradesToday.
export const DAILY_GRADE_CAP = 200;

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
