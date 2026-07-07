import { NextResponse } from "next/server";
import crypto from "crypto";
import { getRazorpay } from "@/lib/razorpay";
import { grantPro } from "@/lib/billing";

// Verifies HMAC signatures over the raw body and grants PRO. No NextAuth
// session: the webhook path is called server-to-server by Razorpay, and the
// callback path is verified cryptographically, so a session would be both
// absent (webhook) and redundant (callback). The user is ALWAYS resolved from a
// trusted server-side source (order/payment notes), never from the request.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Constant-time compare that can't throw on length mismatch (timingSafeEqual
// requires equal-length buffers).
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export async function POST(req: Request) {
  try {
    // Raw body is required for both HMACs - parsing first would break the hash.
    const rawBody = await req.text();
    const webhookSignature = req.headers.get("x-razorpay-signature");

    // ── Path A: server-to-server WEBHOOK ────────────────────────────────────
    // Configure this URL in the Razorpay dashboard for `payment.captured` /
    // `order.paid`. This is the reliable source of truth: it fires even if the
    // user closes the tab before the browser callback runs.
    if (webhookSignature) {
      const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
      if (!webhookSecret) {
        console.error("[razorpay/verify] RAZORPAY_WEBHOOK_SECRET is not set");
        return NextResponse.json({ error: "Webhook not configured" }, { status: 500 });
      }

      const expected = crypto.createHmac("sha256", webhookSecret).update(rawBody).digest("hex");
      if (!safeEqual(expected, webhookSignature)) {
        return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
      }

      const event = JSON.parse(rawBody);
      // Both event shapes carry the payment entity; notes.userId was set at
      // order creation. Fall back to the order entity's notes for order.paid.
      const entity =
        event?.payload?.payment?.entity ?? event?.payload?.order?.entity ?? null;
      const userId: string | undefined = entity?.notes?.userId;

      if (event?.event === "payment.captured" || event?.event === "order.paid") {
        if (!userId) {
          // Ack (200) so Razorpay stops retrying, but log loudly - a paid order
          // with no userId note means something upstream dropped the note.
          console.error("[razorpay/verify] webhook missing notes.userId", event?.event);
          return NextResponse.json({ received: true }, { status: 200 });
        }
        await grantPro({ userId, gateway: "razorpay", subscriptionId: entity?.order_id ?? null });
      }

      // 200 acknowledges receipt for every event type we don't act on too.
      return NextResponse.json({ received: true }, { status: 200 });
    }

    // ── Path B: browser CALLBACK (instant UX) ───────────────────────────────
    // The Razorpay Checkout handler posts these three fields. The callback
    // signature is HMAC(order_id|payment_id, KEY_SECRET) - a DIFFERENT secret
    // and payload from the webhook above.
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = JSON.parse(rawBody || "{}");
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return NextResponse.json({ error: "Missing payment fields." }, { status: 400 });
    }

    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!keySecret) {
      console.error("[razorpay/verify] RAZORPAY_KEY_SECRET is not set");
      return NextResponse.json({ error: "Payments not configured." }, { status: 500 });
    }

    const expected = crypto
      .createHmac("sha256", keySecret)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest("hex");
    if (!safeEqual(expected, razorpay_signature)) {
      return NextResponse.json({ error: "Payment verification failed." }, { status: 400 });
    }

    // Signature proved the payment is genuine; now derive WHO to credit from the
    // order's server-side notes - never from the request body (a client could
    // otherwise upgrade an arbitrary account).
    const razorpay = getRazorpay();
    const order = await razorpay.orders.fetch(razorpay_order_id);
    const userId = (order.notes as Record<string, string> | undefined)?.userId;
    if (!userId) {
      console.error("[razorpay/verify] callback order missing notes.userId", razorpay_order_id);
      return NextResponse.json({ error: "Could not attribute this payment." }, { status: 422 });
    }

    // Idempotent: this may also be granted by the webhook - grantPro just
    // re-writes the same row.
    await grantPro({ userId, gateway: "razorpay", subscriptionId: razorpay_order_id });

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error("[razorpay/verify] failed:", error);
    return NextResponse.json({ error: "Failed to verify payment." }, { status: 500 });
  }
}
