"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { App } from "@capacitor/app";

/** Makes the Android back gesture mean "back" instead of "close FlowRecall".
 *
 * Nothing in this app handled back until now, and the gap was invisible on the
 * one device it has been tested on. There are 11 `router.push` call sites, so a
 * student reaches the revision sheet through Home -> deck -> revise and is three
 * entries deep in history - and with no `backButton` listener registered,
 * Capacitor's default is to let the Activity finish. Back closed the app from
 * wherever they were, and the way back in is the launcher.
 *
 * Registering *any* listener is what takes that decision away from the platform,
 * which is why this file exists at all rather than a config flag.
 *
 * `canGoBack` comes from the WebView's own history stack, not from a counter kept
 * here - the plugin reads it at the moment of the press, so it stays right across
 * a deep link, an OAuth round trip, or a reload. False means this is the first
 * entry, and *there* closing the app is the correct behaviour: trapping a student
 * on the home screen with a dead back gesture is worse than exiting.
 *
 * Renders nothing and blocks nothing, the same posture as SyncEngine,
 * ReminderScheduler and MobileAuthBridge - and it lives in the layout for the
 * same reason they do: back has to work on every screen, so it cannot be owned by
 * any one of them.
 *
 * Harmless on the web, where the event is never emitted. No native guard needed,
 * and adding one would only make the listener's lifetime depend on a state update
 * that arrives a microtask late. */
export default function BackButtonBridge() {
  const router = useRouter();

  useEffect(() => {
    // Same shape MobileAuthBridge uses: keep the PROMISE, and remove through it
    // in cleanup. Awaiting the handle into a variable instead would leak a
    // listener whenever the effect is torn down before the promise resolves -
    // and a second live listener means one press goes back twice.
    const listenerPromise = App.addListener("backButton", ({ canGoBack }) => {
      if (canGoBack) router.back();
      else void App.exitApp();
    });

    return () => {
      void listenerPromise.then((listener) => listener.remove());
    };
  }, [router]);

  return null;
}
