"use client";

import { useEffect, useState } from "react";

/** React-render-time counterpart to selection.ts's isCoarsePointer() - a
 * hook (reactive, for choosing what to render) rather than a plain function
 * (for imperative event-handler setup). Used by DefinitionPopover to choose
 * between its floating-card (desktop) and bottom-sheet (touch) chrome. Stays
 * live via matchMedia's change event, e.g. a tablet gaining a trackpad. */
export function useIsTouchDevice(): boolean {
  // Lazy initializer (not an effect) so the very first client render
  // already has the right value instead of one render of "desktop" - this
  // runs client-side only (the initializer itself, not module scope), and
  // Next still server-renders "use client" components for the initial HTML,
  // hence the typeof guard.
  const [isTouch, setIsTouch] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches,
  );

  useEffect(() => {
    const query = window.matchMedia("(pointer: coarse)");
    const onChange = (e: MediaQueryListEvent) => setIsTouch(e.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  return isTouch;
}
