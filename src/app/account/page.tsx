"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getSession, signOut, useSession } from "next-auth/react";
import { animate, motion, useMotionValue, useTransform } from "motion/react";
import { Capacitor } from "@capacitor/core";
import { Browser } from "@capacitor/browser";
import SignOutButton from "@/components/SignOutButton";
import GoogleIcon from "@/components/GoogleIcon";
import LogoMark from "@/components/LogoMark";
import { apiUrl } from "@/lib/apiUrl";
import { vibrateTap } from "@/lib/haptics";
import { getTheme, setTheme, type Theme } from "@/lib/theme";
import { useIsNative } from "@/lib/useIsNative";

// Was a Server Component reading `auth()` + `prisma.user.findUnique` directly.
// That doesn't run in the Capacitor static export (no server behind the
// shell), so it's client-rendered from the session instead - the JWT already
// carries name/email/image/plan (see src/auth.ts), so no extra API call is
// needed.
export default function AccountPage() {
  // `null` = not yet determined. Computed post-mount (not during SSR/export)
  // to avoid a hydration mismatch between the server-rendered shell and the
  // native runtime - see the other isNative effects across this codebase.
  //
  // Staying on `null` (rendering neither branch) until this resolves is
  // load-bearing, not just tidy: WebAccountCard has its own
  // `router.replace("/")` on unauthenticated. Defaulting isNative to `false`
  // and switching to `true` only once Capacitor answers meant WebAccountCard
  // briefly mounted on native too, on every cold launch - and if the
  // session's first read happened to resolve to "unauthenticated" in that
  // same window (a known race, see NativeAccountScreen below), THAT effect
  // fired the redirect to "/" before this component ever swapped to
  // NativeAccountScreen. That, not AnimatePresence, was the actual mechanism
  // behind the tab bouncing to home.
  const isNative = useIsNative<boolean | null>(null);

  if (isNative === null) return <AccountSkeleton />;

  // Native gets a dedicated iOS-Settings-style screen (see NativeAccountScreen
  // below) - the desktop web deployment keeps this simpler card layout, which
  // already fits alongside Navbar's own account entry point.
  return isNative ? <NativeAccountScreen /> : <WebAccountCard />;
}

function WebAccountCard() {
  const router = useRouter();
  const { data: session, status } = useSession();

  useEffect(() => {
    if (status === "unauthenticated") router.replace("/");
  }, [status, router]);

  if (status !== "authenticated") return null;

  const user = session.user;

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col px-4 py-10 sm:px-6 sm:py-16">
      <h1 className="text-2xl font-semibold tracking-tight">Account</h1>

      <div className="mt-6 flex items-center gap-4 rounded-2xl border-2 border-white/10 bg-white/5 p-5">
        {user.image ? (
          <Image src={user.image} alt="" width={56} height={56} className="rounded-full" />
        ) : (
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-accent text-xl font-bold text-white">
            {(user.name ?? user.email ?? "?").charAt(0).toUpperCase()}
          </span>
        )}
        <div className="min-w-0">
          <p className="truncate text-lg font-semibold text-white">{user.name ?? "Student"}</p>
          <p className="truncate text-sm text-zinc-400">{user.email}</p>
        </div>
      </div>

      <div className="mt-4 rounded-2xl border-2 border-white/10 bg-white/5 p-5">
        <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Plan</p>
        <p className="mt-1 text-lg font-semibold text-white">
          {user.plan === "PRO" ? "Pro" : "Free"}
        </p>
      </div>

      <div className="mt-8">
        <SignOutButton />
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Native: iOS Settings / Twitter-sidebar-style grouped account screen.
// ---------------------------------------------------------------------------

function ChevronIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4 shrink-0 text-zinc-600" aria-hidden="true">
      <path d="m9 6 6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CreditCardIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-[18px] w-[18px] text-accent" aria-hidden="true">
      <rect x="3" y="6" width="18" height="12" rx="2.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M3 10h18" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

function AppearanceIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-[18px] w-[18px] text-accent" aria-hidden="true">
      <circle cx="12" cy="12" r="4.5" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M12 2.5v2M12 19.5v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2.5 12h2M19.5 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function LogOutIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-[18px] w-[18px] text-red-400" aria-hidden="true">
      <path d="M15 4h2.5A1.5 1.5 0 0 1 19 5.5v13a1.5 1.5 0 0 1-1.5 1.5H15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M11 8l-4 4 4 4M7 12h11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** iOS-style pill switch. Knob position is a spring-animated transform
 * (translateX) - never left/width - so it stays compositor-only per the
 * PERFORMANCE CONTRACT the rest of the native chrome follows. */
function ThemeSwitch({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label="Dark mode"
      onClick={onToggle}
      className={`relative h-[30px] w-[50px] shrink-0 rounded-full transition-colors duration-200 ${
        on ? "bg-accent" : "bg-white/15"
      }`}
    >
      <motion.span
        className="absolute top-[3px] left-[3px] h-6 w-6 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.4)]"
        animate={{ x: on ? 20 : 0 }}
        transition={{ type: "spring", stiffness: 500, damping: 32 }}
      />
    </button>
  );
}

function SettingsGroup({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-surface/70 [&>*:not(:last-child)]:border-b [&>*:not(:last-child)]:border-white/[0.06]">
      {children}
    </div>
  );
}

function SettingsRow({
  icon,
  label,
  href,
  onClick,
  trailing,
  destructive,
}: {
  icon: React.ReactNode;
  label: string;
  href?: string;
  onClick?: () => void;
  trailing?: React.ReactNode;
  destructive?: boolean;
}) {
  const content = (
    <>
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] bg-white/[0.06]">
        {icon}
      </span>
      <span className={`flex-1 text-[15px] font-medium ${destructive ? "text-red-400" : "text-zinc-100"}`}>
        {label}
      </span>
      {trailing ?? (href && <ChevronIcon />)}
    </>
  );

  const className =
    "flex w-full items-center gap-3 px-4 py-3.5 text-left outline-none transition-colors active:bg-white/[0.06] focus-visible:bg-white/[0.06]";

  if (href) {
    return (
      <Link href={href} onClick={vibrateTap} className={className}>
        {content}
      </Link>
    );
  }

  return (
    <button type="button" onClick={onClick} className={className}>
      {content}
    </button>
  );
}

