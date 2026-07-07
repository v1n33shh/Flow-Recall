import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getRazorpay } from "@/lib/razorpay";

// Reads cookies (via auth()) and creates a live order, so it must never be
// statically evaluated or cached.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ₹899/mo, quoted to Razorpay in paise.
const PRO_AMOUNT_PAISE = 899 * 100;
const CURRENCY = "INR";

export async function POST() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "You must be signed in to upgrade." }, { status: 401 });
    }

    // Re-read the plan from the DB rather than trusting session.user.plan: the
    // JWT token is seeded at sign-in and can be stale (see src/auth.ts). This
    // is the authoritative "already PRO?" gate.
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { id: true, plan: true },
    });
    if (!user) {
      return NextResponse.json({ error: "Account not found." }, { status: 404 });
    }
    if (user.plan === "PRO") {
      return NextResponse.json({ error: "You're already on the Pro plan." }, { status: 409 });
    }

    const razorpay = getRazorpay();
    const order = await razorpay.orders.create({
      amount: PRO_AMOUNT_PAISE,
      currency: CURRENCY,
      receipt: `rcpt_${user.id.slice(0, 30)}`,
      // notes.userId is the ONLY trusted link between this order and our user.
      // The verify route/webhook reads it back - it never trusts a userId sent
      // from the browser.
      notes: { userId: user.id },
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
