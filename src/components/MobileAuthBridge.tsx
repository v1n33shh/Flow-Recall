"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { getSession } from "next-auth/react";
import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import { apiUrl } from "@/lib/apiUrl";
import { MOBILE_AUTH_HOST, MOBILE_AUTH_SCHEME } from "@/lib/mobileAuth";

// Mounted once near the app root (see layout.tsx). Catches the
// flowrecall://auth-callback deep link Android hands back after Google OAuth
// completes in the system browser (see src/app/login/page.tsx and
// src/lib/mobileAuth.ts for the rest of the flow), exchanges the short-lived
// bridge token for a real session cookie, then updates the session in place
// so Navbar/account/pricing all reflect it immediately.
export default function MobileAuthBridge() {
  const router = useRouter();

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    const listenerPromise = App.addListener("appUrlOpen", ({ url }) => {
      void handleUrl(url, router);
    });

    return () => {
      void listenerPromise.then((listener) => listener.remove());
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
