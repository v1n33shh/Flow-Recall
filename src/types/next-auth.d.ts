import type { DefaultSession } from "next-auth";

// Surfaces the fields we stash on the token/session in src/auth.ts so both
// server-side `auth()` and client-side `useSession()` see them as typed.
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      // Subscription tier - "FREE" | "PRO". Kept as string to mirror the
      // Prisma column (a plain String with a "FREE" default), not an enum.
      plan: string;
      // Consecutive-day study streak, surfaced for the navbar flame counter.
      currentStreak: number;
    } & DefaultSession["user"];
  }

  interface User {
    plan?: string;
    currentStreak?: number;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    plan?: string;
    currentStreak?: number;
  }
}
