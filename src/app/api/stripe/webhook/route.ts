import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import { grantPro, revokePro } from "@/lib/billing";

// Signature verification needs the exact raw request body, so keep this route
// on the Node runtime and never let it be statically optimized / cached.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error("[stripe/webhook] STRIPE_WEBHOOK_SECRET is not set");
    return new Response("Webhook not configured", { status: 500 });
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return new Response("Missing stripe-signature header", { status: 400 });
  }

  // Must be the untouched raw body - parsing it first would break the HMAC.
  const rawBody = await request.text();

  const stripe = getStripe();
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(rawBody, signature, webhookSecret);
  } catch (error) {
    // A failed signature check means the payload isn't genuinely from Stripe
    // (or was tampered with) - refuse to act on it.
    console.error("[stripe/webhook] signature verification failed", error);
    return new Response("Invalid signature", { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const s = event.data.object as Stripe.Checkout.Session;
        const userId = s.client_reference_id;
        if (!userId) {
          // Ack so Stripe stops retrying, but log - a checkout without our
          // reference can never be attributed by a retry.
          console.error("[stripe/webhook] checkout.session.completed missing client_reference_id", s.id);
          break;
        }

        const subscriptionId = typeof s.subscription === "string" ? s.subscription : s.subscription?.id ?? null;
        const customerId = typeof s.customer === "string" ? s.customer : s.customer?.id ?? null;

        // Retrieve the subscription to capture the paid-through date. Best-effort:
        // a failure here shouldn't block granting access.
        let currentPeriodEnd: Date | null = null;
        if (subscriptionId) {
          try {
            const sub = await stripe.subscriptions.retrieve(subscriptionId);
            const anySub = sub as unknown as { current_period_end?: number };
            if (typeof anySub.current_period_end === "number") {
              currentPeriodEnd = new Date(anySub.current_period_end * 1000);
            }
          } catch (e) {
            console.error("[stripe/webhook] could not retrieve subscription", subscriptionId, e);
          }
        }

        await grantPro({ userId, gateway: "stripe", customerId, subscriptionId, currentPeriodEnd });
        break;
      }

      // Subscription ended (canceled, or final payment failed) - downgrade the
      // user we matched by the stored subscription id.
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        const result = await revokePro({ stripeSubscriptionId: sub.id });
        if (result.count === 0) {
          console.error("[stripe/webhook] subscription.deleted matched no user", sub.id);
        }
        break;
      }

      default:
        // Acknowledged but not acted on.
        break;
    }
  } catch (error) {
    // A thrown error returns 500 and Stripe retries - the right behavior for a
    // transient DB failure.
    console.error("[stripe/webhook] handler error", event.type, error);
    return new Response("Handler error", { status: 500 });
  }

  return new Response(null, { status: 200 });
}
