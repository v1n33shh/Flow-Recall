import { NextResponse } from "next/server";
import { encode } from "next-auth/jwt";
import { auth } from "@/auth";
import {
  MOBILE_AUTH_CALLBACK_URL,
  MOBILE_BRIDGE_MAX_AGE_SECONDS,
  MOBILE_BRIDGE_SALT,
  type MobileBridgePayload,
} from "@/lib/mobileAuth";

// Only ever hit by the system browser (Custom Tabs), right after Google's
// OAuth callback completes on this live deployment - see src/lib/mobileAuth.ts
// for the full flow. Never reached from inside the bundled Capacitor shell.
export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const payload: MobileBridgePayload = {
    id: session.user.id,
    name: session.user.name,
    email: session.user.email,
    picture: session.user.image,
    plan: session.user.plan,
    currentStreak: session.user.currentStreak,
  };

  const bridgeToken = await encode({
    secret: process.env.AUTH_SECRET!,
    salt: MOBILE_BRIDGE_SALT,
    maxAge: MOBILE_BRIDGE_MAX_AGE_SECONDS,
    token: payload,
  });

  return NextResponse.redirect(
    `${MOBILE_AUTH_CALLBACK_URL}?token=${encodeURIComponent(bridgeToken)}`,
  );
}
