"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { useSession } from "next-auth/react";
import { Capacitor } from "@capacitor/core";
import { useIsNative } from "@/lib/useIsNative";
import { vibrateTap } from "@/lib/haptics";

// The mobile-only primary navigation. On sm: and up this is fully hidden and
// the links live inline in <Navbar />; below sm: they move here, into the
// thumb zone, so the top bar can breathe (just branding + streak + avatar).
//
// PERFORMANCE CONTRACT (matches StreakCounter): the sliding pill animates
// transform/opacity ONLY. backdrop-blur is static — never animated.

type Tab = {
  href: string;
  label: string;
  Icon: (props: { className?: string }) => React.ReactElement;
};

function HomeIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="M3 10.75 12 4l9 6.75" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5.5 9.5V19a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V9.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IngestIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="M12 15V4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="m8 7.5 4-4 4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4.5 14v4.5a1 1 0 0 0 1 1h13a1 1 0 0 0 1-1V14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ReaderIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="M12 6.5c-1.6-1.2-3.7-1.8-5.8-1.8-.7 0-1.2.5-1.2 1.2v11.6c0 .7.5 1.2 1.2 1.2 2.1 0 4.2.6 5.8 1.8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12 6.5c1.6-1.2 3.7-1.8 5.8-1.8.7 0 1.2.5 1.2 1.2v11.6c0 .7-.5 1.2-1.2 1.2-2.1 0-4.2.6-5.8 1.8V6.5Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PricingIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="M12 3.5c.4 2.9 1.9 4.4 4.8 4.8-2.9.4-4.4 1.9-4.8 4.8-.4-2.9-1.9-4.4-4.8-4.8 2.9-.4 4.4-1.9 4.8-4.8Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M18.5 14.5c.2 1.5 1 2.3 2.5 2.5-1.5.2-2.3 1-2.5 2.5-.2-1.5-1-2.3-2.5-2.5 1.5-.2 2.3-1 2.5-2.5Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

function AccountIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <circle cx="12" cy="8.5" r="3.25" stroke="currentColor" strokeWidth="2" />
      <path d="M4.5 19.5c1.4-3.4 4.3-5.2 7.5-5.2s6.1 1.8 7.5 5.2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

const TABS: Tab[] = [
  { href: "/", label: "Home", Icon: HomeIcon },
  { href: "/ingest", label: "Ingest", Icon: IngestIcon },
  { href: "/reader", label: "Reader", Icon: ReaderIcon },
  { href: "/pricing", label: "Pricing", Icon: PricingIcon },
];

const ACCOUNT_TAB: Tab = { href: "/account", label: "Account", Icon: AccountIcon };

type RippleSpot = { id: number; x: number; y: number };

// One-shot expanding ring, positioned at the actual tap point rather than
// dead-center - transform (scale/translate) + opacity only, so it's free on
// the compositor and never trips the perf contract below.
function Ripple({ x, y }: { x: number; y: number }) {
  return (
    <motion.span
      className="pointer-events-none absolute h-3 w-3 rounded-full bg-white/40"
      style={{ left: x, top: y, translateX: "-50%", translateY: "-50%" }}
      initial={{ scale: 0, opacity: 0.6 }}
      animate={{ scale: 8, opacity: 0 }}
      transition={{ duration: 0.5, ease: "easeOut" }}
    />
  );
}

