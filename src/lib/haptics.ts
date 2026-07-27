import { Capacitor } from "@capacitor/core";
import { Haptics, ImpactStyle } from "@capacitor/haptics";

function vibrate(pattern: number | number[]) {
  if (typeof navigator === "undefined" || !("vibrate" in navigator)) return;
  try {
    navigator.vibrate(pattern);
  } catch {
    // Vibration can throw in some environments (e.g. embedded webviews without
    // permission) - this is pure polish, never worth breaking the app over.
  }
}

// navigator.vibrate() is a raw buzz-motor pulse - it works (Android WebView
// supports it) but feels like a generic web notification, not the crisper,
// system-consistent feedback Capacitor's native Haptics plugin produces via
// Android's own HapticFeedbackConstants/VibrationEffect. Prefer native
// whenever the app is actually running in Capacitor; the navigator.vibrate()
// path is only ever reached on the web deployment now.
function impact(style: ImpactStyle): boolean {
  if (!Capacitor.isNativePlatform()) return false;
  void Haptics.impact({ style }).catch(() => {
    // Some devices/OEM WebViews restrict haptics without a permission - pure
    // polish, never worth breaking the app over.
  });
  return true;
}

/** Light, crisp pulse for a correct answer. */
export function vibrateCorrect() {
  if (impact(ImpactStyle.Light)) return;
  vibrate([30]);
}

/** Heavier double-pulse for an incorrect answer. */
export function vibrateIncorrect() {
  if (impact(ImpactStyle.Medium)) return;
  vibrate([50, 100, 50]);
}

/** Subtle tap for buttons, tab switches, and other everyday taps. */
export function vibrateTap() {
  if (impact(ImpactStyle.Light)) return;
  vibrate(15);
}
