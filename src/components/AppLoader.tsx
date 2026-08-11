"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useIsNative } from "@/lib/useIsNative";
import { vibrateTap } from "@/lib/haptics";

// Must exactly match colors.xml's splashBackground and globals.css's
// background token - any mismatch would show as a one-frame color seam the
// instant the native splash's own fade-out reveals this overlay underneath it.
const SPLASH_BG = "#050505";

// Choreography, in ms. styles.xml's native splash is background-only (no
// icon - see its doc comment on why), so this component owns the ENTIRE
// branded reveal rather than just finishing one a native icon started: the
// mark fades and springs in from nothing, a soft bloom pulses out behind it,
// then a glare sweep crosses its silhouette. HOLD_MS + EXIT_MS lands at
// ~1.7s - deliberately unhurried ("let it breathe"), never tied to real data
// loading.
const MATERIALIZE_MS = 550;
const BLOOM_MS = 750;
const SWEEP_DELAY_MS = 500;
const SWEEP_MS = 600;
const HOLD_MS = 1300;
const EXIT_MS = 400;

// Hard backstop, independent of the choreography above: if any animation
// callback above never fires (a bug, a stalled bridge), the overlay comes
// down anyway. Comfortably shorter than capacitor.config.ts's own
// launchShowDuration safety net, so THIS is what the user actually sees if
// something upstream goes wrong, not a permanently stuck loader.
const FAILSAFE_MS = 4200;

/** The React half of the "Seamless Splash Handoff": Android's native
 * SplashScreen (styles.xml's AppTheme.NoActionBarLaunch, kept on-screen via
 * capacitor.config.ts's SplashScreen.launchAutoHide) is still covering the
 * WebView when this mounts, so nothing here is visible to the user yet.
 *
 * `useIsNative` resolves a beat after mount (SSR/hydration-safe - see its
 * own doc comment), which is exactly what's wanted here: the render where it
 * flips true paints a completely STATIC frame - just the flat background,
 * mark invisible (opacity 0) - pixel-identical to the native splash it's
 * still hidden behind, since that splash is background-only too. Only in the
 * effect below, after an rAF confirms that static frame actually painted, is
 * it safe to call SplashScreen.hide(): the frame it reveals underneath
 * matches exactly, so the handoff is imperceptible. Only then does the mark
 * materialize, the bloom pulse, and the glare sweep start - all animate FROM
 * their resting (invisible/off-screen) values, so there's zero jump at the
 * moment they kick off, just a sudden burst of motion. */
export default function AppLoader() {
  const isNative = useIsNative(false);
  const [entered, setEntered] = useState(false);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    if (!isNative) return;

    const raf = requestAnimationFrame(() => {
      import("@capacitor/splash-screen")
        .then(({ SplashScreen }) => SplashScreen.hide())
        .catch(() => {
          // Nothing else here can hide it - capacitor.config.ts's generous
          // launchShowDuration safety ceiling is what saves the launch.
        });
      // Synced to the exact frame the mark starts materializing, so the
      // buzz reads as the logo physically "arriving" rather than a generic
      // notification tick.
      vibrateTap();
      setEntered(true);
    });

    return () => cancelAnimationFrame(raf);
  }, [isNative]);

  useEffect(() => {
    if (!entered) return;
    const timer = setTimeout(() => setVisible(false), HOLD_MS);
    return () => clearTimeout(timer);
  }, [entered]);

  // Independent of `entered` on purpose - this fires even if the effect
  // above never does.
  useEffect(() => {
    if (!isNative) return;
    const failsafe = setTimeout(() => setVisible(false), FAILSAFE_MS);
    return () => clearTimeout(failsafe);
  }, [isNative]);

  if (!isNative) return null;

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          className="fixed inset-0 z-[999] flex items-center justify-center"
          style={{ backgroundColor: SPLASH_BG }}
          exit={{ opacity: 0, scale: 1.04 }}
          transition={{ duration: EXIT_MS / 1000, ease: "easeInOut" }}
        >
          <div className="relative h-32 w-32">
            {/* Soft achromatic bloom, pulsing outward from behind the mark
                right as it materializes - pure white radial glow, no color,
                the same white-only treatment as .signed-out-glow elsewhere. */}
            <motion.div
              className="absolute inset-[-60%] rounded-full"
              style={{
                background: "radial-gradient(circle, rgba(255,255,255,0.28) 0%, transparent 70%)",
              }}
              initial={{ opacity: 0, scale: 0.4 }}
              animate={
                entered
                  ? { opacity: [0, 1, 0], scale: [0.4, 1.1, 1.3] }
                  : { opacity: 0, scale: 0.4 }
              }
              transition={{ duration: BLOOM_MS / 1000, ease: "easeOut" }}
            />

            <motion.img
              src="/splash-logo.png"
              alt=""
              className="absolute inset-0 h-full w-full select-none object-contain"
              draggable={false}
              // Rest state (opacity 0) exactly matches the now icon-less
              // native splash - the mark fades in and springs through an
              // overshoot in one motion, so kicking it off reads as the logo
              // arriving with energy, not just wiggling in place.
              initial={{ opacity: 0, scale: 0.6 }}
              animate={
                entered
                  ? { opacity: 1, scale: [0.6, 1.16, 0.92, 1.04, 1] }
                  : { opacity: 0, scale: 0.6 }
              }
              transition={{
                opacity: { duration: 0.18, ease: "easeOut" },
                scale: { duration: MATERIALIZE_MS / 1000, ease: [0.34, 1.56, 0.64, 1] },
              }}
            />

            {/* Metallic white/silver light-glare sweep, clipped to the logo's
                own silhouette via a luminance mask - a diagonal bright band
                translates across so it reads as a shine crossing the F,
                never as a bar floating over the black background. Pure
                white/silver only - no color anywhere in this system. */}
            <div
              className="absolute inset-0 overflow-hidden"
              style={{
                WebkitMaskImage: "url(/splash-logo.png)",
                WebkitMaskSize: "contain",
                WebkitMaskRepeat: "no-repeat",
                WebkitMaskPosition: "center",
                maskImage: "url(/splash-logo.png)",
                maskSize: "contain",
                maskRepeat: "no-repeat",
                maskPosition: "center",
              }}
            >
              <motion.div
                className="absolute inset-y-0 w-1/2"
                style={{
                  background:
                    "linear-gradient(100deg, transparent 0%, transparent 35%, rgba(255,255,255,0.4) 46%, rgba(255,255,255,0.95) 50%, rgba(255,255,255,0.4) 54%, transparent 65%, transparent 100%)",
                }}
                initial={{ x: "-140%" }}
                animate={entered ? { x: "240%" } : { x: "-140%" }}
                transition={{ duration: SWEEP_MS / 1000, delay: SWEEP_DELAY_MS / 1000, ease: "easeInOut" }}
              />
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
