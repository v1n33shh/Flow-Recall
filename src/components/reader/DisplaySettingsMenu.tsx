"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { FONT_FAMILY_CSS, FONT_FAMILY_LABELS, type FontFamilyId } from "@/lib/readerPreferences";

// PERFORMANCE CONTRACT (matches ReaderChrome/DefinitionPopover): every
// animation here touches transform + opacity only. backdrop-blur is static.

export type ZoomControl = {
  percent: number;
  min: number;
  max: number;
  step: number;
  onChange: (percent: number) => void;
};

export type TypographyControl = {
  fontPercent: number;
  onFontPercentChange: (percent: number) => void;
  fontMin: number;
  fontMax: number;
  fontStep: number;
  fontFamily: FontFamilyId;
  onFontFamilyChange: (family: FontFamilyId) => void;
};

const FONT_FAMILY_IDS: FontFamilyId[] = ["serif", "sans", "legible"];

function SliderRow({
  label,
  valueLabel,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  valueLabel: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (next: number) => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between text-xs font-medium text-zinc-400">
        <span>{label}</span>
        <span className="tabular-nums text-zinc-300">{valueLabel}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-2 w-full accent-accent"
      />
    </div>
  );
}

/** The "Aa" display-settings trigger + glassmorphic popover, shared by all
 * three reader views. Content is driven entirely by which optional control
 * group is passed - PDF supplies `zoom` (canvas-rendered text can't be
 * restyled, so font controls would be meaningless there), EPUB/Text supply
 * `typography` (a fixed-layout PDF page has no reflowable font to size). */
export default function DisplaySettingsMenu({
  zoom,
  typography,
}: {
  zoom?: ZoomControl;
  typography?: TypographyControl;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(e: PointerEvent) {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-label="Display settings"
        onClick={() => setOpen((v) => !v)}
        className={`flex h-8 min-w-8 items-center justify-center rounded-full px-1.5 text-zinc-300 transition-colors active:scale-90 ${
          open ? "bg-white/15 text-zinc-100" : "hover:bg-white/10"
        }`}
      >
        <span className="flex items-baseline gap-px font-medium">
          <span className="text-sm">A</span>
          <span className="text-[11px]">a</span>
        </span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            ref={panelRef}
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.97 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            className="absolute right-0 top-[calc(100%+0.5rem)] z-50 w-72 rounded-2xl border border-white/10 bg-surface/90 p-4 text-left shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_20px_60px_-12px_rgba(0,0,0,0.8)] backdrop-blur-xl"
          >
            <div className="flex flex-col gap-4">
              {zoom && (
                <SliderRow
                  label="Zoom"
                  valueLabel={`${Math.round(zoom.percent)}%`}
                  value={zoom.percent}
                  min={zoom.min}
                  max={zoom.max}
                  step={zoom.step}
                  onChange={zoom.onChange}
                />
              )}

              {typography && (
                <>
                  <SliderRow
                    label="Font Size"
                    valueLabel={`${Math.round(typography.fontPercent)}%`}
                    value={typography.fontPercent}
                    min={typography.fontMin}
                    max={typography.fontMax}
                    step={typography.fontStep}
                    onChange={typography.onFontPercentChange}
                  />

                  <div className={zoom ? "border-t border-white/10 pt-4" : ""}>
                    <p className="text-xs font-medium text-zinc-400">Font</p>
                    <div className="mt-2 grid grid-cols-3 gap-1.5">
                      {FONT_FAMILY_IDS.map((id) => {
                        const selected = typography.fontFamily === id;
                        return (
                          <button
                            key={id}
                            type="button"
                            onClick={() => typography.onFontFamilyChange(id)}
                            aria-pressed={selected}
                            className={`flex flex-col items-center gap-1 rounded-xl border px-2 py-2.5 transition-colors ${
                              selected
                                ? "border-accent/50 bg-accent/10 text-accent"
                                : "border-white/10 bg-white/5 text-zinc-400 hover:bg-white/10"
                            }`}
                          >
                            <span style={{ fontFamily: FONT_FAMILY_CSS[id] }} className="text-base leading-none">
                              Aa
                            </span>
                            <span className="text-[10px] font-medium">{FONT_FAMILY_LABELS[id]}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
