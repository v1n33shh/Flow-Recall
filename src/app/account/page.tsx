"use client";

import { useEffect } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import SignOutButton from "@/components/SignOutButton";

// Was a Server Component reading `auth()` + `prisma.user.findUnique` directly.
// That doesn't run in the Capacitor static export (no server behind the
// shell), so it's client-rendered from the session instead - the JWT already
// carries name/email/image/plan (see src/auth.ts), so no extra API call is
// needed.
export default function AccountPage() {
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
