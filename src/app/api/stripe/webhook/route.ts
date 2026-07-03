import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import { prisma } from "@/lib/prisma";

// Signature verification needs the exact raw request body, so keep this route
// on the Node runtime and never let it be statically optimized / cached.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error("STRIPE_WEBHOOK_SECRET is not set");
    return new Response("Webhook not configured", { status: 500 });
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return new Response("Missing stripe-signature header", { status: 400 });
  }

  // Must be the untouched raw body - parsing it first would break the HMAC.
  const rawBody = await request.text();

  let event: Stripe.Event;
  try {
    const stripe = getStripe();
    event = await stripe.webhooks.constructEventAsync(rawBody, signature, webhookSecret);
  } catch (error) {
    // A failed signature check means the payload isn't genuinely from Stripe
    // (or was tampered with) - refuse to act on it.
    console.error("Stripe webhook signature verification failed", error);
    return new Response("Invalid signature", { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    const checkoutSession = event.data.object as Stripe.Checkout.Session;
    const userId = checkoutSession.client_reference_id;

    if (!userId) {
      // Nothing to map the payment to - ack so Stripe stops retrying, but log
      // loudly because it means a checkout was created without our reference.
      console.error("checkout.session.completed missing client_reference_id", checkoutSession.id);
      return new Response("No client_reference_id", { status: 200 });
    }

    // updateMany (not update) so a missing/deleted user is a no-op count of 0
    // rather than a throw - a genuinely absent row won't be fixed by retries.
    const result = await prisma.user.updateMany({
      where: { id: userId },
      data: { plan: "PRO" },
    });

    if (result.count === 0) {
      console.error("checkout.session.completed for unknown user", userId);
    }
  }

  // 2xx acknowledges receipt; any thrown error above returns 500 and Stripe
  // will retry, which is the right behavior for a transient DB failure.
  return new Response(null, { status: 200 });
}
