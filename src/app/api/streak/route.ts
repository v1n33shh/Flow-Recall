import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import type { StreakDay, StreakResponse } from "@/lib/types";
import { parseTimezoneOffsetMinutes, startOfLocalDay } from "@/lib/localDay";

const WEEKDAY_LABELS = ["M", "T", "W", "T", "F", "S", "S"] as const;

function isoDate(date: Date): string {
  // `date` is always one of this route's own UTC-midnight day markers (see
  // startOfLocalDay), so it must be read back with the UTC accessors - the
  // local ones would reintroduce a dependency on the server's own timezone.
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "You must be signed in." }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const timezoneOffsetMinutes = parseTimezoneOffsetMinutes(searchParams.get("tzOffset"));

  const now = new Date();
  const today = startOfLocalDay(now, timezoneOffsetMinutes);

  // Monday-first week: how many days back the current Monday is. getUTCDay()
  // is 0=Sun..6=Sat, so (dow + 6) % 7 gives 0 for Monday .. 6 for Sunday.
  // `today` is a UTC-midnight day marker, so every read/write on it and its
  // derivatives below uses the UTC variants throughout.
  const mondayOffset = (today.getUTCDay() + 6) % 7;
  const monday = new Date(today);
  monday.setUTCDate(today.getUTCDate() - mondayOffset);
  const weekEnd = new Date(monday);
  weekEnd.setUTCDate(monday.getUTCDate() + 7); // exclusive upper bound (next Monday)

  const [user, rows] = await Promise.all([
    prisma.user.findUnique({
      where: { id: session.user.id },
      select: { currentStreak: true },
    }),
    prisma.studyDay.findMany({
      where: { userId: session.user.id, day: { gte: monday, lt: weekEnd } },
      select: { day: true },
    }),
  ]);

  // Stored `day` values are already exact UTC-midnight markers written by
  // /api/study/track using this same offset - no need to re-normalize them.
  const studied = new Set(rows.map((r) => r.day.getTime()));

  const days: StreakDay[] = Array.from({ length: 7 }, (_, i) => {
    const date = new Date(monday);
    date.setUTCDate(monday.getUTCDate() + i);
    const time = date.getTime();
    return {
      label: WEEKDAY_LABELS[i],
      date: isoDate(date),
      studied: studied.has(time),
      isToday: time === today.getTime(),
      future: time > today.getTime(),
    };
  });

  const response: StreakResponse = {
    currentStreak: user?.currentStreak ?? 0,
    days,
  };
  return Response.json(response);
}
