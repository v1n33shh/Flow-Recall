// Shared by /api/study/track and /api/streak so "today"/"yesterday" are
// computed in the STUDYING USER's timezone, not the server process's (which
// is virtually always UTC on Vercel/Node regardless of where the user is).
// Using plain `date.getFullYear()/getMonth()/getDate()` reads in whatever
// timezone the JS engine itself is configured for - on the server, that's
// never the user's, so a user well outside UTC can see their streak reset a
// calendar day early or late relative to what they experience as "today."
//
// Fix: the client sends its own UTC offset (same convention as JS's native
// `Date.prototype.getTimezoneOffset()` - UTC minus local, in minutes, e.g.
// -330 for UTC+5:30), and every "which day is this" calculation here shifts
// the timestamp by that offset before reading it back out via the UTC
// variants (getUTCFullYear/getUTCMonth/getUTCDate) - never the local ones,
// which would reintroduce a dependency on the server's own timezone the
// moment they touched an already-shifted marker.

const MIN_OFFSET_MINUTES = -14 * 60; // UTC+14, the furthest-ahead real zone
const MAX_OFFSET_MINUTES = 12 * 60; // UTC-12, the furthest-behind real zone

/** Parses a client-supplied timezone offset, defaulting to UTC (0) if
 * missing, malformed, or outside the range any real timezone can produce -
 * never trust it blindly, but a bad value should degrade to "wrong day
 * sometimes," not a crash. */
export function parseTimezoneOffsetMinutes(value: unknown): number {
  const n = typeof value === "string" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isFinite(n)) return 0;
  return Math.max(MIN_OFFSET_MINUTES, Math.min(MAX_OFFSET_MINUTES, n));
}

/** UTC-midnight timestamp representing local-calendar midnight for the given
 * offset - a stable, timezone-of-the-server-independent "day marker" safe to
 * store, compare by equality, or diff in whole days. */
export function startOfLocalDay(date: Date, timezoneOffsetMinutes: number): Date {
  const shifted = new Date(date.getTime() - timezoneOffsetMinutes * 60_000);
  return new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()));
}

export function wholeDaysBetween(from: Date, to: Date, timezoneOffsetMinutes: number): number {
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  const fromDay = startOfLocalDay(from, timezoneOffsetMinutes).getTime();
  const toDay = startOfLocalDay(to, timezoneOffsetMinutes).getTime();
  return Math.round((toDay - fromDay) / MS_PER_DAY);
}

/** UTC-midnight timestamp for the first day of the local calendar month - the
 * monthly sibling of startOfLocalDay, and safe to store and compare the same way.
 *
 * Used by the FREE allowances, which roll over per calendar month rather than per
 * day. A student in UTC+5:30 who generates a deck at 00:30 on the 1st has already
 * started a new month; reading the raw UTC month would tell them they had not. */
export function startOfLocalMonth(date: Date, timezoneOffsetMinutes: number): Date {
  const shifted = new Date(date.getTime() - timezoneOffsetMinutes * 60_000);
  return new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), 1));
}

/** Whether `to` falls in a later local calendar month than `from`.
 *
 * Strictly later, not merely different: a clock that has gone backwards (a
 * corrected device clock, a stored date in the future) must not hand out a fresh
 * allowance. */
export function isNewLocalMonth(from: Date, to: Date, timezoneOffsetMinutes: number): boolean {
  return (
    startOfLocalMonth(to, timezoneOffsetMinutes).getTime() >
    startOfLocalMonth(from, timezoneOffsetMinutes).getTime()
  );
}