function AccountSkeleton() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col px-4 py-8">
      <div className="flex flex-col items-center gap-3 py-6">
        <div className="h-20 w-20 animate-pulse rounded-full bg-white/10" />
        <div className="h-4 w-32 animate-pulse rounded-full bg-white/10" />
        <div className="h-3 w-44 animate-pulse rounded-full bg-white/[0.06]" />
      </div>
      <div className="mt-6 h-16 animate-pulse rounded-2xl bg-white/[0.06]" />
      <div className="mt-6 h-40 animate-pulse rounded-2xl bg-white/[0.06]" />
    </main>
  );
}

function SignedOutPrompt() {
  const [loading, setLoading] = useState(false);

  // Bypasses the in-app /login page entirely. That page's Google button
  // (src/app/login/page.tsx handleGoogle) opens the system browser at
  // /login?mobile=1 specifically so its own useEffect can read that query
  // param and auto-fire signIn("google") - Auth.js needs a same-origin,
  // CSRF-protected POST that can't be proxied through CapacitorHttp, and
  // Google blocks its consent screen inside an embedded WebView regardless.
  // Routing here through <Link href="/login"> first would land on that same
  // static page via an in-app client-side transition with no query string at
  // all, so the auto-trigger would never fire - the user would tap "Continue
  // with Google" a second time for nothing to visibly happen until they
  // realized they had to tap it once *there* too. One tap, straight to the
  // real flow.
  //
  // No Capacitor.isNativePlatform() branch here on purpose: this component
  // only ever renders from NativeAccountScreen, which AccountPage already
  // gates on isNative - a redundant check here would just be a dead branch.
  //
  // async/try/catch/finally (not a .then/.finally chain) so a synchronous
  // throw from Browser.open itself - not just a rejected promise - still
  // resets `loading` instead of leaving the button stuck disabled. The
  // catch here was a temporary alert() to surface Browser.open's actual
  // error on device; that turned out to be "Unable to display URL" -
  // Android 11+'s package-visibility filtering hiding every browser from
  // PackageManager without a <queries> declaration (see
  // android/app/src/main/AndroidManifest.xml). Now fixed at the manifest
  // level, so this is back to a quiet last-resort fallback rather than a
  // debug dialog. See the matching handleGoogle in src/app/login/page.tsx.
  async function handleGoogle() {
    vibrateTap();
    setLoading(true);
    try {
      await Browser.open({ url: apiUrl("/login?mobile=1") });
    } catch {
      window.open(apiUrl("/login?mobile=1"), "_system");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="relative flex w-full flex-1 flex-col items-center justify-center gap-5 overflow-hidden px-6 py-16 text-center">
      <div aria-hidden="true" className="signed-out-glow pointer-events-none absolute inset-0 -z-10" />

      <motion.div
        initial={{ opacity: 0, scale: 0.85 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ type: "spring", stiffness: 320, damping: 22 }}
        className="relative flex h-16 w-16 items-center justify-center rounded-[28%] border border-white/10 bg-gradient-to-br from-zinc-800 to-zinc-950 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.1),0_12px_32px_-8px_rgba(0,0,0,0.7)]"
      >
        <LogoMark sheen className="h-[64%] w-[64%]" />
        <div className="pointer-events-none absolute inset-0 rounded-[28%] ring-1 ring-inset ring-white/5" />
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 380, damping: 32, delay: 0.08 }}
      >
        <h1 className="text-2xl font-bold tracking-tight text-zinc-100">Welcome to FlowRecall</h1>
        <p className="mx-auto mt-2 max-w-[22rem] text-sm text-zinc-500">
          Sign in to see your plan, streak, and account settings.
        </p>
      </motion.div>

      <motion.button
        type="button"
        onClick={handleGoogle}
        disabled={loading}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 380, damping: 32, delay: 0.16 }}
        className="mt-2 flex w-full max-w-xs items-center justify-center gap-3 rounded-full border border-white/10 bg-white/[0.03] px-6 py-3.5 text-sm font-medium text-zinc-100 transition-all duration-200 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
      >
        <GoogleIcon />
        {loading ? "Opening..." : "Continue with Google"}
      </motion.button>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.24 }}
      >
        <Link
          href="/login"
          onClick={vibrateTap}
          className="text-sm text-zinc-500 underline-offset-4 transition-colors hover:text-zinc-300 hover:underline"
        >
          or sign in with email
        </Link>
      </motion.div>
    </main>
  );
}

