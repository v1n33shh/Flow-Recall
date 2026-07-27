"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { Capacitor } from "@capacitor/core";

// Only active inside the Capacitor shell - the web deployment keeps its
// existing instant navigation untouched. Slides the new route in from the
// right while the old one slides out underneath (no `mode="wait"`, so they
// run concurrently rather than sequentially - a route-swap shouldn't feel
// slower than an instant one).
// PERFORMANCE CONTRACT (matches StreakCounter): transform/opacity only,
// never filter/box-shadow - those force a repaint every frame on cheap
// Android phones.
export default function PageTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  // Computed post-mount (not during SSR/export) to avoid a hydration
  // mismatch between the server-rendered shell and the native runtime.
  const [isNative, setIsNative] = useState(false);
  useEffect(() => {
    setIsNative(Capacitor.isNativePlatform());
  }, []);

  if (!isNative) {
    return <div className="flex flex-1 flex-col">{children}</div>;
  }

  // The outer div keeps the flex-1 slot stable (same as the non-native
  // branch); the transitioning page is absolutely positioned inside it so
  // the exiting and entering pages overlap during the crossfade instead of
  // stacking in normal flow, which would otherwise double the visible height
  // for the duration of the transition.
  return (
    <div className="relative flex-1">
      <AnimatePresence initial={false}>
        <motion.div
          key={pathname}
          className="absolute inset-0 flex flex-col"
          initial={{ opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -24 }}
          transition={{ type: "spring", stiffness: 380, damping: 34 }}
        >
          {children}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
