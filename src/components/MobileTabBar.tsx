"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "motion/react";

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

function PricingIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="M12 3.5c.4 2.9 1.9 4.4 4.8 4.8-2.9.4-4.4 1.9-4.8 4.8-.4-2.9-1.9-4.4-4.8-4.8 2.9-.4 4.4-1.9 4.8-4.8Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M18.5 14.5c.2 1.5 1 2.3 2.5 2.5-1.5.2-2.3 1-2.5 2.5-.2-1.5-1-2.3-2.5-2.5 1.5-.2 2.3-1 2.5-2.5Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

const TABS: Tab[] = [
  { href: "/", label: "Home", Icon: HomeIcon },
  { href: "/ingest", label: "Ingest", Icon: IngestIcon },
  { href: "/pricing", label: "Pricing", Icon: PricingIcon },
];

export default function MobileTabBar() {
  const pathname = usePathname();

  // Match Navbar: the study feed is full-bleed and immersive — no chrome.
  if (pathname?.startsWith("/study")) return null;

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
        style={{ height: "calc(env(safe-area-inset-bottom) + 6rem)" }}
      />

      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-30 flex justify-center px-4 sm:hidden"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 1rem)" }}
      >
        <div className="flex items-center gap-1 rounded-full border border-white/10 bg-surface/70 px-2 py-2 backdrop-blur-xl shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_8px_32px_-8px_rgba(0,0,0,0.7)]">
          {TABS.map(({ href, label, Icon }) => {
            const active = isActive(href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className="relative flex min-w-[76px] flex-col items-center justify-center gap-1 rounded-full px-4 py-2 outline-none transition-transform active:scale-95 focus-visible:ring-2 focus-visible:ring-accent/60"
              >
                {active && (
                  <motion.span
                    layoutId="mobile-tab-pill"
                    className="absolute inset-0 rounded-full bg-white/10"
                    transition={{ type: "spring", stiffness: 400, damping: 30 }}
                  />
                )}
                <Icon
                  className={`relative z-10 h-[22px] w-[22px] transition-colors ${
                    active ? "text-white" : "text-zinc-500"
                  }`}
                />
                <span
                  className={`relative z-10 text-[10px] font-medium leading-none transition-colors ${
                    active ? "text-white" : "text-zinc-500"
                  }`}
                >
                  {label}
                </span>
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}
