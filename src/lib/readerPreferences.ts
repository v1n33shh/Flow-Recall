export type FontFamilyId = "serif" | "sans" | "legible";

export type ReaderPreferences = {
  fontPercent: number;
  fontFamily: FontFamilyId;
};

const STORAGE_KEY = "flowrecall:reader-prefs";

// Matches the reading experience every existing user already has (Georgia
// serif at 112%) - upgrading to this preference store causes zero visual
// change until someone actually opens the new Display Settings menu.
const DEFAULTS: ReaderPreferences = { fontPercent: 112, fontFamily: "serif" };

// EPUB content renders inside epub.js's own sandboxed iframe documents,
// which do NOT inherit the parent document's CSS custom properties or
// next/font's self-hosted @font-face rules - only a real stylesheet link,
// re-injected into each iframe's own <head>, reaches it (see
// EpubReaderView's "rendered" handler). A plain Google Fonts link shared by
// both the main document (layout.tsx) and every epub iframe keeps "Modern
// Sans"/"Legible" identical everywhere, at the cost of not self-hosting
// these two specific fonts the way next/font otherwise would.
export const READER_FONTS_HREF =
  "https://fonts.googleapis.com/css2?family=Inter:wght@400;600&family=Atkinson+Hyperlegible&display=swap";

/** CSS font-family values for each option - literal names only (no
 * CSS-variable indirection), since a var() referencing a custom property
 * that only exists on the main document's <html> resolves to nothing inside
 * an epub.js content iframe, invalidating the whole font-family value. */
export const FONT_FAMILY_CSS: Record<FontFamilyId, string> = {
  serif: "Georgia, Cambria, 'Times New Roman', serif",
  sans: "'Inter', system-ui, sans-serif",
  legible: "'Atkinson Hyperlegible', sans-serif",
};

export const FONT_FAMILY_LABELS: Record<FontFamilyId, string> = {
  serif: "Classic Serif",
  sans: "Modern Sans",
  legible: "Legible",
};

function isFontFamilyId(value: unknown): value is FontFamilyId {
  return value === "serif" || value === "sans" || value === "legible";
}

/** Global, cross-book reading preference - deliberately NOT stored per-book
 * in IndexedDB (see readerStorage.ts) since typography taste is personal and
 * expected to carry across every book, unlike PDF zoom which stays per-book
 * (different PDFs have different native page sizes). Reads synchronously so
 * a reader view's very first render already has the right values. */
export function getReaderPreferences(): ReaderPreferences {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw);
    return {
      fontPercent: typeof parsed.fontPercent === "number" ? parsed.fontPercent : DEFAULTS.fontPercent,
      fontFamily: isFontFamilyId(parsed.fontFamily) ? parsed.fontFamily : DEFAULTS.fontFamily,
    };
  } catch {
    return DEFAULTS;
  }
}

export function setReaderPreferences(partial: Partial<ReaderPreferences>): void {
  if (typeof window === "undefined") return;
  const next = { ...getReaderPreferences(), ...partial };
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}
