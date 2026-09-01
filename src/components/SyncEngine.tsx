"use client";

import { useEffect, useRef } from "react";
import { useSession } from "next-auth/react";
import { syncNow } from "@/lib/recallStorage";

/** Keeps the learning record durable, quietly.
 *
 * Renders nothing and blocks nothing. Every call is best-effort with the same
 * posture as recordReview: the feed and the scheduler work entirely from
 * IndexedDB, so a failed sync costs durability until the next attempt and costs
 * the student nothing right now. Because the cursor only advances on success, the
 * next attempt re-sends whatever this one could not.
 *
 * Three triggers, each for a case the others miss:
 *
 * - **On sign-in**, which is also first launch on a new device - the one moment
 *   the student is actively waiting to see their library reappear.
 * - **When the tab or app goes to the background**, which is what actually happens
 *   at the end of a study session: the student answers the last card and leaves.
 *   `visibilitychange` covers both the browser and the Android WebView, so this
 *   needs no Capacitor plugin.
 * - **Debounced after engine writes**, so a long session is not left entirely
 *   unsynced until it ends, without firing once per answer.
 *
 * Serialised through one in-flight guard. Two overlapping syncs would both read
 * the cursor before either advanced it, push the same rows twice (harmless - the
 * server dedupes) and then race to rebuild the memory store from two different
 * review sets, which is not harmless. */

const IDLE_DEBOUNCE_MS = 20_000;

export default function SyncEngine() {
  const { data: session, status } = useSession();
  const userId = session?.user?.id;
  const running = useRef(false);
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (status !== "authenticated" || !userId) return;

    let alive = true;
    const run = () => {
      if (!alive || running.current) return;
      running.current = true;
      void syncNow(userId)
        .catch((error) => console.error("sync failed", error))
        .finally(() => {
          running.current = false;
        });
    };

    const runSoon = () => {
      if (pending.current) clearTimeout(pending.current);
      pending.current = setTimeout(run, IDLE_DEBOUNCE_MS);
    };

    const onVisibility = () => {
      // Leaving is the end of a session far more often than arriving is the start
      // of one, and a backgrounded WebView may not get much time - so sync on the
      // way out rather than waiting for the debounce.
      if (document.visibilityState === "hidden") run();
    };

    run();
    window.addEventListener("recall-engine-update", runSoon);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      alive = false;
      if (pending.current) clearTimeout(pending.current);
      window.removeEventListener("recall-engine-update", runSoon);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [status, userId]);

  return null;
}