// PERFORMANCE CONTRACT (matches StreakCounter): the ripple animates
// transform (scale) + opacity ONLY - never width/height/filter, which would
// force a paint every frame on low-end Android.
function TabLink({
  href,
  label,
  Icon,
  active,
  showStreakBadge,
  streak,
}: {
  href: string;
  label: string;
  Icon: Tab["Icon"];
  active: boolean;
  showStreakBadge: boolean;
  streak: number;
}) {
  const [ripples, setRipples] = useState<RippleSpot[]>([]);
  const rippleId = useRef(0);

  function spawnRipple(e: React.PointerEvent<HTMLAnchorElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const id = rippleId.current++;
    setRipples((prev) => [...prev, { id, x: e.clientX - rect.left, y: e.clientY - rect.top }]);
    window.setTimeout(() => {
      setRipples((prev) => prev.filter((r) => r.id !== id));
    }, 500);
  }

  return (
    <Link
      href={href}
      onClick={vibrateTap}
      onPointerDown={spawnRipple}
      aria-current={active ? "page" : undefined}
      className="relative flex min-h-[44px] flex-1 basis-0 flex-col items-center justify-center gap-1 overflow-hidden rounded-full px-1 py-2 outline-none transition-transform active:scale-95 focus-visible:ring-2 focus-visible:ring-accent/60"
    >
      {active && (
        <motion.span
          layoutId="mobile-tab-pill"
          className="absolute inset-0 rounded-full bg-white/10"
          transition={{ type: "spring", stiffness: 400, damping: 30 }}
        />
      )}
      <AnimatePresence>
        {ripples.map((r) => (
          <Ripple key={r.id} x={r.x} y={r.y} />
        ))}
      </AnimatePresence>
      <span className="relative z-10">
        <Icon
          className={`h-[21px] w-[21px] transition-colors ${
            active ? "text-white" : "text-zinc-500"
          }`}
        />
        {showStreakBadge && (
          <span className="absolute -right-2 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full border border-white/10 bg-accent px-1 text-[9px] font-bold tabular-nums text-white">
            {streak}
          </span>
        )}
      </span>
      <span
        className={`relative z-10 truncate text-[10px] font-medium leading-none transition-colors ${
          active ? "text-white" : "text-zinc-500"
        }`}
      >
        {label}
      </span>
    </Link>
  );
}

export default function MobileTabBar() {
  const pathname = usePathname();
  const { data: session, status } = useSession();
  const streak = session?.user?.currentStreak ?? 0;
  const isNative = useIsNative();

  const navRef = useRef<HTMLElement>(null);

  // Publishes the bar's real rendered height (padding + safe-area) as
  // --tabbar-h on <html>, so PageTransition's native scroll container (and
  // this file's own spacer, below) can reserve exactly the right amount of
  // space - not a guessed magic number - even as OS text-size scaling
  // changes label height, or the design here changes later.
  useEffect(() => {
    const el = navRef.current;
    if (!el) return;
    const root = document.documentElement;
    const publish = () => root.style.setProperty("--tabbar-h", `${el.offsetHeight}px`);
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Match Navbar: the study feed and reader are full-bleed and immersive —
  // no chrome. The reader draws its own back-to-home link and in-book back button.
  if (pathname?.startsWith("/study") || pathname?.startsWith("/reader")) return null;

  // Navbar (the only other place streak/account lived) is hidden entirely on
  // native, so this is the sole entry point there - add a 5th tab for it.
  const tabs = isNative ? [...TABS, ACCOUNT_TAB] : TABS;

  const isActive = (href: string) =>
    href === "/"
      ? pathname === "/"
      : pathname === href || (pathname?.startsWith(href + "/") ?? false);

  return (
    <>
      {/* In-flow spacer so scrollable content clears the floating bar. It shares
          this component's render conditions, so it vanishes on /study and sm:+. */}
      <div
        aria-hidden="true"
        className="sm:hidden"
        style={{ height: "calc(var(--tabbar-h, 5.5rem) + env(safe-area-inset-bottom) + 1rem)" }}
      />

      <nav
        ref={navRef}
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-50 flex justify-center px-3 sm:hidden"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 1rem)" }}
      >
        {/* w-full + each tab as flex-1 (not a fixed min-width) is load-bearing:
            at 5 tabs, fixed 76px-min-width pills need ~410px and overflow
            every real phone viewport, shoving the outer tabs off-screen -
            that's what made "Account" look dead. Equal flex-1 shares always
            fit, and max-w keeps them from stretching absurdly wide on tablets. */}
        <div className="flex w-full max-w-[420px] items-center gap-0.5 rounded-full border border-white/10 bg-surface/70 px-1.5 py-2 backdrop-blur-xl shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_8px_32px_-8px_rgba(0,0,0,0.7)]">
          {tabs.map(({ href, label, Icon }) => (
            <TabLink
              key={href}
              href={href}
              label={label}
              Icon={Icon}
              active={isActive(href)}
              showStreakBadge={href === "/account" && status === "authenticated" && streak > 0}
              streak={streak}
            />
          ))}
        </div>
      </nav>
    </>
  );
}
