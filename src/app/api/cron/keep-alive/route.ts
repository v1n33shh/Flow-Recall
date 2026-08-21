import { prisma } from "@/lib/prisma";

// Supabase's free tier auto-pauses a project after ~7 days with no database
// activity (dashboard visits don't count - only real API/DB traffic does).
// Vercel Cron hits this route once a day (see vercel.json) to run one real
// query, which is exactly the kind of activity that resets that clock - the
// same mechanism, just automated instead of relying on a human opening the
// dashboard regularly.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  // Vercel signs every cron invocation with `Authorization: Bearer
  // <CRON_SECRET>` when that env var is set - verifying it stops this route
  // from being a public, unauthenticated way to spam the database. Fails
  // closed: with no CRON_SECRET configured, every request is rejected rather
  // than silently left open.
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // A cheap real query - not a health-check no-op - so it counts as
    // genuine activity against Supabase's inactivity timer.
    const userCount = await prisma.user.count();
    return Response.json({ ok: true, userCount, pingedAt: new Date().toISOString() });
  } catch (error) {
    console.error("[cron/keep-alive] DB ping failed:", error);
    return Response.json({ ok: false, error: "Database unreachable" }, { status: 500 });
  }
}
