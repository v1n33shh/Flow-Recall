"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";

const FREE_FEATURES = [
  "Unlimited micro-concept generation",
  "Llama 3 (fast, free model)",
  "Spaced-repetition study feed",
  "Save decks to your library",
];

const PRO_FEATURES = [
  "Everything in Free",
  "GPT-4o for richer concepts",
  "Claude 3.5 Sonnet for deep material",
  "Priority generation speed",
];

function Check() {
  return (
    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-gold/40 text-[11px] font-semibold text-gold">
      ✓
    </span>
  );
}

export default function PricingPage() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const isPro = session?.user?.plan === "PRO";

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleUpgrade() {
    // Can't attribute a payment without a logged-in user - send them to log in.
    if (status !== "authenticated") {
      router.push("/login");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/stripe/checkout", { method: "POST" });
      const data = await res.json();

      if (!res.ok || !data.url) {
        throw new Error(data.error ?? "Could not start checkout. Please try again.");
      }

      // Hand off to Stripe's hosted Checkout page. (stripe-js v9 removed the
      // old redirectToCheckout helper; redirecting to the Session URL is the
      // current recommended flow.)
      window.location.href = data.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col px-4 py-10 sm:px-6 sm:py-16">
      <h1 className="text-center text-3xl font-semibold tracking-tight text-white sm:text-4xl">
        Simple, honest pricing
      </h1>
      <p className="mx-auto mt-3 max-w-md text-center text-sm text-zinc-400">
        Start free. Upgrade when you want the smartest models on your side.
      </p>

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

        {/* Pro tier - frosted glass with an elegant gold ambient glow */}
        <div className="relative flex flex-col rounded-2xl border border-gold/30 bg-white/[0.02] p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.1),0_0_40px_rgba(212,175,55,0.15)] backdrop-blur-xl">
          <span className="absolute -top-3 right-6 rounded-full bg-gradient-to-r from-amber-200 to-amber-500 px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-black shadow-lg">
            Most popular
          </span>
          <h2 className="text-xs font-semibold uppercase tracking-widest text-gold">Pro</h2>
          <div className="mt-3 flex items-baseline gap-1">
            <span className="bg-gradient-to-br from-amber-100 via-gold to-amber-500 bg-clip-text text-4xl font-semibold text-transparent">
              $10
            </span>
            <span className="text-sm font-medium text-zinc-400">/mo</span>
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
            className="mt-6 rounded-full bg-zinc-100 px-6 py-3.5 text-base font-semibold text-black shadow-[0_0_20px_rgba(255,255,255,0.15)] transition-all duration-200 hover:scale-[1.02] hover:bg-white active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:scale-100"
          >
            {isPro ? "You're on Pro 🎉" : loading ? "Starting checkout..." : "Upgrade Now"}
          </button>

          <p className="mt-3 text-center text-[11px] font-medium text-zinc-500">
            🔒 Secure, encrypted payment via Stripe
          </p>
        </div>
      </div>
    </main>
  );
}
