"use client";

import { useEffect, useState } from "react";

/** React-render-time counterpart to selection.ts's isCoarsePointer() - a
 * hook (reactive, for choosing what to render) rather than a plain function
 * (for imperative event-handler setup). Used by DefinitionPopover to choose
 * between its floating-card (desktop) and bottom-sheet (touch) chrome. Stays
 * live via matchMedia's change event, e.g. a tablet gaining a trackpad. */
export function useIsTouchDevice(): boolean {
  const [isTouch, setIsTouch] = useState(
    () =>
      typeof window !== "undefined" &&
      (window.matchMedia("(pointer: coarse)").matches ||
        "ontouchstart" in window ||
        (typeof navigator !== "undefined" && navigator.maxTouchPoints > 0)),
  );

  useEffect(() => {
    const query = window.matchMedia("(pointer: coarse)");
    const onChange = (e: MediaQueryListEvent) => {
      setIsTouch(
        e.matches ||
          "ontouchstart" in window ||
          (typeof navigator !== "undefined" && navigator.maxTouchPoints > 0),
      );
    };
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  return isTouch;
}
