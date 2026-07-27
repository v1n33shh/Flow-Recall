import { NextResponse } from "next/server";
import { decode, encode } from "next-auth/jwt";
import { z } from "zod";
import { MOBILE_BRIDGE_SALT, type MobileBridgePayload } from "@/lib/mobileAuth";

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

  if (!bridgePayload?.id) {
    return NextResponse.json(
      { error: "Sign-in link expired. Please try again." },
      { status: 401 },
    );
  }

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
