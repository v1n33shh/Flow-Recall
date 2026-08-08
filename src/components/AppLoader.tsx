"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useIsNative } from "@/lib/useIsNative";

// Must exactly match colors.xml's splashBackground and globals.css's
// background token - any mismatch would show as a one-frame color seam the
// instant the native splash's own fade-out reveals this overlay underneath it.
const SPLASH_BG = "#050505";

// Choreography, in ms. The logo's "punch" entrance and the glare sweep both
// start at t=0 (pulsing flips true), overlapping slightly for fluidity;
// PULSE_MS covers whichever finishes last plus a short hold before the exit
// fade starts. Total (PULSE_MS + EXIT_MS) lands at ~1.5s - deliberately
// unhurried ("let it breathe"), never tied to real data loading.
const PUNCH_MS = 550;
const SWEEP_DELAY_MS = 300;
const SWEEP_MS = 600;
const PULSE_MS = 1100;
const EXIT_MS = 400;

// Hard backstop, independent of the choreography above: if any animation
// callback above never fires (a bug, a stalled bridge), the overlay comes
// down anyway. Comfortably shorter than capacitor.config.ts's own
// launchShowDuration safety net, so THIS is what the user actually sees if
// something upstream goes wrong, not a permanently stuck loader.
const FAILSAFE_MS = 4000;

/** The React half of the "Seamless Splash Handoff": Android's native
 * SplashScreen (styles.xml's AppTheme.NoActionBarLaunch, kept on-screen via
 * capacitor.config.ts's SplashScreen.launchAutoHide) is still covering the
 * WebView when this mounts, so nothing here is visible to the user yet.
 *
 * `useIsNative` resolves a beat after mount (SSR/hydration-safe - see its
 * own doc comment), which is exactly what's wanted here: the render where it
 * flips true paints a completely STATIC frame - same background, same still
 * logo at rest (scale 1, no glare) - deliberately pixel-identical to the
 * native splash it's still hidden behind. Only in the effect below, after an
 * rAF confirms that static frame actually painted, is it safe to call
 * SplashScreen.hide(): the frame it reveals underneath matches exactly, so
 * the handoff is imperceptible. Only then does the logo "punch" and the
 * glare sweep start - both animate FROM their resting values, so there's
 * zero jump at the moment they kick off, just a sudden burst of motion. */
export default function AppLoader() {
  const isNative = useIsNative(false);
  const [pulsing, setPulsing] = useState(false);
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
      setPulsing(true);
    });

    return () => cancelAnimationFrame(raf);
  }, [isNative]);

  useEffect(() => {
    if (!pulsing) return;
    const timer = setTimeout(() => setVisible(false), PULSE_MS);
    return () => clearTimeout(timer);
  }, [pulsing]);

  // Independent of `pulsing` on purpose - this fires even if the effect
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
            <motion.img
              src="/splash-logo.png"
              alt=""
              className="absolute inset-0 h-full w-full select-none object-contain"
              draggable={false}
              // Rest state (scale 1) exactly matches the native splash's
              // static icon - the keyframe sequence below starts AND ends at
              // 1, so kicking it off produces a sudden overshoot, not a jump.
              animate={
                pulsing
                  ? { scale: [1, 1.22, 0.9, 1.05, 1] }
                  : { scale: 1 }
              }
              transition={{ duration: PUNCH_MS / 1000, ease: [0.34, 1.56, 0.64, 1] }}
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
                animate={pulsing ? { x: "240%" } : { x: "-140%" }}
                transition={{ duration: SWEEP_MS / 1000, delay: SWEEP_DELAY_MS / 1000, ease: "easeInOut" }}
              />
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
