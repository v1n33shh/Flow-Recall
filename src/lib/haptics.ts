function vibrate(pattern: number | number[]) {
  if (typeof navigator === "undefined" || !("vibrate" in navigator)) return;
  try {
    navigator.vibrate(pattern);
  } catch {
    // Vibration can throw in some environments (e.g. embedded webviews without
    // permission) - this is pure polish, never worth breaking the app over.
  }
}

/** Light, crisp pulse for a correct answer. */
export function vibrateCorrect() {
  vibrate([30]);
}

/** Heavier double-pulse for an incorrect answer. */
export function vibrateIncorrect() {
  vibrate([50, 100, 50]);
}
