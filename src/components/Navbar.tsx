"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "motion/react";
import { useSession } from "next-auth/react";
import { useIsNative } from "@/lib/useIsNative";
import LogoMark from "@/components/LogoMark";
import StreakCounter from "@/components/StreakCounter";
import StreakModal from "@/components/StreakModal";

/** THE FOCUS RING, and it is quoted from this repo rather than invented.
 *
 * `outline-none focus-visible:ring-2 focus-visible:ring-accent/60` is byte-identical to
 * MobileTabBar.tsx, StreakCounter.tsx and DeckTitle.tsx - which matters twice over here:
 * MobileTabBar is this bar's phone counterpart (same job, same chrome, other breakpoint),
 * and StreakCounter renders INSIDE this bar. So until now the one control in the nav that
 * answered the keyboard was a child component that brought its own ring, while the five
 * section links, the brand and the account link beside it fell through to the UA default -
 * a 1px `auto` outline that computes to rgb(16,16,16) on a #050505 page, which is to say
 * invisible. A keyboard user could tab the whole bar and never see where they were.
 *
 * WHY ACCENT AND NOT THE MARKETING PAGE'S NEON. globals.css's header names focus states
 * outright as one of the three things contrast alone is the tool for ("contrast itself is
 * the only tool used to signal primary actions, focus states, and intent"). The acid lime
 * belongs to the Midnight Gallery palette, which is scoped to one page; this bar renders on
 * every route including the library and pricing, and a neon here would be the token leak
 * midnightGallery.ts's own docblock forbids. --accent is white in dark mode and near-black
 * in light, so this ring inverts correctly with the theme, which a hue would not.
 *
 * ON `ring` RATHER THAN `outline`. Tailwind's ring is a box-shadow, so it follows the
 * element's radius and costs no layout - and it is what the three call sites above already
 * use. src/app/page.tsx's marketing surfaces use an `outline` instead (see globals.css's
 * `.mg-page :focus-visible`) because thirty links, summaries and buttons there would
 * otherwise each need the utility repeated; both resolve to the same 2px accent edge.
 */
const RING = "outline-none focus-visible:ring-2 focus-visible:ring-accent/60";

const LINKS = [
  { href: "/library", label: "Library" },
  { href: "/ingest", label: "Ingest" },
  { href: "/reader", label: "Reader" },
  { href: "/map", label: "Mindmap" },
  // Kept here and dropped from MobileTabBar, deliberately: this bar is web-only
  // (Navbar returns null on native), and the web is the only place a purchase can
  // actually happen.
  { href: "/pricing", label: "Pricing" },
];

