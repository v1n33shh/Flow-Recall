"use client";

import { useCallback, useSyncExternalStore } from "react";
import { getReaderPreferences, setReaderPreferences } from "./readerPreferences";

/** How much blue the filter takes out. Named steps rather than a free slider:
 * warmth is a taste setting someone picks once, and four labelled stops are
 * one tap each on a phone where a slider is a drag with no detents. */
export type EyeFilterWarmth = "off" | "soft" | "warm" | "amber";

export const WARMTH_IDS: EyeFilterWarmth[] = ["off", "soft", "warm", "amber"];

export const WARMTH_LABELS: Record<EyeFilterWarmth, string> = {
  off: "Off",
  soft: "Soft",
  warm: "Warm",
  amber: "Amber",
};

/** Fraction of the way to FULL_WARM for each step. */
const WARMTH_FACTOR: Record<EyeFilterWarmth, number> = {
  off: 0,
  soft: 0.34,
  warm: 0.67,
  amber: 1,
};

/** The multiply colour at full warmth - roughly a 2700K white point measured
 * against the panel's native ~6500K, which is where a warm bulb sits. Red is
 * left untouched and blue is cut hardest; that ordering IS the filter. Going
 * further (a 1900K candle point) turns prose orange and stops reading as a
 * comfort setting. */
const FULL_WARM = { r: 255, g: 190, b: 140 } as const;

/** Dim is what the OS brightness slider runs out of: on a dark page in a dark
 * room, Android's minimum is still brighter than comfortable.
 *
 * The 50% cap is a measured legibility floor, not a round number. Body text is
 * #FAFAFA on #050505, 19.6:1. Multiplying by 0.5 lands it at 5.0:1 - still past
 * WCAG AA for body copy. 55% drops it to 4.1:1 and 60% to 3.4:1, so the cap is
 * the last step at which the darkest NON-amber setting still clears AA. Amber
 * plus a full 50% dim does land at ~3.5:1; that combination is a deliberate,
 * one-tap-reversible choice by someone who has explicitly asked for a dimmer
 * page, and it is disclosed rather than prevented. */
export const DIM_MIN = 0;
export const DIM_MAX = 50;
export const DIM_STEP = 5;

export type EyeFilterState = {
  warmth: EyeFilterWarmth;
  /** 0-60, percent of black laid over the page. */
  dim: number;
};

export function isEyeFilterWarmth(value: unknown): value is EyeFilterWarmth {
  return value === "off" || value === "soft" || value === "warm" || value === "amber";
}

export function clampDim(value: number): number {
  if (!Number.isFinite(value)) return DIM_MIN;
  return Math.min(DIM_MAX, Math.max(DIM_MIN, Math.round(value)));
}

/** The single `mix-blend-mode: multiply` colour that applies BOTH warmth and
 * dim, or null when the filter is off and nothing should render at all.
 *
 * One multiply layer rather than a tinted translucent one, because multiply is
 * what a real filter over a screen does: it scales each channel down, so warm
 * whites go cream and blacks stay black. A plain `rgba` amber overlay would
 * instead *raise* the black level and leave the page milky grey - the opposite
 * of restful on a near-black reader.
 *
 * Dimming falls out of the same multiply for free: scaling all three channels
 * darkens the light text while the near-black background has nothing left to
 * lose, so contrast drops as the page dims. That is the effect wanted - a
 * 19:1 page is what glares at 2am - and it is why dim is capped. */
export function eyeFilterColor(state: EyeFilterState): string | null {
  const w = WARMTH_FACTOR[state.warmth] ?? 0;
  const d = clampDim(state.dim) / 100;
  if (w === 0 && d === 0) return null;

  const scale = 1 - d;
  const r = Math.round(255 * scale);
  const g = Math.round((255 - (255 - FULL_WARM.g) * w) * scale);
  const b = Math.round((255 - (255 - FULL_WARM.b) * w) * scale);
  return `rgb(${r}, ${g}, ${b})`;
}

export function isEyeFilterActive(state: EyeFilterState): boolean {
  return eyeFilterColor(state) !== null;
}

// ---------------------------------------------------------------------------
// Shared reactive state.
//
// The controls live in DisplaySettingsMenu (inside the reader's header) and the
// overlay lives in ReaderChrome - siblings, not parent and child. Rather than
// thread a filter prop through all three reader views that sit between them,
// both read this store. That also keeps the setting where every other reading
// preference already is (localStorage, via readerPreferences).
// ---------------------------------------------------------------------------

const listeners = new Set<() => void>();

/** Cached so getSnapshot returns a STABLE reference between changes.
 * useSyncExternalStore compares by identity, so rebuilding this object from
 * localStorage on every call is an infinite render loop - the exact trap this
 * codebase has hit twice before (see storage.ts). */
let snapshot: EyeFilterState | null = null;

/** Module-level constant, not a fresh object: same identity requirement as
 * above, and the server has no localStorage to read anyway. */
const SERVER_SNAPSHOT: EyeFilterState = { warmth: "off", dim: DIM_MIN };

function readSnapshot(): EyeFilterState {
  if (snapshot === null) {
    const prefs = getReaderPreferences();
    snapshot = { warmth: prefs.eyeFilterWarmth, dim: clampDim(prefs.eyeFilterDim) };
  }
  return snapshot;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setEyeFilter(partial: Partial<EyeFilterState>): void {
  const next: EyeFilterState = { ...readSnapshot(), ...partial };
  next.dim = clampDim(next.dim);
  snapshot = next;
  setReaderPreferences({ eyeFilterWarmth: next.warmth, eyeFilterDim: next.dim });
  for (const listener of listeners) listener();
}

/** Live filter state plus its setter. Reads synchronously, so the reader's very
 * first paint is already filtered - no flash of an unfiltered page. */
export function useEyeFilter(): [EyeFilterState, (partial: Partial<EyeFilterState>) => void] {
  const state = useSyncExternalStore(subscribe, readSnapshot, () => SERVER_SNAPSHOT);
  const set = useCallback((partial: Partial<EyeFilterState>) => setEyeFilter(partial), []);
  return [state, set];
}