// How long a non-"authenticated" status is treated as still-loading before
// this screen believes it. Covers the real gap traced through the code: the
// first session read on native goes out through Capacitor's GET proxy path
// rather than the credentialed one, so it can transiently read
// "unauthenticated" before MobileAuthBridge's forced getSession() (mount +
// Capacitor 'resume') lands the real answer. Showing SignedOutPrompt the
// instant status left "loading" turned that ~0.5s gap into a visible flash;
// this grace period absorbs it instead. Once a genuinely "authenticated"
// read comes in, content shows immediately - the timer only ever delays the
// pessimistic (signed-out) conclusion, never the optimistic one.
const AUTH_GRACE_MS = 2500;

/** Entry stagger: each section fades/slides up on a small incremental delay.
 * transform (y) + opacity only, per the PERFORMANCE CONTRACT the rest of the
 * native chrome follows. */
function Reveal({ index, children }: { index: number; children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 380, damping: 32, delay: index * 0.05 }}
    >
      {children}
    </motion.div>
  );
}

const PULL_TRIGGER = 64;
const PULL_MAX = 88;

/** Native-feeling pull-to-refresh: re-runs getSession() to manually force the
 * same authoritative re-check MobileAuthBridge does automatically, for
 * anyone who wants to be sure "right now" rather than wait for the next
 * resume/focus event. Only engages when the page's own scroll container
 * (see data-scroll-root in PageTransition.tsx) is already at scrollTop 0 -
 * otherwise a downward drag is just... scrolling up.
 *
 * The drag itself sets a MotionValue directly (1:1 with the finger, no
 * animation lag); only the release-to-rest snap is spring-animated - using
 * `animate={{y: pull}}` for the live value too would make Framer spring
 * *toward* every pointermove sample, i.e. laggy rubber-banding while
 * dragging instead of true tracking. */
function PullToRefresh({ children }: { children: React.ReactNode }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const scrollRootRef = useRef<HTMLElement | null>(null);
  const dragStartY = useRef<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const pull = useMotionValue(0);
  const spinnerOpacity = useTransform(pull, [0, PULL_TRIGGER], [0, 1]);
  const spinnerY = useTransform(pull, (v) => v - 36);

  useEffect(() => {
    scrollRootRef.current = rootRef.current?.closest<HTMLElement>("[data-scroll-root]") ?? null;
  }, []);

  function onPointerDown(e: React.PointerEvent) {
    const scrollRoot = scrollRootRef.current;
    if (refreshing || !scrollRoot || scrollRoot.scrollTop > 0) return;
    dragStartY.current = e.clientY;
  }

  function onPointerMove(e: React.PointerEvent) {
    if (dragStartY.current === null) return;
    const delta = e.clientY - dragStartY.current;
    // Resistance curve, not 1:1 - real overscroll gets harder to pull the
    // further it goes, which is also what keeps this from feeling like the
    // page is just detaching and following the finger forever.
    pull.set(delta <= 0 ? 0 : Math.min(PULL_MAX, delta * 0.5));
  }

  async function onPointerUp() {
    if (dragStartY.current === null) return;
    dragStartY.current = null;
    if (pull.get() >= PULL_TRIGGER) {
      vibrateTap();
      setRefreshing(true);
      animate(pull, PULL_TRIGGER, { type: "spring", stiffness: 400, damping: 32 });
      await getSession().catch(() => {});
      setRefreshing(false);
    }
    animate(pull, 0, { type: "spring", stiffness: 400, damping: 32 });
  }

  return (
    <div
      ref={rootRef}
      className="relative"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <motion.div
        className="pointer-events-none absolute inset-x-0 top-0 flex justify-center"
        style={{ y: spinnerY, opacity: refreshing ? 1 : spinnerOpacity }}
      >
        <motion.span
          className="h-5 w-5 rounded-full border-2 border-accent border-t-transparent"
          animate={refreshing ? { rotate: 360 } : { rotate: 0 }}
          transition={refreshing ? { duration: 0.6, repeat: Infinity, ease: "linear" } : undefined}
        />
      </motion.div>
      <motion.div style={{ y: pull }}>{children}</motion.div>
    </div>
  );
}

