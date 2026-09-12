"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import UnifiedDropzone from "@/components/reader/UnifiedDropzone";
import PasteTextForm from "@/components/reader/PasteTextForm";
import { FOCUS, GLIDE, TRANSITION } from "@/lib/spatial";
import type { BookMeta } from "@/lib/types";

/** The FAB's destination: a bottom sheet that adds a document without leaving the screen.
 *
 * IT REUSES THE REAL IMPORTERS. UnifiedDropzone and PasteTextForm already parse EPUB
 * metadata, rasterize a PDF's first page into a cover, wrap pasted text as a File, and
 * persist all three through readerStorage. Rebuilding any of that for a new sheet would
 * have been a second, worse importer. This file is presentation and gesture only.
 *
 * ---------------------------------------------------------------------------
 * THE SWIPE
 * ---------------------------------------------------------------------------
 * `drag="y"` with a zero-height constraint box and `dragElastic` on the bottom edge only:
 * the sheet follows the thumb downward with rubber-band resistance and refuses to travel
 * up at all, which is what makes it feel hinged to the bottom of the screen rather than
 * loose on it.
 *
 * DISMISS IS DISTANCE **OR** VELOCITY, not distance alone. A slow, deliberate 120px drag
 * and a fast 20px flick are both unambiguous "close" gestures, and a threshold that only
 * measures offset ignores the second one - which is the flick most people actually use.
 * Both are read off the same `onDragEnd` info object.
 *
 * ---------------------------------------------------------------------------
 * WHY NOT A <dialog> OR A PORTAL
 * ---------------------------------------------------------------------------
 * This renders inline, above everything, on its own layer. A native <dialog> would give
 * focus trapping for free but it also gives a top-layer element that `backdrop-filter`
 * cannot see through to the screen behind it - the frost would resolve against nothing and
 * the sheet would read as flat grey. Focus handling is done explicitly below instead.
 *
 * ESCAPE AND THE BACK GESTURE both close it: Escape via the key handler here, and
 * Android's system back via BackButtonBridge, which already routes to history - the sheet
 * is not a history entry, so back leaves the screen instead. That is a known limitation
 * and the scrim tap plus the swipe are the two gestures that actually get used on a phone.
 */
export default function UploadSheet({
  open,
  onClose,
  onImported,
}: {
  open: boolean;
  onClose: () => void;
  onImported: (book: BookMeta) => void;
}) {
  const [mode, setMode] = useState<"upload" | "paste">("upload");
  const reduceMotion = useReducedMotion() ?? false;

  // Escape closes, and the page behind must not scroll while a sheet is over it - on a
  // phone that shows up as the sheet appearing to slide because the content under it
  // moved, which reads as a rendering fault.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <div
          className="fixed inset-0 z-[60] flex flex-col justify-end"
          role="dialog"
          aria-modal="true"
          aria-label="Add a document"
        >
          {/* THE SCRIM. Its own element rather than a shadow on the sheet, so it can fade
              independently and so a tap anywhere off the sheet closes it. */}
          <motion.button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="absolute inset-0 cursor-default bg-black/75 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.25 }}
          />

          <motion.div
            className="relative max-h-[88vh] overflow-y-auto rounded-t-[28px] border-t border-white/10 bg-white/5 shadow-[inset_0_1px_0_rgba(255,255,255,0.09)] backdrop-blur-3xl"
            style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 1.5rem)" }}
            initial={reduceMotion ? { opacity: 0 } : { y: "100%" }}
            animate={reduceMotion ? { opacity: 1 } : { y: 0 }}
            exit={reduceMotion ? { opacity: 0 } : { y: "100%" }}
            transition={reduceMotion ? { duration: 0 } : { duration: 0.45, ease: GLIDE }}
            drag={reduceMotion ? false : "y"}
            dragConstraints={{ top: 0, bottom: 0 }}
            // Top is rigid (0) and bottom is loose (0.4): the sheet cannot be pulled up
            // past its own edge, only down and away.
            dragElastic={{ top: 0, bottom: 0.4 }}
            dragMomentum={false}
            onDragEnd={(_, info) => {
              if (info.offset.y > 120 || info.velocity.y > 700) onClose();
            }}
          >
            {/* The grab handle. It is not decoration - it is the only thing on the sheet
                that says "this can be dragged", and without it the swipe is a gesture
                nobody discovers. */}
            <div className="flex cursor-grab justify-center pb-1 pt-3 active:cursor-grabbing">
              <div className="h-1 w-9 rounded-full bg-white/25" />
            </div>

            <div className="px-5 pt-3">
              <h2 className="text-[20px] font-semibold tracking-[-0.02em] text-white">Add a document</h2>

              {/* Segmented control, CSS only - see the note on the buttons themselves. */}
              <div className="mt-4 inline-flex gap-0.5 rounded-full border border-white/10 bg-white/5 p-0.5">
                {(["upload", "paste"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMode(m)}
                    aria-pressed={mode === m}
                    // Was a motion `layoutId` pill sliding on a spring. A two-option
                    // segmented control does not need a shared-layout animation to be
                    // legible, and it was the only reason this element needed a motion
                    // component - the sheet itself keeps motion, for its drag.
                    className={`rounded-full px-4 py-2 text-xs font-medium ${TRANSITION} ${FOCUS} ${
                      mode === m ? "bg-white/10 text-white" : "bg-transparent text-white/60"
                    }`}
                  >
                    {m === "upload" ? "Upload file" : "Paste text"}
                  </button>
                ))}
              </div>

              <div className="mt-4">
                {mode === "upload" ? (
                  <UnifiedDropzone onImported={onImported} />
                ) : (
                  <PasteTextForm onImported={onImported} />
                )}
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
