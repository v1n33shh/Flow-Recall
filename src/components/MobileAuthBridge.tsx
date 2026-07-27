"use client";

import { useEffect } from "react";
import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import { apiUrl } from "@/lib/apiUrl";
import { MOBILE_AUTH_HOST, MOBILE_AUTH_SCHEME } from "@/lib/mobileAuth";

// Mounted once near the app root (see layout.tsx). Catches the
// flowrecall://auth-callback deep link Android hands back after Google OAuth
// completes in the system browser (see src/app/login/page.tsx and
// src/lib/mobileAuth.ts for the rest of the flow), exchanges the short-lived
// bridge token for a real session cookie, then reloads so SessionProvider
// picks it up.
export default function MobileAuthBridge() {
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    const listenerPromise = App.addListener("appUrlOpen", ({ url }) => {
      void handleUrl(url);
    });

    return () => {
      void listenerPromise.then((listener) => listener.remove());
    };
  }, []);

  return null;
}

async function handleUrl(url: string) {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return;
  }
  if (parsed.protocol !== `${MOBILE_AUTH_SCHEME}:` || parsed.hostname !== MOBILE_AUTH_HOST) return;

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
    if (res.ok) window.location.reload();
  } catch {
    // Silent - the user just stays signed out and can retry from /login.
  }
}
