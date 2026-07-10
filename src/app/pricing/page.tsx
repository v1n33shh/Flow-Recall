"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import Script from "next/script";

const FREE_FEATURES = [
  "1 deck per day (up to 60,000 chars)",
  "Llama 3.3 70B — fast, capable free model",
  "Active-recall study feed with spaced repetition",
  "Daily streak tracking",
  "Save decks to your library",
];

const PRO_FEATURES = [
  "Everything in Free",
  "Unlimited deck generation per day",
  "Claude Haiku — smarter AI, optimised for deep material",
  "Infinite Recall Mode — AI generates new angles forever",
  "Streak Freezes — protect your flame on off-days",
];

function Check() {
  return (
    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-white/15 text-[11px] font-semibold text-zinc-400">
      ✓
    </span>
  );
}

// Defensive JSON reader. If an API route ever fails at the framework level it
// returns an HTML error page, and calling res.json() on that throws the classic
// `Unexpected token '<', "<!DOCTYPE "... is not valid JSON`. We read the body as
// text first and surface a clean, human error instead of that cryptic one.
async function readJson(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new Error(
      res.ok
        ? "Received an unexpected response from the server."
        : "The server returned an error. Please try again in a moment.",
    );
  }
}

export default function PricingPage() {
  const router = useRouter();
  const { data: session, status, update } = useSession();
  const isPro = session?.user?.plan === "PRO";

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isYearly, setIsYearly] = useState(true);

  async function handleUpgrade() {
    // Can't attribute a payment without a logged-in user - send them to log in.
    if (status !== "authenticated") {
      router.push("/login");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const planType = isYearly ? "YEARLY" : "MONTHLY";
      const res = await fetch("/api/razorpay/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planType }),
      });
      const data = await readJson(res);

      if (!res.ok || typeof data.id !== "string") {
        throw new Error(
          (typeof data.error === "string" && data.error) ||
            "Could not start checkout. Please try again.",
        );
      }

      const options = {
        key: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
        amount: data.amount,
        currency: data.currency,
        name: "FlowRecall",
        description: "Pro Plan - Unlock the smartest AI models.",
        order_id: data.id,
        handler: async function (response: any) {
          try {
            // Note: no userId is sent. The server re-derives it from the order's
            // notes after verifying the signature, so the browser can't attribute
            // a payment to an account it doesn't own.
            const verifyRes = await fetch("/api/razorpay/verify", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_order_id: response.razorpay_order_id,
                razorpay_signature: response.razorpay_signature,
              }),
            });
            const verifyData = await readJson(verifyRes);

            if (verifyRes.ok) {
              // Refresh the JWT so the navbar/plan gates see PRO without a
              // re-login, then land on the account page.
              await update();
              window.location.href = "/account?upgraded=1";
            } else {
              setError(
                (typeof verifyData.error === "string" && verifyData.error) ||
                  "Payment verification failed.",
              );
              setLoading(false);
            }
          } catch (err) {
            setError(err instanceof Error ? err.message : "Payment verification failed.");
            setLoading(false);
          }
        },
        prefill: {
          name: session?.user?.name,
          email: session?.user?.email,
        },
        theme: {
          color: "#3B82F6",
        },
        modal: {
          ondismiss: function () {
            setLoading(false);
          },
        },
      };

      const rzp = new (window as any).Razorpay(options);
      rzp.on("payment.failed", function (response: any) {
        setError(response.error.description);
        setLoading(false);
      });
      rzp.open();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col px-4 py-10 sm:px-6 sm:py-16">
      <Script src="https://checkout.razorpay.com/v1/checkout.js" strategy="lazyOnload" />
      <h1 className="text-center text-3xl font-semibold tracking-tight text-white sm:text-4xl">
        Simple, honest pricing
      </h1>
      <p className="mx-auto mt-3 max-w-md text-center text-sm text-zinc-400">
        Start free. Upgrade when you want the smartest models on your side.
      </p>

      {/* Monthly / Yearly Toggle */}
      <div className="mx-auto mt-10 flex items-center justify-center gap-3">
        <span
          className={`text-sm font-medium transition-colors ${
            !isYearly ? "text-white" : "text-zinc-500"
          }`}
        >
          Monthly
        </span>
        <button
          type="button"
          onClick={() => setIsYearly(!isYearly)}
          className="relative inline-flex h-6 w-11 items-center rounded-full bg-white/10 transition-colors hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 focus:ring-offset-zinc-950"
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
              isYearly ? "translate-x-6" : "translate-x-1"
            }`}
          />
        </button>
        <span
          className={`text-sm font-medium transition-colors ${
            isYearly ? "text-white" : "text-zinc-500"
          }`}
        >
          Yearly <span className="ml-1 rounded-full bg-accent/20 px-2 py-0.5 text-[10px] text-accent">Save 30%</span>
        </span>
      </div>

      <div className="mt-10 grid gap-6 sm:grid-cols-2">
        {/* Free tier - frosted glass */}
        <div className="flex flex-col rounded-2xl border border-white/10 bg-white/[0.02] p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.1)] backdrop-blur-xl">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-400">Free</h2>
          <div className="mt-3 flex items-baseline gap-1">
            <span className="text-4xl font-semibold text-white">$0</span>
            <span className="text-sm font-medium text-zinc-500">/mo</span>
          </div>
          <p className="mt-2 text-sm text-zinc-400">Everything you need to start studying smarter.</p>

          <ul className="mt-6 flex flex-1 flex-col gap-3 text-sm text-zinc-200">
            {FREE_FEATURES.map((f) => (
              <li key={f} className="flex gap-2.5">
                <Check />
                {f}
              </li>
            ))}
          </ul>

          <div className="mt-8 rounded-full border border-white/10 px-6 py-3 text-center text-sm font-medium text-zinc-400">
            {isPro ? "Included in Pro" : "Your current plan"}
          </div>
        </div>

        {/* Pro tier - frosted glass with an elegant Electric Azure ambient glow */}
        <div className="relative flex flex-col rounded-2xl border border-accent/30 bg-white/[0.02] p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.1),0_0_40px_rgba(59,130,246,0.15)] backdrop-blur-xl">
          <span className="absolute -top-3 right-6 rounded-full bg-gradient-to-b from-blue-400 to-blue-600 px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-white shadow-lg shadow-blue-500/30">
            Most popular
          </span>
          <h2 className="text-xs font-semibold uppercase tracking-widest text-accent">Pro</h2>
          <div className="mt-3 flex flex-col gap-0.5">
            <span className="text-xs font-medium text-zinc-500 line-through">
              {isYearly ? "₹3588/yr" : "₹499/mo"}
            </span>
            <div className="flex items-baseline gap-1">
              <span className="bg-gradient-to-b from-white to-zinc-400 bg-clip-text text-4xl font-semibold text-transparent">
                {isYearly ? "₹2499" : "₹299"}
              </span>
              <span className="text-sm font-medium text-zinc-400">
                {isYearly ? "/yr" : "/mo"}
              </span>
            </div>
            {isYearly && (
              <p className="mt-1 text-xs font-medium text-accent">
                That's just ₹208/month
              </p>
            )}
          </div>
          <p className="mt-2 text-sm text-zinc-300">The frontier models, unlocked for serious study.</p>

          <ul className="mt-6 flex flex-1 flex-col gap-3 text-sm text-zinc-100">
            {PRO_FEATURES.map((f) => (
              <li key={f} className="flex gap-2.5">
                <Check />
                {f}
              </li>
            ))}
          </ul>

          {error && (
            <div className="mt-6 rounded-lg border border-rose-500/30 bg-rose-950/30 px-4 py-2.5 text-sm text-rose-300">
              {error}
            </div>
          )}

          <button
            type="button"
            onClick={handleUpgrade}
            disabled={loading || isPro}
            className="mt-6 rounded-full bg-gradient-to-b from-blue-500 to-blue-600 px-6 py-3.5 text-base font-semibold text-white ring-1 ring-inset ring-blue-400/40 shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_8px_28px_-6px_rgba(37,99,235,0.55)] transition-all duration-200 hover:from-blue-400 hover:to-blue-500 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_12px_40px_-6px_rgba(59,130,246,0.75)] hover:scale-[1.02] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:scale-100 disabled:hover:shadow-none"
          >
            {isPro ? "You are on Pro" : loading ? "Starting checkout..." : "Upgrade Now"}
          </button>

          <p className="mt-3 text-center text-[11px] font-medium text-zinc-500">
            Secure, encrypted payment via Razorpay
          </p>
        </div>
      </div>

      <div className="mt-16 text-center text-sm text-zinc-400">
        Questions? Need support?{" "}
        <a href="mailto:founder@flowrecall.app" className="text-accent transition-colors hover:text-blue-400 hover:underline">
          Email us
        </a>
      </div>
    </main>
  );
}
