"use client";

import { signOut } from "next-auth/react";

// Deliberately the client signOut() here, not the server-action version from
// "@/auth" - the server action's redirect() is a soft client-side transition
// that never reaches SessionProvider's broadcast/refetch logic, so the rest
// of the app (e.g. the Navbar) keeps showing the stale "signed in" state.
// The client signOut() does a hard reload and broadcasts to all tabs.
export default function SignOutButton() {
  return (
    <button
      type="button"
      onClick={() => signOut({ redirectTo: "/" })}
      className="w-full rounded-full border border-white/15 bg-white/[0.03] px-4 py-3 text-sm font-medium text-zinc-200 transition-colors hover:border-white/25 hover:bg-white/[0.06]"
    >
      Sign out
    </button>
  );
}