export default function Navbar() {
  const pathname = usePathname();
  const { data: session, status } = useSession();
  const streak = session?.user?.currentStreak ?? 0;
  const [streakOpen, setStreakOpen] = useState(false);
  // Computed post-mount (not during SSR/export) to avoid a hydration
  // mismatch between the server-rendered shell and the native runtime.
  const isNative = useIsNative();

  // The study feed and the reader are both meant to be full-bleed and
  // immersive - no persistent chrome on top of them. The reader draws its
  // own minimal back-to-home link and in-book back button instead.
  if (pathname?.startsWith("/study") || pathname?.startsWith("/reader")) return null;

  // The native app uses MobileTabBar as its only chrome (its Account tab
  // covers streak/profile access) - this desktop-styled top bar would just
  // read as "website in a box" on top of it.
  if (isNative) return null;

  return (
    <>
      <StreakModal
        open={streakOpen}
        onClose={() => setStreakOpen(false)}
        fallbackStreak={streak}
      />
      <header
        className="sticky top-4 z-20 flex justify-center px-4 sm:top-6"
      style={{ marginTop: "env(safe-area-inset-top)" }}
    >
      {/* GLASS, not `bg-surface`. This was the one opaque bar left on a site whose every
          other surface is a frosted pane. Same recipe the app shell uses (src/lib/spatial.ts),
          so the website and the APK are made of the same material. */}
      <nav className="flex w-full max-w-2xl items-center justify-between gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.09)] backdrop-blur-2xl sm:gap-3 sm:px-5">
        <Link
          href="/"
          className={`group flex shrink-0 items-center gap-1.5 sm:gap-3 ${RING} rounded-full`}
        >
          {/* Brand mark: monochrome "Flag Mark" F on its own fixed-dark chip,
              independent of site theme - same treatment as the app icon.
              Percentage radius (not a fixed px value) so the squircle stays
              proportional across the mobile/desktop size breakpoint. */}
          <div className="relative flex h-8 w-8 items-center justify-center overflow-hidden rounded-[28%] bg-gradient-to-br from-zinc-800 to-zinc-950 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] sm:h-[38px] sm:w-[38px] transition-transform duration-300 group-hover:scale-105 group-active:scale-95">
            <LogoMark sheen className="h-[64%] w-[64%]" />
            <div className="absolute inset-0 rounded-[28%] ring-1 ring-inset ring-white/10 pointer-events-none" />
          </div>
          <span className="font-sans text-[17px] font-semibold tracking-[-0.02em] text-white transition-colors group-hover:text-white/80 sm:text-lg">
            FlowRecall
          </span>
        </Link>
        <div className="flex shrink-0 items-center gap-0.5 sm:gap-1">
          {/* Secondary nav moves to the glass Bottom Tab Bar on mobile; these
              inline links only appear from sm: upward. */}
          <div className="hidden items-center gap-0.5 sm:flex sm:gap-1">
          {LINKS.map((link) => {
            const active =
              pathname === link.href || (pathname?.startsWith(link.href + "/") ?? false);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`relative rounded-full px-1.5 py-1 text-xs font-medium sm:text-sm sm:px-4 sm:py-2 ${RING}`}
              >
                {active && (
                  <motion.span
                    layoutId="navbar-active-pill"
                    className="absolute inset-0 rounded-full bg-white/10"
                    transition={{ type: "spring", stiffness: 400, damping: 30 }}
                  />
                )}
                <span
                  className={`relative z-10 transition-colors ${
                    active ? "text-zinc-300" : "text-zinc-400 hover:text-zinc-300 active:text-zinc-300"
                  }`}
                >
                  {link.label}
                </span>
              </Link>
            );
          })}
          </div>
          {/* Streak is now ALWAYS visible (was `hidden sm:block`) — the whole
              point of the mobile refactor: keep the retention hook on screen. */}
          {status === "authenticated" && (
            <StreakCounter streak={streak} onClick={() => setStreakOpen(true)} />
          )}
          {status === "authenticated" ? (
            <Link
              href="/account"
              className={`flex shrink-0 items-center gap-1.5 rounded-full p-1 text-sm font-medium text-zinc-400 transition-colors hover:text-zinc-300 sm:py-1 sm:pl-1 sm:pr-3 ${RING}`}
            >
              {session.user?.image ? (
                <Image
                  src={session.user.image}
                  alt=""
                  width={22}
                  height={22}
                  className="rounded-full"
                />
              ) : (
                <span className="flex h-[22px] w-[22px] items-center justify-center rounded-full border border-white/20 bg-white/10 text-[10px] font-bold text-white">
                  {(session.user?.name ?? session.user?.email ?? "?").charAt(0).toUpperCase()}
                </span>
              )}
              <span className="hidden sm:inline">Account</span>
            </Link>
          ) : (
            status !== "loading" && (
              /* THE ONE CONTROL IN THIS BAR THAT DOES NOT TAKE `RING`, and it is not a
                 preference. This button already carries `ring-1 ring-inset ring-accent/30`
                 at rest, and `ring-inset` sets --tw-ring-inset for the element - which the
                 focus ring then inherits. The result was a 2px accent ring painted INSIDE
                 a pill that is filled with the accent, i.e. white on white, plus the
                 offset ring drawn as a dark band inside its own edge. Measured, not
                 guessed: the focused button reported `rgb(15,15,15) 0 0 0 2px inset`.

                 An outline cannot be inset, so it is the right tool here rather than a
                 workaround: 2px of accent at 2px offset lands on the nav's own surface
                 just outside the pill, which is the only place a ring on a white fill can
                 be seen at all. Same colour, same width, same offset as everything else. */
              <Link
                href="/login"
                // The glass CONTROL recipe (10% fill / 20% edge) against the bar's own
                // 5%/10%. On a surface with no accent colour, a primary action is the same
                // material holding more light - that ratio is the entire hierarchy.
                className="shrink-0 rounded-full border border-white/20 bg-white/10 px-2.5 py-1 text-xs font-medium text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.16)] backdrop-blur-2xl transition-all duration-300 ease-out hover:bg-white/[0.16] active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/70 sm:px-3 sm:py-1.5 sm:text-sm"
              >
                Sign In
              </Link>
            )
          )}
        </div>
      </nav>
      </header>
    </>
  );
}
