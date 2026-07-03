"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";

export default function RegisterPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error ?? "Something went wrong.");
      }

      // Sign in immediately after registering - no separate "now go log in" step.
      const result = await signIn("credentials", { email, password, redirect: false });
      if (result?.error) {
        throw new Error("Account created - please sign in.");
      }

      router.push("/");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-6 py-16">
      <h1 className="text-3xl font-bold tracking-tight text-white">Create your account</h1>
      <p className="mt-2 text-sm text-zinc-400">
        Free forever. No credit card, no Google, no friction.
      </p>

      <form
        onSubmit={handleSubmit}
        className="mt-8 flex flex-col gap-4 rounded-2xl border-2 border-white/15 bg-white/5 p-6 shadow-xl backdrop-blur-md sm:p-8"
      >
        <div>
          <label className="mb-2 block text-sm font-medium text-zinc-300">Email</label>
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="w-full rounded-xl border-2 border-white/10 bg-black/30 px-4 py-3 text-base text-zinc-100 outline-none focus:border-emerald-500"
          />
        </div>
        <div>
          <label className="mb-2 block text-sm font-medium text-zinc-300">Password</label>
          <input
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="At least 8 characters"
            className="w-full rounded-xl border-2 border-white/10 bg-black/30 px-4 py-3 text-base text-zinc-100 outline-none focus:border-emerald-500"
          />
        </div>

        {error && (
          <div className="rounded-xl border-2 border-emerald-500 bg-emerald-500/10 px-4 py-3 text-sm font-medium text-emerald-300">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="mt-2 rounded-full bg-emerald-500 px-6 py-3.5 text-base font-medium text-white transition-colors hover:bg-emerald-400 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? "Creating account..." : "Create account"}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-zinc-500">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-emerald-400 hover:text-emerald-300">
          Sign in
        </Link>
      </p>
    </main>
  );
}
