import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { parseTimezoneOffsetMinutes, startOfLocalDay, wholeDaysBetween } from "@/lib/localDay";

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "You must be signed in to track a streak." }, { status: 401 });
  }

  // Body is optional so older cached clients (no timezone field) still work -
  // they just fall back to UTC, same as today's behavior for everyone.
  const body = await request.json().catch(() => null);
  const timezoneOffsetMinutes = parseTimezoneOffsetMinutes(
    body && typeof body === "object" ? (body as Record<string, unknown>).timezoneOffsetMinutes : undefined,
  );

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { currentStreak: true, lastStudyDate: true },
  });
  if (!user) {
    return Response.json({ error: "User not found." }, { status: 404 });
  }

  const now = new Date();
  const daysSinceLast = user.lastStudyDate
    ? wholeDaysBetween(user.lastStudyDate, now, timezoneOffsetMinutes)
    : null;

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

  // Always stamp the latest study time, even on a same-day repeat, and record
  // today in the study-history table (upsert => at most one row per day) so the
  // weekly streak calendar has a source of truth. Runs in a transaction so the
  // streak counter and the history row can never disagree.
  const today = startOfLocalDay(now, timezoneOffsetMinutes);
  await prisma.$transaction([
    prisma.user.update({
      where: { id: session.user.id },
      data: { currentStreak, lastStudyDate: now },
    }),
    prisma.studyDay.upsert({
      where: { userId_day: { userId: session.user.id, day: today } },
      create: { userId: session.user.id, day: today },
      update: {},
    }),
  ]);

  return Response.json({ currentStreak });
}
