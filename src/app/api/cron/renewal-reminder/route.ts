import { prisma } from "@/lib/prisma";
import { isEmailConfigured, sendEmail } from "@/lib/email";

/** Tells a Pro subscriber their plan is about to end, once per billing period.
 *
 * WHY THIS JOB HAS TO EXIST. The Razorpay path - the primary gateway for the INR
 * price - is a ONE-TIME payment, not a recurring mandate (see
 * api/razorpay/verify/route.ts). It grants 30 or 365 days, and then
 * `resolveEffectivePlan` silently drops the account to FREE. There is no failed-charge
 * email from a gateway because there is no charge to fail. Without this, a subscriber's
 * first notice that their plan ended is a feature quietly refusing to work - and the
 * person most likely to lapse is exactly the one who has not opened the app lately, so
 * the in-app notice on the Account screen cannot reach them.
 *
 * ONCE PER PERIOD, AND THAT IS THE WHOLE DESIGN PROBLEM. This runs daily, so the naive
 * version emails the same person every day for a week and trains them to filter you.
 * `renewalReminderFor` stores the period end a reminder was sent FOR, so the check is
 * an equality test against the user's current `currentPeriodEnd` - exact, no interval
 * arithmetic, and self-resetting the moment they renew into a new period.
 *
 * MARKED BEFORE SENDING IS WRONG, AND SO IS MARKING AFTER - so it marks after a send
 * that did not hard-fail. Marking first loses the reminder entirely if the provider is
 * down; never marking risks a duplicate on the next run. Sending then marking means the
 * worst case is one repeat tomorrow, which is the mildest of the three failures.
 *
 * IT NEVER THROWS ON ONE USER. A provider error for user #3 must not abandon the other
 * two hundred - see the fail-soft contract in lib/email.ts.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** How long before expiry to warn. Seven days is one study week: long enough to act on
 * before an exam, short enough that the plan's end is a real thing rather than an
 * abstract one. A second nag at one day was considered and left out - it needs a second
 * marker column to stay idempotent, and one honest notice beats two ignorable ones. */
const WARN_WITHIN_DAYS = 7;

export async function GET(request: Request) {
  // Same fail-closed auth as /api/cron/keep-alive: with no CRON_SECRET set, every
  // request is rejected rather than leaving a route that can email your users public.
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isEmailConfigured()) {
    // A deployment without Resend configured is a valid state, not a failure - say so
    // plainly instead of 500ing a scheduled job every single day.
    return Response.json({ ok: true, skipped: "email not configured", sent: 0 });
  }

  const now = new Date();
  const horizon = new Date(now.getTime() + WARN_WITHIN_DAYS * 86_400_000);

  try {
    const candidates = await prisma.user.findMany({
      where: {
        plan: "PRO",
        // Still active (gte now) but ending within the window. An already-expired
        // account is not reminded: resolveEffectivePlan has downgraded it, and
        // "your plan ended" is a different message from "your plan is ending".
        currentPeriodEnd: { gte: now, lte: horizon },
        email: { not: null },
      },
      select: { id: true, email: true, name: true, currentPeriodEnd: true, renewalReminderFor: true },
    });

    let sent = 0;
    let failed = 0;

    for (const user of candidates) {
      if (!user.email || !user.currentPeriodEnd) continue;

      // Prisma cannot compare two columns in a `where`, so the idempotency check runs
      // here. The candidate set is small by construction (Pro accounts expiring inside
      // a week), so this is a handful of rows, not a scan.
      if (user.renewalReminderFor?.getTime() === user.currentPeriodEnd.getTime()) continue;

      const days = Math.max(0, Math.ceil((user.currentPeriodEnd.getTime() - now.getTime()) / 86_400_000));
      const result = await sendEmail({
        to: user.email,
        subject:
          days <= 1 ? "Your FlowRecall Pro ends tomorrow" : `Your FlowRecall Pro ends in ${days} days`,
        text: [
          `Hi${user.name ? ` ${user.name}` : ""},`,
          "",
          days <= 1
            ? "Your FlowRecall Pro plan ends tomorrow."
            : `Your FlowRecall Pro plan ends in ${days} days.`,
          "",
          "Everything you have already made stays yours - your decks, highlights and",
          "reading progress remain free to study and review. What ends is the unlimited",
          "generation and lookups.",
          "",
          "Renew here: https://www.flowrecall.app/pricing",
        ].join("\n"),
      });

      if (result.ok) {
        sent += 1;
        await prisma.user
          .update({ where: { id: user.id }, data: { renewalReminderFor: user.currentPeriodEnd } })
          .catch((error) => {
            // The email went out; failing to mark it only risks one repeat tomorrow.
            console.error(`[cron/renewal-reminder] mark failed user=${user.id}`, error);
          });
      } else if (!result.skipped) {
        failed += 1;
        console.error(`[cron/renewal-reminder] send failed user=${user.id}: ${result.reason}`);
      }
    }

    return Response.json({ ok: true, candidates: candidates.length, sent, failed });
  } catch (error) {
    console.error("[cron/renewal-reminder] job failed", error);
    return Response.json({ ok: false, error: "Job failed" }, { status: 500 });
  }
}
