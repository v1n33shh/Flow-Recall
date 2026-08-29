export type FontFamilyId = "serif" | "sans" | "legible";
export type EpubScrollMode = "paginated" | "scrolling";

/** Same "paginated" | "scrolling" shape as EpubScrollMode, kept as its own
 * named type since it's independently toggleable for the plain-text reader. */
export type TextLayoutMode = "paginated" | "scrolling";
export type PdfViewMode = "original" | "reflow";

/** How the library grid orders its books. Not a reading preference as such,
 * but it lives here for the same reason the others do: it is one global choice
 * the user makes once and expects to still be there tomorrow. */
export type LibrarySort = "recent" | "title" | "progress";
export type PdfReflowLayoutMode = "paginated" | "scrolling";

export type ReaderPreferences = {
  fontPercent: number;
  fontFamily: FontFamilyId;
  epubScrollMode: EpubScrollMode;
  textLayoutMode: TextLayoutMode;
  pdfViewMode: PdfViewMode;
  pdfReflowLayoutMode: PdfReflowLayoutMode;
  librarySort: LibrarySort;
};

const STORAGE_KEY = "flowrecall:reader-prefs";

// Single source of truth for the font-size stepper's range (DisplaySettingsMenu)
// and every reader view that reports its bounds to it.
export const FONT_PERCENT_MIN = 80;
export const FONT_PERCENT_MAX = 160;
export const FONT_PERCENT_STEP = 2;

// Matches the reading experience every existing user already has (Georgia
// serif at 112%, paginated) - upgrading to this preference store causes zero
// visual change until someone actually opens the new Display Settings menu.
// textLayoutMode defaults to "scrolling" (not "paginated" like EPUB) since
// every pasted note that already exists was written to plain vertical scroll -
// flipping the default would silently change how existing notes read.
const DEFAULTS: ReaderPreferences = {
  fontPercent: 112,
  fontFamily: "serif",
  epubScrollMode: "paginated",
  textLayoutMode: "scrolling",
  pdfViewMode: "original",
  pdfReflowLayoutMode: "paginated",
  // Recently read first, which is where a reader almost always wants to
  // continue. It also replaces what the grid did before this preference
  // existed: IndexedDB's own key order, which is random UUID order.
  librarySort: "recent",
};

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

function isEpubScrollMode(value: unknown): value is EpubScrollMode {
  return value === "paginated" || value === "scrolling";
}

function isTextLayoutMode(value: unknown): value is TextLayoutMode {
  return value === "paginated" || value === "scrolling";
}

function isLibrarySort(value: unknown): value is LibrarySort {
  return value === "recent" || value === "title" || value === "progress";
}

function isPdfViewMode(value: unknown): value is PdfViewMode {
  return value === "original" || value === "reflow";
}

function isPdfReflowLayoutMode(value: unknown): value is PdfReflowLayoutMode {
  return value === "paginated" || value === "scrolling";
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
      epubScrollMode: isEpubScrollMode(parsed.epubScrollMode) ? parsed.epubScrollMode : DEFAULTS.epubScrollMode,
      textLayoutMode: isTextLayoutMode(parsed.textLayoutMode) ? parsed.textLayoutMode : DEFAULTS.textLayoutMode,
      pdfViewMode: isPdfViewMode(parsed.pdfViewMode) ? parsed.pdfViewMode : DEFAULTS.pdfViewMode,
      pdfReflowLayoutMode: isPdfReflowLayoutMode(parsed.pdfReflowLayoutMode) ? parsed.pdfReflowLayoutMode : DEFAULTS.pdfReflowLayoutMode,
      librarySort: isLibrarySort(parsed.librarySort) ? parsed.librarySort : DEFAULTS.librarySort,
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
