// Bridges Google OAuth (which must run in the system browser, not the
// Capacitor WebView - see android/app/src/main/AndroidManifest.xml and
// src/app/login/page.tsx) back into the app's session.
//
// Flow: signIn("google") opens in Browser.open() -> Google -> NextAuth
// callback on the live API -> redirects the *system browser* to
// /api/mobile-callback, which mints a short-lived bridge JWT and 302s to
// MOBILE_AUTH_CALLBACK_URL?token=... -> Android hands that back to the app
// (intent-filter) -> the app POSTs the token to /api/auth/mobile-exchange,
// which verifies it and sets the real NextAuth session cookie in its
// response so CapacitorHttp's native cookie jar picks it up.
//
// MOBILE_AUTH_CALLBACK_URL is a verified Android App Link
// (https://www.flowrecall.app/auth-callback, autoVerify="true" in
// AndroidManifest.xml, ownership proven via public/.well-known/assetlinks.json)
// rather than a bare custom URL scheme - a custom scheme has no ownership
// verification at all, so any other app declaring the same scheme+host could
// receive this redirect via Android's disambiguation chooser. src/app/
// auth-callback/page.tsx is a plain web fallback for the (should-be-rare)
// case where App Link verification hasn't taken effect - it forwards to the
// legacy MOBILE_AUTH_LEGACY_SCHEME custom-scheme intent-filter, which stays
// registered in the manifest as a last resort. Either path still runs
// through the same single-use jti check in /api/auth/mobile-exchange (see
// UsedMobileBridgeToken), so a token can only ever be redeemed once
// regardless of which path delivered it.
//
// Relies on next-auth/jwt's encode/decode, which Auth.js's own docs mark as
// not yet stable ("This module *will* be refactored/changed") - re-verify
// this file against next-auth's changelog before upgrading that package.
export const MOBILE_AUTH_HOST = "www.flowrecall.app";
export const MOBILE_AUTH_PATH = "/auth-callback";
export const MOBILE_AUTH_CALLBACK_URL = `https://${MOBILE_AUTH_HOST}${MOBILE_AUTH_PATH}`;

// Legacy fallback only - see the comment above. Never used as the primary
// redirect target anymore.
export const MOBILE_AUTH_LEGACY_SCHEME = "flowrecall";
export const MOBILE_AUTH_LEGACY_HOST = "auth-callback";
export const MOBILE_AUTH_LEGACY_CALLBACK_URL = `${MOBILE_AUTH_LEGACY_SCHEME}://${MOBILE_AUTH_LEGACY_HOST}`;

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
  // Unique per minted token (see /api/mobile-callback) - /api/auth/mobile-exchange
  // records it in the UsedMobileBridgeToken table on first redemption, so a
  // captured token can't be replayed a second time within its validity
  // window. See that table's schema comment for the threat this closes.
  jti: string;
};
