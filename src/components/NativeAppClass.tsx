"use client";

import { useEffect } from "react";
import { Capacitor } from "@capacitor/core";
import { applyStoredTheme } from "@/lib/theme";

// Stamps .native-app onto <html> so globals.css can scope the
// tap-highlight/overscroll/user-select overrides to the Capacitor shell only
// - the web deployment (same bundle, same CSS file) never gets the class and
// is completely unaffected. Done via an effect rather than at module scope
// so it never runs during the export build's prerender pass.
export default function NativeAppClass() {
  useEffect(() => {
    if (Capacitor.isNativePlatform()) {
      document.documentElement.classList.add("native-app");
      // Restores the Account screen's Appearance preference on cold launch -
      // otherwise every relaunch would silently reset to dark.
      applyStoredTheme();
    }
  }, []);

  return null;
}
