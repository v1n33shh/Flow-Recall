import { auth } from "@/auth";
import { getStripe } from "@/lib/stripe";

export async function POST(request: Request) {
  // Only a signed-in user can start a checkout - we need their id to credit
  // the upgrade to the right account once payment completes.
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "You must be signed in to upgrade." }, { status: 401 });
  }

  const priceId = process.env.STRIPE_PRICE_ID;
  if (!priceId) {
    console.error("STRIPE_PRICE_ID is not set");
    return Response.json(
      { error: "Billing isn't configured yet. Please try again later." },
      { status: 500 },
    );
  }

  // Absolute URLs are required by Stripe; derive them from the request so this
  // works across localhost, previews, and production without another env var.
  const origin = request.headers.get("origin") ?? new URL(request.url).origin;

  try {
    const stripe = getStripe();
    const checkout = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      // The webhook reads this back to find who paid - it's the single link
      // between a Stripe payment and a row in our own database.
      client_reference_id: session.user.id,
      // Prefill the email so Stripe reuses/creates the right customer.
      customer_email: session.user.email ?? undefined,
      success_url: `${origin}/account?upgraded=1`,
      cancel_url: `${origin}/pricing?canceled=1`,
    });

    if (!checkout.url) {
      throw new Error("Stripe did not return a checkout URL");
    }

    return Response.json({ url: checkout.url });
  } catch (error) {
    console.error("Stripe checkout failed", error);
    return Response.json(
      { error: "Could not start checkout. Please try again." },
      { status: 502 },
    );
  }
}
