"use client";

import { useId } from "react";

/** The brand's "Flag Mark" - an F built from a flag/bookmark pennant with a
 * ribbon-tail notch, extracted from Navbar.tsx so the native SignedOutPrompt
 * (src/app/account/page.tsx) can reuse it exactly rather than duplicating the
 * SVG. Pure monochrome: plain fill="currentColor" so it inherits whatever
 * text color the caller sets (respects the Pure Monochrome dark/light
 * tokens in globals.css). `sheen` swaps the flat fill for a subtle
 * white-to-off-white gradient - only for large, fixed-dark "hero" chips
 * (Navbar, the native account screen); the favicon/apple-icon/Android
 * launcher generators intentionally stay flat single-color, since a
 * gradient at 16-32px just reads as noise and Android's adaptive-icon
 * masking wants a single opaque shape. */
export default function LogoMark({
  className = "h-5 w-5",
  sheen = false,
}: {
  className?: string;
  sheen?: boolean;
}) {
  const gradientId = useId();
  return (
    <svg viewBox="0 0 32 32" className={className} aria-label="FlowRecall">
      {sheen && (
        <defs>
          <linearGradient id={gradientId} x1="16" y1="4" x2="16" y2="28" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#FFFFFF" />
            <stop offset="1" stopColor="#E8E8E8" />
          </linearGradient>
        </defs>
      )}
      <path
        d="M9,6 L24,6 L24,13 L14.5,13 L14.5,27 L11.75,21.5 L9,27 Z"
        fill={sheen ? `url(#${gradientId})` : "currentColor"}
      />
    </svg>
  );
}
