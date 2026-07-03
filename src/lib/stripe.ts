import Stripe from "stripe";

// Server-only Stripe client - the secret key must never reach the browser.
// Built lazily behind a getter (rather than at module load) so importing this
// file during `next build` doesn't crash when STRIPE_SECRET_KEY is unset, and
// so a missing key surfaces as a clear runtime error at the point of use.
let cached: Stripe | null = null;

export function getStripe(): Stripe {
  if (!cached) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) {
      throw new Error("STRIPE_SECRET_KEY is not set");
    }
    // No explicit apiVersion: the SDK pins its own tested default, which
    // avoids a TS literal-version mismatch and follows Stripe's guidance.
    cached = new Stripe(key);
  }
  return cached;
}
