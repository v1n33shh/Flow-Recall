"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { getSession } from "next-auth/react";
import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import { apiUrl } from "@/lib/apiUrl";
import {
  MOBILE_AUTH_HOST,
  MOBILE_AUTH_LEGACY_HOST,
  MOBILE_AUTH_LEGACY_SCHEME,
  MOBILE_AUTH_PATH,
} from "@/lib/mobileAuth";

// Mounted once near the app root (see layout.tsx). Catches the deep link
// Android hands back after Google OAuth completes in the system browser -
// either the verified https App Link, or (rarely - see src/lib/mobileAuth.ts)
// the legacy custom-scheme fallback - exchanges the short-lived bridge token
// for a real session cookie, then updates the session in place so Navbar/
// account/pricing all reflect it immediately.
export default function MobileAuthBridge() {
  const router = useRouter();

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    // Forces one authoritative re-check on cold launch. SessionProvider's own
    // automatic first fetch goes out through CapacitorHttp's GET proxy path
    // (see android/.../native-bridge.js) rather than the credentialed POST
    // path this app otherwise relies on - if that first read ever comes back
    // stale/empty, useSession() has no reason to retry on its own, and every
    // gated screen (Account included) reads unauthenticated for the rest of
    // the app's life. This mirrors the same getSession() re-fetch already
    // used below after the OAuth deep link, just run unconditionally too.
    void getSession();

    const urlListenerPromise = App.addListener("appUrlOpen", ({ url }) => {
      void handleUrl(url, router);
    });

    // Web's `refetchOnWindowFocus` (SessionProvider in layout.tsx) listens
    // for the DOM `visibilitychange` event, which Android's WebView doesn't
    // reliably fire across OEMs when the app is backgrounded/foregrounded -
    // Capacitor's own 'resume' event is the mechanism actually built for
    // this. Without it, a session that changed while the app was backgrounded
    // (signed out elsewhere, token expired) wouldn't be caught until some
    // unrelated re-render happened to run.
    const resumeListenerPromise = App.addListener("resume", () => {
      void getSession();
    });

    return () => {
      void urlListenerPromise.then((listener) => listener.remove());
      void resumeListenerPromise.then((listener) => listener.remove());
    };
  }, [router]);

  return null;
}

async function handleUrl(url: string, router: ReturnType<typeof useRouter>) {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return;
  }
  const isVerifiedAppLink =
    parsed.protocol === "https:" && parsed.hostname === MOBILE_AUTH_HOST && parsed.pathname === MOBILE_AUTH_PATH;
  const isLegacyScheme =
    parsed.protocol === `${MOBILE_AUTH_LEGACY_SCHEME}:` && parsed.hostname === MOBILE_AUTH_LEGACY_HOST;
  if (!isVerifiedAppLink && !isLegacyScheme) return;

  const token = parsed.searchParams.get("token");
  await Browser.close().catch(() => {});
  if (!token) return;

  try {
    const res = await fetch(apiUrl("/api/auth/mobile-exchange"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
      credentials: "include",
    });
    if (res.ok) {
      // getSession() re-fetches AND posts to the BroadcastChannel every
      // mounted useSession() consumer listens on (node_modules/next-auth/
      // react.js) - this is what actually makes Navbar/account/pricing
      // update instantly, not a reload. router.refresh() is close to a
      // no-op on this static-exported shell (no server to re-render
      // against) but is harmless and future-proofs any server-backed route.
      await getSession();
      router.refresh();
    }
  } catch {
    // Silent - the user just stays signed out and can retry from /login.
  }
}
