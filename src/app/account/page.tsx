"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getSession, signOut, useSession } from "next-auth/react";
import { animate, motion, useMotionValue, useTransform } from "motion/react";
import { Capacitor } from "@capacitor/core";
import { Browser } from "@capacitor/browser";
import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import SignOutButton from "@/components/SignOutButton";
import GoogleIcon from "@/components/GoogleIcon";
import LogoMark from "@/components/LogoMark";
import { API_FETCH_CREDENTIALS, apiUrl } from "@/lib/apiUrl";
import { confirmationMatches } from "@/lib/deleteAccount";
import { deleteAllBooks } from "@/lib/readerStorage";
import { deleteAllRecallData } from "@/lib/recallStorage";
import { clearAllLocalUserData } from "@/lib/storage";
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

// ---------------------------------------------------------------------------
// Account deletion. Shared by both the web card and the native screen: it is
// the same account either way, and Play Console expects the flow to exist in
// the app itself rather than only as a support request.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Data export. The counterweight to a subscription, and the honest way to see
// what sync has actually stored: /api/export reads Postgres, not the device.
// ---------------------------------------------------------------------------

type ExportState = { busy: boolean; error: string | null };

/** Hands the account's whole learning record over as one JSON file.
 *
 * Fetched rather than linked with a plain `<a href download>`, because on the APK
 * /api/export is CROSS-ORIGIN (see apiUrl) and an anchor would send no session
 * cookie, so the download would be a 401 saved to the student's phone. A fetch
 * with API_FETCH_CREDENTIALS is the only form that carries the session on both
 * targets.
 *
 * **Two delivery paths, because the device settled what a typecheck could not.**
 * The anchor-plus-blob dance works in a browser and is silently dropped by the
 * Android WebView: driven on a real phone (OPPO CPH2001, Android 11, WebView
 * Chrome 150) the fetch returned 200 and 16.6 KB, the anchor click dispatched,
 * and nothing was written anywhere on the device - not /sdcard/Download, not the
 * app's own dirs, with no DownloadManager entry in logcat. A minimal blob probe
 * failed the same way, so it is the mechanism and not the payload. That failure
 * mode is the worst kind: the button looked like it worked.
 *
 * So on native the file is written with Filesystem and handed to the system
 * share sheet, which is the right destination on a phone anyway - Drive, Files,
 * or the student's own chat - and which reports its own failure. `Directory.Cache`
 * rather than `Documents`: on Android 10+ the public Documents folder needs
 * legacy external storage, and the share sheet takes a FileProvider URI from the
 * app's own dirs happily. The web path is untouched. */
function useDataExport() {
  const [state, setState] = useState<ExportState>({ busy: false, error: null });

  async function run() {
    setState({ busy: true, error: null });
    // Local date, not `toISOString().slice(0, 10)`. The device pass exported at
    // 03:50 IST and got a file stamped with the PREVIOUS day, because ISO is UTC.
    // The filename is for the student, so it should say the day they are having.
    const now = new Date();
    const stamp = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, "0"),
      String(now.getDate()).padStart(2, "0"),
    ].join("-");
    const name = `flowrecall-export-${stamp}.json`;
    try {
      const response = await fetch(apiUrl("/api/export"), { credentials: API_FETCH_CREDENTIALS });
      if (!response.ok) throw new Error(`export failed: ${response.status}`);

      if (Capacitor.isNativePlatform()) {
        // Read as text, not a Blob: writeFile only accepts Blob data on web.
        const { uri } = await Filesystem.writeFile({
          path: name,
          data: await response.text(),
          directory: Directory.Cache,
          encoding: Encoding.UTF8,
        });
        await Share.share({
          title: "Your FlowRecall data",
          files: [uri],
          dialogTitle: "Save or send your export",
        });
      } else {
        const url = URL.createObjectURL(await response.blob());
        const link = document.createElement("a");
        link.href = url;
        link.download = name;
        document.body.appendChild(link);
        link.click();
        link.remove();
        // Revoked on a timer rather than immediately: some browsers start the
        // download asynchronously and read the blob after click() returns.
        window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
      }
      setState({ busy: false, error: null });
    } catch (error) {
      // Dismissing the share sheet rejects. That is not a failure and must not
      // be reported as one - the file is written either way.
      if (error instanceof Error && /cancel|dismiss/i.test(error.message)) {
        setState({ busy: false, error: null });
        return;
      }
      console.error("export failed", error);
      setState({ busy: false, error: "Could not prepare your export. Please try again." });
    }
  }

  return { ...state, run };
}

