"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "motion/react";
import { useSession } from "next-auth/react";
import StreakCounter from "@/components/StreakCounter";
import StreakModal from "@/components/StreakModal";

const LINKS = [
  { href: "/ingest", label: "Ingest" },
  { href: "/pricing", label: "Pricing" },
];

export default function Navbar() {
  const pathname = usePathname();
  const { data: session, status } = useSession();
  const streak = session?.user?.currentStreak ?? 0;
  const [streakOpen, setStreakOpen] = useState(false);

  // The study feed is meant to be full-bleed and immersive, like the
  // TikTok-style apps it's modeled on - no persistent chrome on top of it.
  if (pathname?.startsWith("/study")) return null;

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
      <nav className="flex w-full max-w-2xl items-center justify-between gap-2 rounded-full border border-white/10 bg-surface px-3 py-2.5 sm:gap-3 sm:px-5">
        <Link
          href="/"
          className="group flex shrink-0 items-center gap-1.5 sm:gap-3"
        >
          {/* Custom SVG Logo: Elegant Flowing 'F' */}
          <div className="relative flex h-8 w-8 items-center justify-center overflow-hidden rounded-[10px] border border-white/10 bg-gradient-to-br from-zinc-800 to-zinc-950 shadow-[inset_0_1px_0_rgba(255,255,255,0.1),0_2px_8px_-2px_rgba(0,0,0,0.5)] sm:h-[38px] sm:w-[38px] transition-transform duration-300 group-hover:scale-105 group-active:scale-95">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              className="h-5 w-5 sm:h-6 sm:w-6"
            >
              <path
                d="M8 20V9a5 5 0 0 1 5-5h5"
                stroke="url(#grad-f)"
                strokeWidth="3.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M8 12h5"
                stroke="#F1F5F9"
                strokeWidth="3.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <defs>
                <linearGradient
                  id="grad-f"
                  x1="8"
                  y1="4"
                  x2="18"
                  y2="20"
                  gradientUnits="userSpaceOnUse"
                >
                  <stop stopColor="#3B82F6" />
                  <stop offset="1" stopColor="#93C5FD" />
                </linearGradient>
              </defs>
            </svg>
            <div className="absolute inset-0 rounded-[10px] ring-1 ring-inset ring-white/5 pointer-events-none" />
          </div>
          <span className="font-retro text-lg text-white transition-colors group-hover:text-zinc-200 sm:text-2xl mt-0.5 sm:mt-1">
            FlowRecall
          </span>
        </Link>
        <div className="flex shrink-0 items-center gap-0.5 sm:gap-1">
          {LINKS.map((link) => {
            const active = pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                className="relative rounded-full px-1.5 py-1 text-xs font-medium sm:text-sm sm:px-4 sm:py-2"
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
          {status === "authenticated" && (
            <StreakCounter streak={streak} onClick={() => setStreakOpen(true)} />
          )}
          {status === "authenticated" ? (
            <Link
              href="/account"
              className="flex shrink-0 items-center gap-1.5 rounded-full p-1 text-sm font-medium text-zinc-400 transition-colors hover:text-zinc-300 sm:py-1 sm:pl-1 sm:pr-3"
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
                <span className="flex h-[22px] w-[22px] items-center justify-center rounded-full bg-accent text-[10px] font-bold text-white">
                  {(session.user?.name ?? session.user?.email ?? "?").charAt(0).toUpperCase()}
                </span>
              )}
              <span className="hidden sm:inline">Account</span>
            </Link>
          ) : (
            status !== "loading" && (
              <Link
                href="/login"
                className="shrink-0 rounded-full bg-gradient-to-b from-blue-500 to-blue-600 ring-1 ring-inset ring-blue-400/40 shadow-[inset_0_1px_0_rgba(255,255,255,0.15),0_8px_24px_-6px_rgba(37,99,235,0.55)] px-2.5 py-1 text-xs sm:px-3 sm:py-1.5 sm:text-sm font-medium text-white transition-all duration-200 hover:from-blue-400 hover:to-blue-500 active:scale-[0.97]"
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
