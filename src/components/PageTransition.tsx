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

  // will-change is only asserted WHILE the spring is actually running, then
  // released back to "auto" - see onAnimationStart/Complete below. Leaving
  // will-change on permanently would pin an extra GPU-composited layer for
  // the entire time each screen is open, which works against the low-end-
  // device budget this whole component exists to protect.
  const [transitioning, setTransitioning] = useState(false);

  if (!isNative) {
    return <div className="flex flex-1 flex-col">{children}</div>;
  }

  // The outer div keeps the flex-1 slot stable (same as the non-native
  // branch); the transitioning page is absolutely positioned inside it so
  // the exiting and entering pages overlap during the crossfade instead of
  // stacking in normal flow, which would otherwise double the visible height
  // for the duration of the transition.
  //
  // That absolute positioning has a side effect: it takes the page out of
  // normal flow entirely, so content taller than this box's fixed height
  // (viewport minus MobileTabBar's reserved --tabbar-h, which its own
  // in-flow spacer already carves out of this flex-1 slot) can't grow the
  // page and make it scroll - it just silently overflows past the bottom,
  // trapped behind/past the tab bar with no way to reach it. overflow-y-auto
  // makes this div itself the scroll container instead of relying on
  // document-level scroll it no longer contributes to. The box is already
  // sized to exclude the tab bar zone, so paddingBottom here is just visual
  // breathing room, not a second safe-area reservation. Safe-area-top padding
  // lives here too: native has no Navbar (it's hidden - see Navbar.tsx), so
  // this is the only thing standing between page content and the notch.
  return (
    <div className="relative flex-1">
      <AnimatePresence initial={false}>
        <motion.div
          key={pathname}
          data-scroll-root
          className="absolute inset-0 flex flex-col overflow-y-auto overscroll-contain [-webkit-overflow-scrolling:touch]"
          style={{
            paddingTop: "env(safe-area-inset-top)",
            paddingBottom: "1.5rem",
            willChange: transitioning ? "transform, opacity" : "auto",
          }}
          initial={{ opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -24 }}
          transition={{ type: "spring", stiffness: 380, damping: 34 }}
          onAnimationStart={() => setTransitioning(true)}
          onAnimationComplete={() => setTransitioning(false)}
        >
          {children}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