type DeleteState = { busy: boolean; error: string | null };

/** Order matters here and is the whole point of the hook.
 *
 * The server is asked first and local data is only destroyed on a 2xx, because
 * the route refuses to delete anything when it cannot cancel a live
 * subscription - wiping the library before hearing that back would take the
 * user's books for a deletion that did not happen. */
function useDeleteAccount() {
  const [state, setState] = useState<DeleteState>({ busy: false, error: null });

  async function run() {
    setState({ busy: true, error: null });
    try {
      const response = await fetch(apiUrl("/api/account"), {
        method: "DELETE",
        credentials: API_FETCH_CREDENTIALS,
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        setState({
          busy: false,
          error: body?.error ?? "We could not delete your account. Please try again.",
        });
        return;
      }

      // Best-effort: the account is already gone server-side, so a failure to
      // clear local storage must not be reported as a failed deletion. Log it
      // and continue to sign-out, which is what the user is waiting for.
      try {
        await deleteAllBooks();
        await deleteAllRecallData();
        clearAllLocalUserData();
      } catch (error) {
        console.error("deleteAccount: local wipe failed after server deletion", error);
      }

      await signOut({ redirectTo: "/" });
    } catch {
      setState({ busy: false, error: "No connection. Your account has not been deleted." });
    }
  }

  return { ...state, run };
}

/** Bottom sheet rather than window.confirm: on Android that renders a system
 * dialog titled with the app's own localhost origin (the same reason the
 * library's delete bar is in-page - see src/app/reader/page.tsx). Typing the
 * account's own address is the gate, so this cannot be cleared by a stray tap
 * on an irreversible action. */
function DeleteAccountSheet({ email, onClose }: { email: string | null; onClose: () => void }) {
  const [typed, setTyped] = useState("");
  const { busy, error, run } = useDeleteAccount();
  const armed = confirmationMatches(typed, email);

  return (
    // z-[60], not z-50: MobileTabBar is `fixed bottom-0 z-50` and renders after
    // this in DOM order, so at an equal z-index the tab bar wins and paints over
    // the sheet's own buttons. Measured on the device - the buttons land at
    // y 704-748 with the tab bar starting at 683, and elementFromPoint on
    // "Keep my account" returned the Ingest tab link. A modal has to outrank the
    // navigation chrome it covers. Invisible on the web, where the bar is sm:hidden.
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60 backdrop-blur-sm">
      <div
        className="w-full max-w-md rounded-t-3xl border-t border-border bg-background px-5 pt-5"
        // Matches MobileTabBar and the library's delete bar: a WebView that is
        // not drawing edge-to-edge reports a 0 inset for the gesture pill, so
        // the constant is what actually keeps the buttons clear of it.
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 1.25rem)" }}
      >
        <h2 className="text-lg font-semibold text-foreground">Delete account?</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          This removes your account, your streak and your saved decks, and erases every book,
          highlight and reading position stored on this device. It cannot be undone.
        </p>

        <label htmlFor="delete-confirm" className="mt-4 block text-xs font-medium text-muted-foreground">
          Type <span className="font-semibold text-foreground">{email ?? "your email"}</span> to confirm
        </label>
        <input
          id="delete-confirm"
          type="email"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          disabled={busy}
          className="mt-1.5 w-full rounded-xl border border-border bg-foreground/[0.04] px-3 py-2.5 text-[15px] text-foreground outline-none focus-visible:border-foreground/30 disabled:opacity-50"
        />

        {error && (
          <p className="mt-3 text-sm text-red-400" role="alert">
            {error}
          </p>
        )}

        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="min-h-11 rounded-full px-4 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
          >
            Keep my account
          </button>
          <button
            type="button"
            disabled={!armed || busy}
            onClick={() => {
              vibrateTap();
              void run();
            }}
            className="min-h-11 rounded-full bg-red-500 px-4 text-sm font-semibold text-white transition-opacity active:scale-[0.97] disabled:opacity-40"
          >
            {busy ? "Deleting..." : "Delete forever"}
          </button>
        </div>
      </div>
    </div>
  );
}

