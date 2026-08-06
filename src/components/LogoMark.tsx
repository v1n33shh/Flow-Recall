"use client";

import { useId } from "react";

/** The brand's "Elegant Flowing F" mark, extracted from Navbar.tsx so the new
 * native SignedOutPrompt (src/app/account/page.tsx) can reuse it exactly
 * rather than duplicating the SVG. useId() keeps the gradient's id unique
 * per instance - harmless when there's only ever one on screen (Navbar hides
 * on native, where this second usage lives), but not a landmine if that
 * ever changes. */
export default function LogoMark({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <img 
      src="/logo.png" 
      alt="FlowRecall Logo" 
      className={`object-cover ${className}`} 
    />
  );
}
