"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { FONT_FAMILY_CSS, FONT_FAMILY_LABELS, type FontFamilyId } from "@/lib/readerPreferences";

export type ZoomControl = {
  percent: number;
  min: number;
  max: number;
  step: number;
  onChange: (percent: number) => void;
};

export type ViewModeControl = {
  mode: "original" | "reflow";
  onModeChange: (mode: "original" | "reflow") => void;
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

export type LayoutControl = {
  mode: "paginated" | "scrolling";
  onModeChange: (mode: "paginated" | "scrolling") => void;
};

const FONT_FAMILY_IDS: FontFamilyId[] = ["serif", "sans", "legible"];
const LAYOUT_MODES: { id: "paginated" | "scrolling"; label: string }[] = [
  { id: "paginated", label: "Paginated" },
  { id: "scrolling", label: "Scrolling" },
];

function StepperRow({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (next: number) => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <div className="flex items-center gap-0.5 rounded-full border border-border bg-foreground/5 p-0.5">
        <button
          type="button"
          aria-label={`Decrease ${label.toLowerCase()}`}
          onClick={() => onChange(Math.max(min, value - step))}
          disabled={value <= min}
          className="flex h-7 w-7 items-center justify-center rounded-full text-foreground transition-colors hover:bg-foreground/10 active:scale-90 disabled:opacity-30"
        >
          <span className="text-base leading-none">−</span>
        </button>
        <span className="w-11 text-center text-xs font-medium tabular-nums text-foreground">
          {Math.round(value)}%
        </span>
        <button
          type="button"
          aria-label={`Increase ${label.toLowerCase()}`}
          onClick={() => onChange(Math.min(max, value + step))}
          disabled={value >= max}
          className="flex h-7 w-7 items-center justify-center rounded-full text-foreground transition-colors hover:bg-foreground/10 active:scale-90 disabled:opacity-30"
        >
          <span className="text-base leading-none">+</span>
        </button>
      </div>
    </div>
  );
}

export default function DisplaySettingsMenu({
  zoom,
  typography,
  layout,
  viewMode,
}: {
  zoom?: ZoomControl;
  typography?: TypographyControl;
  layout?: LayoutControl;
  viewMode?: ViewModeControl;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  return (
    <div className="relative">
      <button
        type="button"
        aria-label="Display settings"
        onClick={() => setOpen((v) => !v)}
        className={`flex h-8 min-w-8 items-center justify-center rounded-full px-1.5 text-foreground transition-colors active:scale-90 ${
          open ? "bg-foreground/15" : "hover:bg-foreground/10"
        }`}
      >
        <span className="flex items-baseline gap-px font-medium">
          <span className="text-sm">A</span>
          <span className="text-[11px]">a</span>
        </span>
      </button>

      <AnimatePresence>
        {open && (
          <>
            <div
              className="fixed inset-0 z-40 bg-transparent"
              onClick={() => setOpen(false)}
            />
            <motion.div
              initial={{ opacity: 0, y: -6, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -6, scale: 0.97 }}
              transition={{ duration: 0.15, ease: "easeOut" }}
              className="absolute right-0 top-[calc(100%+0.5rem)] z-50 w-72 rounded-2xl border border-border bg-surface/90 p-4 text-left shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_20px_60px_-12px_rgba(0,0,0,0.8)] backdrop-blur-xl"
            >
              <div className="flex flex-col gap-4">
                {viewMode && (
                  <div className="flex items-center gap-1 rounded-full border border-border bg-foreground/5 p-1">
                    <button
                      type="button"
                      onClick={() => {
                        viewMode.onModeChange("original");
                        setOpen(false);
                      }}
                      className={`flex-1 rounded-full py-1.5 text-xs font-medium transition-colors ${
                        viewMode.mode === "original"
                          ? "bg-foreground/10 text-foreground"
                          : "text-muted-foreground hover:bg-foreground/5"
                      }`}
                    >
                      Original Layout
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        viewMode.onModeChange("reflow");
                        setOpen(false);
                      }}
                      className={`flex-1 rounded-full py-1.5 text-xs font-medium transition-colors ${
                        viewMode.mode === "reflow"
                          ? "bg-foreground/10 text-foreground"
                          : "text-muted-foreground hover:bg-foreground/5"
                      }`}
                    >
                      Reflow Text
                    </button>
                  </div>
                )}

                {zoom && (
                  <StepperRow
                    label="Zoom"
                    value={zoom.percent}
                    min={zoom.min}
                    max={zoom.max}
                    step={zoom.step}
                    onChange={zoom.onChange}
                  />
                )}

                {typography && (
                  <>
                    <StepperRow
                      label="Font Size"
                      value={typography.fontPercent}
                      min={typography.fontMin}
                      max={typography.fontMax}
                      step={typography.fontStep}
                      onChange={typography.onFontPercentChange}
                    />

                    <div className={zoom ? "border-t border-border pt-4" : ""}>
                      <p className="text-xs font-medium text-muted-foreground">Font</p>
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
                                  : "border-border bg-foreground/5 text-muted-foreground hover:bg-foreground/10"
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

                {layout && (
                  <div className="border-t border-border pt-4">
                    <p className="text-xs font-medium text-muted-foreground">Layout</p>
                    <div className="mt-2 grid grid-cols-2 gap-1.5">
                      {LAYOUT_MODES.map(({ id, label }) => {
                        const selected = layout.mode === id;
                        return (
                          <button
                            key={id}
                            type="button"
                            onClick={() => {
                              layout.onModeChange(id);
                              setOpen(false);
                            }}
                            aria-pressed={selected}
                            className={`rounded-xl border px-2 py-2.5 text-xs font-medium transition-colors ${
                              selected
                                ? "border-accent/50 bg-accent/10 text-accent"
                                : "border-border bg-foreground/5 text-muted-foreground hover:bg-foreground/10"
                            }`}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
