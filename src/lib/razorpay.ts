import Razorpay from "razorpay";

// Server-only Razorpay client. Mirrors lib/stripe.ts: built lazily behind a
// getter rather than at module load, so importing this file (during `next build`
// or when a route module is first evaluated) never crashes if the keys are
// unset. The Razorpay SDK constructor THROWS synchronously when `key_id` is
// falsy - doing that at module scope is exactly what made /api/razorpay/order
// return an HTML 500 page (→ the client's `Unexpected token '<'`), because the
// throw happened on import, before any handler try/catch could run.
let cached: Razorpay | null = null;

export function getRazorpay(): Razorpay {
  if (!cached) {
    const key_id = process.env.RAZORPAY_KEY_ID;
    const key_secret = process.env.RAZORPAY_KEY_SECRET;
    if (!key_id || !key_secret) {
      throw new Error("RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET are not set");
    }
    cached = new Razorpay({ key_id, key_secret });
  }
  return cached;
}
