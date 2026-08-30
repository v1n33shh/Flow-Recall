"use client";

import { eyeFilterColor, useEyeFilter } from "@/lib/eyeFilter";

/** The Eye Filter: one full-screen `mix-blend-mode: multiply` layer over the
 * whole reader.
 *
 * Why a lens rather than a set of warm colour tokens. The three readers put
 * their text through three different renderers - a plain DOM tree (text), a
 * virtualized column layout (PDF), and epub.js's own SANDBOXED IFRAME
 * documents, which inherit none of the parent page's custom properties (see
 * EpubReaderView's injected stylesheets). Re-theming would mean three
 * implementations that drift. One layer over the top is renderer-agnostic by
 * construction: it filters whatever is underneath, exactly like a screen
 * filter does.
 *
 * It deliberately covers the chrome and the definition sheet too. A filter that
 * stopped at the prose would leave a bright white popover to stab someone in
 * the eye an hour into a night session - the one moment the feature exists for.
 *
 * PERFORMANCE CONTRACT (matches ReaderChrome/DefinitionPopover): this layer
 * never animates and never moves. It is a static blend layer, so the reader's
 * transform-driven page turns still composite without it being re-rasterized.
 * Nothing renders at all when the filter is off, so a reader who never touches
 * the setting pays literally nothing. */
export default function EyeFilterOverlay() {
  const [state] = useEyeFilter();
  const color = eyeFilterColor(state);
  if (!color) return null;

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-50"
      style={{ backgroundColor: color, mixBlendMode: "multiply" }}
    />
  );
}
