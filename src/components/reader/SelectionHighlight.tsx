"use client";

import type { PageRect } from "./selection";

/** Paints the selected text on touch devices, where useNativeSelection/
 * EpubReaderView deliberately collapse the real browser selection (to
 * pre-empt the OS's native callout menu) - without this, collapsing the
 * selection would also erase its native blue highlight, leaving the student
 * unable to see what they just selected. Purely decorative/non-interactive:
 * pointer-events-none so it never itself intercepts the next tap. */
export default function SelectionHighlight({ rects }: { rects: PageRect[] }) {
  return (
    <div className="pointer-events-none fixed inset-0 z-30" aria-hidden="true">
      {rects.map((rect, i) => (
        <div
          key={i}
          className="absolute rounded-[3px] bg-accent/30"
          style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
        />
      ))}
    </div>
  );
}