function WebAccountCard() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const dataExport = useDataExport();

  useEffect(() => {
    if (status === "unauthenticated") router.replace("/");
  }, [status, router]);

  if (status !== "authenticated") return null;

  const user = session.user;

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col px-4 py-10 sm:px-6 sm:py-16">
      <h1 className="text-2xl font-semibold tracking-tight">Account</h1>

      <div className="mt-6 flex items-center gap-4 rounded-2xl border-2 border-white/10 bg-white/5 p-5">
        {/* #18181b is intentionally an inline style — Tailwind purges utility
            classes that only appear in a branch the static analyser never
            sees rendered. */}
        <span
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-xl font-bold text-white ring-1 ring-white/10"
          style={{ background: "#18181b" }}
        >
          {(user.name ?? user.email ?? "?").charAt(0).toUpperCase()}
        </span>
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

      <button
        type="button"
        onClick={() => {
          if (!dataExport.busy) void dataExport.run();
        }}
        className="mt-6 self-center text-xs font-medium text-zinc-400 underline underline-offset-2 transition-colors hover:text-zinc-200"
      >
        {dataExport.busy ? "Preparing your export…" : "Download my data"}
      </button>
      {dataExport.error && (
        <p className="mt-2 text-center text-xs text-red-400">{dataExport.error}</p>
      )}

      <button
        type="button"
        onClick={() => setConfirmingDelete(true)}
        className="mt-6 self-center text-xs font-medium text-red-400 underline underline-offset-2 transition-colors hover:text-red-300"
      >
        Delete account
      </button>

      <p className="mt-6 text-center text-xs text-zinc-500">
        <Link href="/privacy" className="underline underline-offset-2 hover:text-zinc-300">
          Privacy Policy
        </Link>
      </p>

      {confirmingDelete && (
        <DeleteAccountSheet email={user.email ?? null} onClose={() => setConfirmingDelete(false)} />
      )}
    </main>
  );
}

// ---------------------------------------------------------------------------
// Native: iOS Settings / Twitter-sidebar-style grouped account screen.
// ---------------------------------------------------------------------------

function ChevronIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true">
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

function DownloadIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-[18px] w-[18px] text-accent" aria-hidden="true">
      <path
        d="M12 4v10m0 0 4-4m-4 4-4-4"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M5 17.5h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
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

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-[18px] w-[18px] text-red-400" aria-hidden="true">
      <path d="M4 7h16M10 4h4a1 1 0 0 1 1 1v2H9V5a1 1 0 0 1 1-1Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6 7l1 12a1.5 1.5 0 0 0 1.5 1.4h7A1.5 1.5 0 0 0 17 19L18 7M10 11v6M14 11v6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
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
      // `on` state is a fixed blue via inline style, not `bg-accent` -
      // `--accent` resolves to white in dark mode, which made the track
      // invisible against the black surface behind it.
      // `off` state uses `bg-foreground/15`, not `bg-white/15` - `foreground`
      // flips to near-black in light mode, so the track stays visible against
      // the near-white background instead of vanishing into it.
      className={`relative h-[30px] w-[50px] shrink-0 rounded-full transition-colors duration-200 ${
        on ? "" : "bg-foreground/15"
      }`}
      style={{ background: on ? "#3b82f6" : undefined }}
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
    <div className="overflow-hidden rounded-2xl border border-border bg-surface/70 [&>*:not(:last-child)]:border-b [&>*:not(:last-child)]:border-border/60">
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
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] bg-foreground/[0.06]">
        {icon}
      </span>
      <span className={`flex-1 text-[15px] font-medium ${destructive ? "text-red-400" : "text-foreground"}`}>
        {label}
      </span>
      {trailing ?? (href && <ChevronIcon />)}
    </>
  );

  const className =
    "flex w-full items-center gap-3 px-4 py-3.5 text-left outline-none transition-colors active:bg-foreground/[0.06] focus-visible:bg-foreground/[0.06]";

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
        <div className="h-20 w-20 animate-pulse rounded-full bg-foreground/10" />
        <div className="h-4 w-32 animate-pulse rounded-full bg-foreground/10" />
        <div className="h-3 w-44 animate-pulse rounded-full bg-foreground/[0.06]" />
      </div>
      <div className="mt-6 h-16 animate-pulse rounded-2xl bg-foreground/[0.06]" />
      <div className="mt-6 h-40 animate-pulse rounded-2xl bg-foreground/[0.06]" />
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
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Welcome to FlowRecall</h1>
        <p className="mx-auto mt-2 max-w-[22rem] text-sm text-muted-foreground">
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
        className="mt-2 flex w-full max-w-xs items-center justify-center gap-3 rounded-full border border-border bg-foreground/[0.03] px-6 py-3.5 text-sm font-medium text-foreground transition-all duration-200 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
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
          className="text-sm text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
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
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const dataExport = useDataExport();

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
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Account</h1>

        <Reveal index={0}>
          <div className="mt-6 flex flex-col items-center gap-3 text-center">
            {/* #18181b is intentionally an inline style — Tailwind purges utility
                classes that only appear in a branch the static analyser never
                sees rendered. */}
            <span
              className="flex h-20 w-20 items-center justify-center rounded-full text-2xl font-bold text-white ring-1 ring-border"
              style={{ background: "#18181b" }}
            >
              {(user.name ?? user.email ?? "?").charAt(0).toUpperCase()}
            </span>
            <div>
              <p className="text-lg font-semibold text-foreground">{user.name ?? "Student"}</p>
              <p className="text-sm text-muted-foreground">{user.email}</p>
            </div>
          </div>
        </Reveal>

        {/* Status row - plan + streak side by side, the two things worth
            glancing at every time this screen opens. */}
        <Reveal index={1}>
          <div className="mt-6 grid grid-cols-2 gap-3">
            <div className="rounded-2xl border border-border bg-surface/70 px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Plan</p>
              <p className={`mt-0.5 text-lg font-bold ${isPro ? "text-accent" : "text-foreground"}`}>
                {isPro ? "Pro" : "Free"}
              </p>
            </div>
            <div className="rounded-2xl border border-border bg-surface/70 px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Streak</p>
              <p className="mt-0.5 text-lg font-bold tabular-nums text-foreground">
                {streak} {streak === 1 ? "day" : "days"}
              </p>
            </div>
          </div>
        </Reveal>

        <Reveal index={2}>
          <p className="mt-8 mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Account
          </p>
          <SettingsGroup>
            <SettingsRow icon={<CreditCardIcon />} label="Manage Subscription" href="/pricing" />
            <SettingsRow
              icon={<DownloadIcon />}
              label={dataExport.busy ? "Preparing your export…" : "Download My Data"}
              onClick={() => {
                vibrateTap();
                if (!dataExport.busy) void dataExport.run();
              }}
            />
          </SettingsGroup>
          {dataExport.error && <p className="mt-2 px-1 text-xs text-red-400">{dataExport.error}</p>}
        </Reveal>

        <Reveal index={3}>
          <p className="mt-6 mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
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

        <Reveal index={5}>
          <p className="mt-6 mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Danger Zone
          </p>
          <SettingsGroup>
            <SettingsRow
              icon={<TrashIcon />}
              label="Delete Account"
              destructive
              onClick={() => {
                vibrateTap();
                setConfirmingDelete(true);
              }}
            />
          </SettingsGroup>
        </Reveal>

        <p className="mt-8 text-center text-xs text-muted-foreground">
          <Link href="/privacy" className="underline underline-offset-2 hover:text-foreground">
            Privacy Policy
          </Link>
        </p>
        {APP_VERSION && (
          <p className="mt-1 text-center text-xs text-muted-foreground">FlowRecall v{APP_VERSION}</p>
        )}

        {confirmingDelete && (
          <DeleteAccountSheet
            email={user.email ?? null}
            onClose={() => setConfirmingDelete(false)}
          />
        )}
      </main>
    </PullToRefresh>
  );
}
