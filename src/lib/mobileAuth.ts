// Bridges Google OAuth (which must run in the system browser, not the
// Capacitor WebView - see android/app/src/main/AndroidManifest.xml and
// src/app/login/page.tsx) back into the app's session.
//
// Flow: signIn("google") opens in Browser.open() -> Google -> NextAuth
// callback on the live API -> redirects the *system browser* to
// /api/mobile-callback, which mints a short-lived bridge JWT and 302s to
// MOBILE_AUTH_SCHEME://MOBILE_AUTH_HOST?token=... -> Android hands that back
// to the app (intent-filter) -> the app POSTs the token to
// /api/auth/mobile-exchange, which verifies it and sets the real NextAuth
// session cookie in its response so CapacitorHttp's native cookie jar picks
// it up.
//
// Relies on next-auth/jwt's encode/decode, which Auth.js's own docs mark as
// not yet stable ("This module *will* be refactored/changed") - re-verify
// this file against next-auth's changelog before upgrading that package.
export const MOBILE_AUTH_SCHEME = "flowrecall";
export const MOBILE_AUTH_HOST = "auth-callback";
export const MOBILE_AUTH_CALLBACK_URL = `${MOBILE_AUTH_SCHEME}://${MOBILE_AUTH_HOST}`;

// Distinct from the real session cookie's salt (see @auth/core/lib/actions/session.js,
// which uses the cookie name as salt) so this short-lived bridge token derives
// a different encryption key than the real session - it's a different
// credential with a different (much shorter) trust lifetime.
export const MOBILE_BRIDGE_SALT = "flowrecall.mobile-bridge-token";
export const MOBILE_BRIDGE_MAX_AGE_SECONDS = 60;

export type MobileBridgePayload = {
  id: string;
  name?: string | null;
  email?: string | null;
  picture?: string | null;
  plan?: string | null;
  currentStreak?: number | null;
};
