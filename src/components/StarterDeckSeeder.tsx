"use client";

import { useEffect } from "react";
import { seedStarterDeck } from "@/lib/storage";

/** Puts "How Memory Works" on the shelf the first time the app is opened.
 *
 * Renders nothing, and runs on web and native alike - a visitor who lands on /library
 * should no more meet an empty shelf than someone who installed the app.
 *
 * An effect rather than module scope, for the same reason NativeAppClass uses one: this
 * must never run during the export build's prerender pass, where there is no
 * localStorage to seed into. It is also why seedStarterDeck guards on `window` itself
 * rather than trusting every caller to.
 *
 * Mounted in layout.tsx ABOVE SyncEngine, so the deck exists before a signed-in student's
 * first sync runs - not that sync would touch it (the starter's reserved owner keeps it
 * out of every push), but ordering that is obvious beats ordering that has to be argued.
 */
export default function StarterDeckSeeder() {
  useEffect(() => {
    seedStarterDeck();
  }, []);

  return null;
}
