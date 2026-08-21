"use client";

import { Suspense, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { MOBILE_AUTH_LEGACY_CALLBACK_URL } from "@/lib/mobileAuth";

// Reached only when the OS DIDN'T intercept https://www.flowrecall.app/auth-
// callback as a verified Android App Link and handed it to a real browser
// instead - normally that means autoVerify hasn't finished (e.g. moments
// after a fresh install) rather than anything being wrong. See
// src/lib/mobileAuth.ts for the full flow this is one step of.
//
// Forwards to the legacy custom-scheme intent-filter, which stays registered
// in the manifest specifically as this last-resort fallback - the bridge
// token is still single-use either way (see UsedMobileBridgeToken), so this
// path doesn't reopen the replay risk the App Link migration closed, only
// the much narrower "which app receives it first" window.
function AuthCallbackRedirect() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const legacyUrl = token
    ? `${MOBILE_AUTH_LEGACY_CALLBACK_URL}?token=${encodeURIComponent(token)}`
    : null;

  useEffect(() => {
    if (legacyUrl) window.location.href = legacyUrl;
  }, [legacyUrl]);

  return (
    <main className="flex w-full flex-1 flex-col items-center justify-center px-6 py-16 text-center">
      <p className="text-sm text-muted-foreground">
        {legacyUrl ? (
          <>
            Taking you back to FlowRecall&hellip;{" "}
            <a href={legacyUrl} className="text-foreground underline underline-offset-2">
              Tap here
            </a>{" "}
            if nothing happens.
          </>
        ) : (
          "This sign-in link is missing or has expired. Please return to the app and try again."
        )}
      </p>
    </main>
  );
}

export default function AuthCallbackPage() {
  return (
    <Suspense fallback={null}>
      <AuthCallbackRedirect />
    </Suspense>
  );
}
