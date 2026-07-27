"use client";

import { useId } from "react";

/** The brand's "Elegant Flowing F" mark, extracted from Navbar.tsx so the new
 * native SignedOutPrompt (src/app/account/page.tsx) can reuse it exactly
 * rather than duplicating the SVG. useId() keeps the gradient's id unique
 * per instance - harmless when there's only ever one on screen (Navbar hides
 * on native, where this second usage lives), but not a landmine if that
 * ever changes. */
export default function LogoMark({ className = "h-5 w-5" }: { className?: string }) {
  const gradientId = useId();

  return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      <path
        d="M8 20V9a5 5 0 0 1 5-5h5"
        stroke={`url(#${gradientId})`}
        strokeWidth="3.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M8 12h5" stroke="#F1F5F9" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
      <defs>
        <linearGradient id={gradientId} x1="8" y1="4" x2="18" y2="20" gradientUnits="userSpaceOnUse">
          <stop stopColor="#3B82F6" />
          <stop offset="1" stopColor="#93C5FD" />
        </linearGradient>
      </defs>
    </svg>
  );
}
