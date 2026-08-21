import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { resolveEffectivePlan } from "@/lib/billing";
import { getRazorpay } from "@/lib/razorpay";

// Reads cookies (via auth()) and creates a live order, so it must never be
// statically evaluated or cached.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MONTHLY_PAISE = 299 * 100;
const YEARLY_PAISE = 2499 * 100;
const CURRENCY = "INR";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const planType = body.planType === "YEARLY" ? "YEARLY" : "MONTHLY";
    const amountPaise = planType === "YEARLY" ? YEARLY_PAISE : MONTHLY_PAISE;

    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "You must be signed in to upgrade." }, { status: 401 });
    }

    // Re-read the plan from the DB rather than trusting session.user.plan: the
    // JWT token is seeded at sign-in and can be stale (see src/auth.ts). This
    // is the authoritative "already PRO?" gate - resolved through
    // resolveEffectivePlan (not the raw column) so a user whose one-time
    // Razorpay payment has passed its currentPeriodEnd can actually re-buy,
    // instead of being permanently blocked from ever paying again.
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { id: true, plan: true, currentPeriodEnd: true },
    });
    if (!user) {
      return NextResponse.json({ error: "Account not found." }, { status: 404 });
    }
    const plan = await resolveEffectivePlan(user);
    if (plan === "PRO") {
      return NextResponse.json({ error: "You're already on the Pro plan." }, { status: 409 });
    }

    const razorpay = getRazorpay();
    const order = await razorpay.orders.create({
      amount: amountPaise,
      currency: CURRENCY,
      receipt: `rcpt_${user.id.slice(0, 30)}`,
      // notes.userId is the ONLY trusted link between this order and our user.
      // The verify route/webhook reads it back - it never trusts a userId sent
      // from the browser.
      notes: { userId: user.id, planType },
    });

    return NextResponse.json({ id: order.id, amount: order.amount, currency: order.currency });
  } catch (error) {
    // Any failure - missing keys (getRazorpay throws), Razorpay API errors, DB
    // errors - is caught here and returned as JSON, so the client always gets
    // JSON and never an HTML error page.
    console.error("[razorpay/order] failed:", error);
    return NextResponse.json({ error: "Could not start checkout. Please try again." }, { status: 500 });
  }
}
