import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

/** Local-calendar midnight, matching the study-tracking route so "which day"
 * is compared by calendar date rather than a rolling 24h window. */
function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

const WEEKDAY_LABELS = ["M", "T", "W", "T", "F", "S", "S"] as const;

export type StreakDay = {
  /** Single-letter weekday label, Monday-first. */
  label: string;
  /** ISO date (yyyy-mm-dd) for keying on the client. */
  date: string;
  studied: boolean;
  isToday: boolean;
  /** A later day this week the user hasn't reached yet - rendered hollow. */
  future: boolean;
};

export type StreakResponse = {
  currentStreak: number;
  days: StreakDay[];
};

function isoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "You must be signed in." }, { status: 401 });
  }

  const now = new Date();
  const today = startOfDay(now);

  // Monday-first week: how many days back the current Monday is. getDay() is
  // 0=Sun..6=Sat, so (dow + 6) % 7 gives 0 for Monday .. 6 for Sunday.
  const mondayOffset = (today.getDay() + 6) % 7;
  const monday = new Date(today);
  monday.setDate(today.getDate() - mondayOffset);
  const weekEnd = new Date(monday);
  weekEnd.setDate(monday.getDate() + 7); // exclusive upper bound (next Monday)

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

  // Normalize stored days back to local-midnight timestamps for exact matching.
  const studied = new Set(rows.map((r) => startOfDay(r.day).getTime()));

  const days: StreakDay[] = Array.from({ length: 7 }, (_, i) => {
    const date = new Date(monday);
    date.setDate(monday.getDate() + i);
    const time = startOfDay(date).getTime();
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
