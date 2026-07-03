import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

/** Local-calendar midnight, so "same day" / "yesterday" are compared by
 * calendar date rather than a rolling 24-hour window. */
function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function wholeDaysBetween(from: Date, to: Date): number {
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  return Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / MS_PER_DAY);
}

export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "You must be signed in to track a streak." }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { currentStreak: true, lastStudyDate: true },
  });
  if (!user) {
    return Response.json({ error: "User not found." }, { status: 404 });
  }

  const now = new Date();
  const daysSinceLast = user.lastStudyDate ? wholeDaysBetween(user.lastStudyDate, now) : null;

  let currentStreak: number;
  if (daysSinceLast === 0) {
    // Already studied today - they've had their point, leave the count alone.
    currentStreak = user.currentStreak;
  } else if (daysSinceLast === 1) {
    // Studied yesterday - the streak continues.
    currentStreak = user.currentStreak + 1;
  } else {
    // Gap of 2+ days, or never studied before - start a fresh streak at 1.
    currentStreak = 1;
  }

  // Always stamp the latest study time, even on a same-day repeat.
  await prisma.user.update({
    where: { id: session.user.id },
    data: { currentStreak, lastStudyDate: now },
  });

  return Response.json({ currentStreak });
}
