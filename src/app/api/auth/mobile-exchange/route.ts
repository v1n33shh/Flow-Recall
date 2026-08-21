import { NextResponse } from "next/server";
import { decode, encode } from "next-auth/jwt";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { MOBILE_BRIDGE_MAX_AGE_SECONDS, MOBILE_BRIDGE_SALT, type MobileBridgePayload } from "@/lib/mobileAuth";

const bodySchema = z.object({ token: z.string().min(1) });

// Matches @auth/core's own default cookie naming (see
// node_modules/@auth/core/lib/utils/cookie.js, defaultCookies) and its
// session-token salt convention (salt = cookie name, see
// node_modules/@auth/core/lib/actions/session.js).
const USE_SECURE_COOKIES = process.env.NODE_ENV === "production";
const SESSION_COOKIE_NAME = `${USE_SECURE_COOKIES ? "__Secure-" : ""}authjs.session-token`;
const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60; // Auth.js's default session maxAge

// Called by the app (via CapacitorHttp, so its native cookie jar captures the
// Set-Cookie below) once the appUrlOpen deep-link listener catches the
// mobile-callback redirect - see src/lib/mobileAuth.ts for the full flow.
export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const secret = process.env.AUTH_SECRET!;
  const bridgePayload = await decode<MobileBridgePayload>({
    token: parsed.data.token,
    secret,
    salt: MOBILE_BRIDGE_SALT,
  }).catch(() => null);

  if (!bridgePayload?.id || !bridgePayload.jti) {
    return NextResponse.json(
      { error: "Sign-in link expired. Please try again." },
      { status: 401 },
    );
  }

  // Single-use enforcement: the jti unique constraint means only the first
  // exchange of a given bridge token can ever succeed here - a captured or
  // replayed token (the deep link isn't a verified Android App Link, so a
  // malicious app could in principle receive it via the OS's disambiguation
  // chooser) gets rejected instead of silently minting a second session for
  // it. See UsedMobileBridgeToken's schema comment for the full threat model.
  try {
    await prisma.usedMobileBridgeToken.create({
      data: {
        jti: bridgePayload.jti,
        expiresAt: new Date(Date.now() + MOBILE_BRIDGE_MAX_AGE_SECONDS * 1000),
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json(
        { error: "This sign-in link has already been used. Please try again." },
        { status: 401 },
      );
    }
    console.error("[mobile-exchange] failed to record bridge token as used:", error);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }

  // Best-effort, fire-and-forget: keeps the table from growing forever
  // without adding latency to this response. Never blocks or fails the
  // exchange - a missed sweep just means it's cleaned up on a later request.
  void prisma.usedMobileBridgeToken
    .deleteMany({ where: { expiresAt: { lt: new Date() } } })
    .catch((error) => console.error("[mobile-exchange] stale bridge token cleanup failed:", error));

  const sessionToken = await encode({
    secret,
    salt: SESSION_COOKIE_NAME,
    maxAge: SESSION_MAX_AGE_SECONDS,
    token: {
      id: bridgePayload.id,
      name: bridgePayload.name,
      email: bridgePayload.email,
      picture: bridgePayload.picture,
      plan: bridgePayload.plan,
      currentStreak: bridgePayload.currentStreak,
    },
  });

  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE_NAME, sessionToken, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: USE_SECURE_COOKIES,
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  return response;
}
