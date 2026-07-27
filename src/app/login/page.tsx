"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { Capacitor } from "@capacitor/core";
import { Browser } from "@capacitor/browser";
import { apiUrl } from "@/lib/apiUrl";
import { vibrateTap } from "@/lib/haptics";

/** Standard 4-color Google "G" mark. */
function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1Z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z" />
      <path fill="#FBBC05" d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84Z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38Z" />
    </svg>
  );
}

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    vibrateTap();
    setLoading(true);
    setError(null);

    const result = await signIn("credentials", { email, password, redirect: false });

    if (result?.error) {
      setError("Incorrect email or password.");
      setLoading(false);
      return;
    }

    router.push("/");
    router.refresh();
  }

  // Reached when the Capacitor app opens THIS page in the system browser for
  // Google sign-in (see handleGoogle below) - auto-continue into the OAuth
  // redirect instead of making the user tap "Continue with Google" twice.
  // This runs as a normal same-origin browser request, which is the whole
  // point: no CapacitorHttp, no cross-origin cookies, so Auth.js's CSRF
  // double-submit check (@auth/core/lib/actions/callback/oauth/csrf-token.js)
  // just works the same way it already does on desktop web.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("mobile") === "1") {
      void signIn("google", { callbackUrl: apiUrl("/api/mobile-callback") });
    }
  }, []);

  function handleGoogle() {
    vibrateTap();
    setLoading(true);

    if (Capacitor.isNativePlatform()) {
      // signIn() can't be called from inside the app on native: it requires
      // a CSRF-protected POST (Auth.js throws MissingCSRF without one - see
      // @auth/core/lib/actions/callback/oauth/csrf-token.js), and that
      // handshake doesn't survive being proxied through CapacitorHttp
      // cross-origin from https://localhost. Google also blocks its own
      // consent screen inside an embedded WebView regardless. So instead:
      // open this same page in the system browser, where the effect above
      // runs signIn() as an ordinary full-page browser flow. NextAuth's
      // callback then redirects that browser to /api/mobile-callback, which
      // hands the session back to the app via a flowrecall:// deep link -
      // see src/components/MobileAuthBridge.tsx and src/lib/mobileAuth.ts.
      void Browser.open({ url: apiUrl("/login?mobile=1") }).finally(() => setLoading(false));
      return;
    }

    // Full-page OAuth redirect; NextAuth handles the callback and returns to "/".
    void signIn("google", { callbackUrl: "/" });
  }

  // Inline fractal-noise SVG for the cinematic film-grain overlay (desktop only).
  const NOISE_BACKGROUND =
    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

  return (
    <main className="relative flex flex-1 flex-col items-center justify-center overflow-hidden px-6 py-16">
      {/* Faded spotlight grid (cheap, always on) */}
      <div className="pointer-events-none absolute inset-0 -z-10 bg-[linear-gradient(to_right,#ffffff08_1px,transparent_1px),linear-gradient(to_bottom,#ffffff08_1px,transparent_1px)] bg-[size:3rem_3rem] [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_70%)]" />

      {/* Ambient glow orbs — desktop only (blur-3xl janks Android scroll) */}
      <div className="pointer-events-none absolute inset-0 -z-10 hidden overflow-hidden md:block">
        <div className="absolute -top-40 left-1/2 h-[38rem] w-[38rem] -translate-x-1/2 rounded-full bg-white/5 blur-3xl" />
        <div className="absolute top-1/3 -left-32 h-[30rem] w-[30rem] rounded-full bg-white/[0.03] blur-3xl" />
        <div className="absolute -bottom-24 right-[-8rem] h-[32rem] w-[32rem] rounded-full bg-white/5 blur-3xl" />
      </div>

      {/* Cinematic film grain — desktop only */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-0 hidden opacity-[0.03] md:block"
        style={{ backgroundImage: NOISE_BACKGROUND }}
      />

      <div className="relative z-10 w-full max-w-md">
        <div className="mb-8 text-center">
          <h1 className="font-sans text-3xl font-bold tracking-tight text-white">
            Welcome back
          </h1>
          <p className="mt-2 text-sm text-zinc-400">Sign in to pick up where you left off.</p>
        </div>

        <div className="flex flex-col gap-5 rounded-3xl border border-white/10 bg-white/[0.02] p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.1)] backdrop-blur-xl sm:p-8">
          {/* Google OAuth */}
          <button
            type="button"
            onClick={handleGoogle}
            disabled={loading}
            className="flex w-full items-center justify-center gap-3 rounded-full border border-white/10 bg-white/[0.03] px-6 py-3.5 text-sm font-medium text-zinc-100 transition-all duration-200 hover:bg-white/[0.06] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <GoogleIcon />
            Continue with Google
          </button>

          {/* Divider */}
          <div className="flex items-center gap-4">
            <span className="h-px flex-1 bg-white/10" />
            <span className="text-xs uppercase tracking-widest text-zinc-500">or</span>
            <span className="h-px flex-1 bg-white/10" />
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-5">
            <div>
              <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-zinc-400">
                Email
              </label>
              <input
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full rounded-2xl border border-white/10 bg-black/40 px-5 py-3.5 text-sm text-zinc-100 placeholder-zinc-600 shadow-[inset_0_2px_4px_rgba(0,0,0,0.4)] outline-none transition-all focus:border-white/30 focus:ring-1 focus:ring-white/20"
              />
            </div>
            <div>
              <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-zinc-400">
                Password
              </label>
              <input
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full rounded-2xl border border-white/10 bg-black/40 px-5 py-3.5 text-sm text-zinc-100 placeholder-zinc-600 shadow-[inset_0_2px_4px_rgba(0,0,0,0.4)] outline-none transition-all focus:border-white/30 focus:ring-1 focus:ring-white/20"
              />
            </div>

            {error && (
              <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-5 py-3.5 text-sm font-medium text-red-400 backdrop-blur-md">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="mt-2 w-full rounded-full bg-gradient-to-b from-blue-500 to-blue-600 px-6 py-4 text-sm font-semibold text-white ring-1 ring-inset ring-blue-400/40 shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_8px_28px_-6px_rgba(37,99,235,0.55)] transition-all duration-200 hover:from-blue-400 hover:to-blue-500 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_12px_40px_-6px_rgba(59,130,246,0.75)] hover:scale-[1.02] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:shadow-none"
            >
              {loading ? "Authenticating..." : "Sign in to Dashboard"}
            </button>
          </form>
        </div>

        <p className="mt-8 text-center text-sm text-zinc-500">
          Don&apos;t have an account?{" "}
          <Link href="/register" className="font-semibold text-white transition-colors hover:text-zinc-300">
            Create one
          </Link>
        </p>
      </div>
    </main>
  );
}
