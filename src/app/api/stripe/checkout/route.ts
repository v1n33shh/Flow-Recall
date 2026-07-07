import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getStripe } from "@/lib/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    // Only a signed-in user can start a checkout - we need their id to credit
    // the upgrade to the right account once payment completes.
    const session = await auth();
    if (!session?.user?.id) {
      return Response.json({ error: "You must be signed in to upgrade." }, { status: 401 });
    }

    const priceId = process.env.STRIPE_PRICE_ID;
    if (!priceId) {
      console.error("[stripe/checkout] STRIPE_PRICE_ID is not set");
      return Response.json(
        { error: "Billing isn't configured yet. Please try again later." },
        { status: 500 },
      );
    }

    // Guard against double-subscribing (mirrors the Razorpay order route).
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { id: true, email: true, plan: true, stripeCustomerId: true },
    });
    if (!user) {
      return Response.json({ error: "Account not found." }, { status: 404 });
    }
    if (user.plan === "PRO") {
      return Response.json({ error: "You're already on the Pro plan." }, { status: 409 });
    }

    // Absolute URLs are required by Stripe; derive them from the request so this
    // works across localhost, previews, and production without another env var.
    const origin = request.headers.get("origin") ?? new URL(request.url).origin;

    const stripe = getStripe();
    const checkout = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      // client_reference_id is the single link between a Stripe payment and a row
      // in our DB - the webhook reads it back.
      client_reference_id: user.id,
      // Reuse an existing customer if we've seen this user pay before; otherwise
      // prefill the email so Stripe creates/matches the right customer.
      ...(user.stripeCustomerId
        ? { customer: user.stripeCustomerId }
        : { customer_email: user.email ?? undefined }),
      success_url: `${origin}/account?upgraded=1`,
      cancel_url: `${origin}/pricing?canceled=1`,
    });

    if (!checkout.url) {
      throw new Error("Stripe did not return a checkout URL");
    }

    return Response.json({ url: checkout.url });
  } catch (error) {
    console.error("[stripe/checkout] failed:", error);
    return Response.json(
      { error: "Could not start checkout. Please try again." },
      { status: 502 },
    );
  }
}