const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION;

function NativeAccountScreen() {
  const { data: session, status } = useSession();
  const [theme, setThemeState] = useState<Theme>("dark");
  const [graceElapsed, setGraceElapsed] = useState(false);

  useEffect(() => {
    let mounted = true;
    Promise.resolve().then(() => {
      if (mounted) setThemeState(getTheme());
    });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setGraceElapsed(true), AUTH_GRACE_MS);
    return () => clearTimeout(timer);
  }, []);

  function toggleTheme() {
    vibrateTap();
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    setThemeState(next);
  }

  // Never bounces to another route on a bad/loading read (that's the exact
  // "Account tab redirects to home" bug) - this screen always renders its
  // own state for whatever `status` currently is, and gives a not-yet-
  // authenticated read the AUTH_GRACE_MS benefit of the doubt before
  // concluding the user is actually signed out.
  if (status !== "authenticated") {
    return graceElapsed ? <SignedOutPrompt /> : <AccountSkeleton />;
  }

  const user = session.user;
  const streak = user.currentStreak ?? 0;
  const isPro = user.plan === "PRO";

  return (
    <PullToRefresh>
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col px-4 py-8">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-100">Account</h1>

        <Reveal index={0}>
          <div className="mt-6 flex flex-col items-center gap-3 text-center">
            {user.image ? (
              <Image
                src={user.image}
                alt=""
                width={80}
                height={80}
                className="rounded-full ring-2 ring-white/10"
              />
            ) : (
              <span className="flex h-20 w-20 items-center justify-center rounded-full bg-accent text-2xl font-bold text-white ring-2 ring-white/10">
                {(user.name ?? user.email ?? "?").charAt(0).toUpperCase()}
              </span>
            )}
            <div>
              <p className="text-lg font-semibold text-zinc-100">{user.name ?? "Student"}</p>
              <p className="text-sm text-zinc-500">{user.email}</p>
            </div>
          </div>
        </Reveal>

        {/* Status row - plan + streak side by side, the two things worth
            glancing at every time this screen opens. */}
        <Reveal index={1}>
          <div className="mt-6 grid grid-cols-2 gap-3">
            <div className="rounded-2xl border border-white/10 bg-surface/70 px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Plan</p>
              <p className={`mt-0.5 text-lg font-bold ${isPro ? "text-accent" : "text-zinc-100"}`}>
                {isPro ? "Pro" : "Free"}
              </p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-surface/70 px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Streak</p>
              <p className="mt-0.5 text-lg font-bold tabular-nums text-zinc-100">
                {streak} {streak === 1 ? "day" : "days"}
              </p>
            </div>
          </div>
        </Reveal>

        <Reveal index={2}>
          <p className="mt-8 mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Account
          </p>
          <SettingsGroup>
            <SettingsRow icon={<CreditCardIcon />} label="Manage Subscription" href="/pricing" />
          </SettingsGroup>
        </Reveal>

        <Reveal index={3}>
          <p className="mt-6 mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Preferences
          </p>
          <SettingsGroup>
            <SettingsRow
              icon={<AppearanceIcon />}
              label="Dark Mode"
              trailing={<ThemeSwitch on={theme === "dark"} onToggle={toggleTheme} />}
            />
          </SettingsGroup>
        </Reveal>

        <Reveal index={4}>
          <div className="mt-6">
            <SettingsGroup>
              <SettingsRow
                icon={<LogOutIcon />}
                label="Log Out"
                destructive
                onClick={() => {
                  vibrateTap();
                  void signOut({ redirectTo: "/" });
                }}
              />
            </SettingsGroup>
          </div>
        </Reveal>

        {APP_VERSION && (
          <p className="mt-8 text-center text-xs text-zinc-600">FlowRecall v{APP_VERSION}</p>
        )}
      </main>
    </PullToRefresh>
  );
}
