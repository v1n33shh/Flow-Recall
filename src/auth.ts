import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  // Credentials sign-in only works with JWT sessions - it never touches the
  // adapter (no OAuth account to link), so there's nothing for a database
  // session to persist. See node_modules/@auth/core/lib/utils/assert.js.
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const parsed = credentialsSchema.safeParse(credentials);
        if (!parsed.success) return null;

        const user = await prisma.user.findUnique({
          where: { email: parsed.data.email },
        });
        // No password means this account was never set up for credentials
        // login (or doesn't exist) - treat both the same way.
        if (!user?.password) return null;

        const passwordMatches = await bcrypt.compare(parsed.data.password, user.password);
        if (!passwordMatches) return null;

        // Deliberately don't return the full row - the hash should never
        // flow into the JWT or session, even indirectly.
        return {
          id: user.id,
          name: user.name,
          email: user.email,
          image: user.image,
          plan: user.plan,
          currentStreak: user.currentStreak,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user, trigger, session }) {
      if (user) {
        token.id = user.id;
        // Seeds the plan into the token at sign-in for cheap client-side UI
        // gating. The API route re-reads plan from the DB on every request, so
        // this staying stale after an upgrade can't grant unauthorized access.
        token.plan = user.plan ?? "FREE";
        token.currentStreak = user.currentStreak ?? 0;
      }
      // The study feed calls useSession().update({ currentStreak }) after a
      // completed session so the navbar flame reflects the new streak without
      // forcing a re-login. Merge that value into the token here.
      if (trigger === "update" && session && typeof session === "object") {
        const next = session as { currentStreak?: number };
        if (typeof next.currentStreak === "number") {
          token.currentStreak = next.currentStreak;
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        if (token.id) session.user.id = token.id as string;
        session.user.plan = (token.plan as string | undefined) ?? "FREE";
        session.user.currentStreak = (token.currentStreak as number | undefined) ?? 0;
      }
      return session;
    },
  },
});
