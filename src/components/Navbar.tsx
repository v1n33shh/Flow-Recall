"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "motion/react";
import { useSession } from "next-auth/react";
import StreakCounter from "@/components/StreakCounter";

const LINKS = [
  { href: "/ingest", label: "Ingest" },
  { href: "/pricing", label: "Pricing" },
];

export default function Navbar() {
  const pathname = usePathname();
  const { data: session, status } = useSession();
  const streak = session?.user?.currentStreak ?? 0;

  // The study feed is meant to be full-bleed and immersive, like the
  // TikTok-style apps it's modeled on - no persistent chrome on top of it.
  if (pathname?.startsWith("/study")) return null;

  return (
    <header
      className="sticky top-4 z-20 flex justify-center px-4 sm:top-6"
      style={{ marginTop: "env(safe-area-inset-top)" }}
    >
      <nav className="flex w-full max-w-2xl items-center justify-between gap-2 rounded-full border border-white/10 bg-graphite px-3 py-2.5 sm:gap-3 sm:px-5">
        <Link
          href="/"
          className="font-retro shrink-0 text-xl text-gold sm:text-3xl"
        >
          FlowRecall
        </Link>
        <div className="flex items-center gap-1">
          {LINKS.map((link) => {
            const active = pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                className="relative rounded-full px-2.5 py-1.5 text-sm font-medium sm:px-4 sm:py-2"
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
          {status === "authenticated" && <StreakCounter streak={streak} />}
          {status === "authenticated" ? (
            <Link
              href="/account"
              className="flex shrink-0 items-center gap-1.5 rounded-full py-1 pl-1 pr-2.5 text-sm font-medium text-zinc-400 transition-colors hover:text-zinc-300 sm:pr-3"
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
                <span className="flex h-[22px] w-[22px] items-center justify-center rounded-full bg-gold text-[10px] font-bold text-matte">
                  {(session.user?.name ?? session.user?.email ?? "?").charAt(0).toUpperCase()}
                </span>
              )}
              <span className="hidden sm:inline">Account</span>
            </Link>
          ) : (
            status !== "loading" && (
              <Link
                href="/login"
                className="shrink-0 rounded-full bg-gold px-3 py-1.5 text-sm font-medium text-matte transition-colors hover:bg-gold/90 active:scale-[0.97]"
              >
                Sign In
              </Link>
            )
          )}
        </div>
      </nav>
    </header>
  );
}
