"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { FONT_FAMILY_CSS, FONT_FAMILY_LABELS, type FontFamilyId } from "@/lib/readerPreferences";
import {
  DIM_MAX,
  DIM_MIN,
  DIM_STEP,
  eyeFilterColor,
  isEyeFilterActive,
  useEyeFilter,
  WARMTH_IDS,
  WARMTH_LABELS,
} from "@/lib/eyeFilter";

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
  // Not a prop: the filter applies to every reader type identically, so there is
  // nothing for a view to configure. Both this menu and ReaderChrome's overlay
  // read the same store - see eyeFilter.ts.
  const [eyeFilter, setEyeFilter] = useEyeFilter();
  const filterOn = isEyeFilterActive(eyeFilter);

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
        className={`relative flex h-8 min-w-8 items-center justify-center rounded-full px-1.5 text-foreground transition-colors active:scale-90 ${
          open ? "bg-foreground/15" : "hover:bg-foreground/10"
        }`}
      >
        <span className="flex items-baseline gap-px font-medium">
          <span className="text-sm">A</span>
          <span className="text-[11px]">a</span>
        </span>
        {/* Without this, a warm screen has no explanation on it anywhere - the
            filter is a global setting adjusted behind a menu, so someone
            returning to the app tomorrow would just find their reader tinted.
            The dot is under the overlay like everything else, so it wears the
            filter's own colour, which is the point. */}
        {filterOn && (
          <span
            aria-hidden="true"
            className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-accent ring-2 ring-surface"
          />
        )}
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
              className="no-scrollbar absolute right-0 top-[calc(100%+0.5rem)] z-50 max-h-[calc(100vh-8rem)] w-72 overflow-y-auto rounded-2xl border border-border bg-surface/90 p-4 text-left shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_20px_60px_-12px_rgba(0,0,0,0.8)] backdrop-blur-xl"
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

                {/* Eye Filter, last: it is the only setting here about the room
                    rather than the book, and it is the one that changes every
                    other control's appearance while you use it. Present on
                    every reader type - unlike the sections above it takes no
                    props, because there is nothing type-specific to configure. */}
                <div className="border-t border-border pt-4">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-medium text-muted-foreground">Eye Filter</p>
                    {filterOn && (
                      <button
                        type="button"
                        onClick={() => setEyeFilter({ warmth: "off", dim: DIM_MIN })}
                        className="-my-0.5 rounded-lg px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground active:scale-95"
                      >
                        Reset
                      </button>
                    )}
                  </div>

                  {/* Each swatch is painted in the exact colour that step
                      multiplies the screen by, so the choice is shown rather
                      than described. They sit under the overlay like everything
                      else, so once a filter is on they all warm together - the
                      difference BETWEEN them is what stays readable. */}
                  <div className="mt-2 grid grid-cols-4 gap-1.5">
                    {WARMTH_IDS.map((id) => {
                      const selected = eyeFilter.warmth === id;
                      return (
                        <button
                          key={id}
                          type="button"
                          onClick={() => setEyeFilter({ warmth: id })}
                          aria-pressed={selected}
                          className={`flex flex-col items-center gap-1.5 rounded-xl border px-1 py-2 transition-colors ${
                            selected
                              ? "border-accent/50 bg-accent/10 text-accent"
                              : "border-border bg-foreground/5 text-muted-foreground hover:bg-foreground/10"
                          }`}
                        >
                          <span
                            aria-hidden="true"
                            className="h-1.5 w-full rounded-full"
                            style={{ backgroundColor: eyeFilterColor({ warmth: id, dim: DIM_MIN }) ?? "rgb(255, 255, 255)" }}
                          />
                          <span className="text-[10px] font-medium leading-none">{WARMTH_LABELS[id]}</span>
                        </button>
                      );
                    })}
                  </div>

                  <div className="mt-3">
                    <StepperRow
                      label="Dim"
                      value={eyeFilter.dim}
                      min={DIM_MIN}
                      max={DIM_MAX}
                      step={DIM_STEP}
                      onChange={(next) => setEyeFilter({ dim: next })}
                    />
                  </div>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
