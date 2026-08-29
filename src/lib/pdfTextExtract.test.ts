import { describe, expect, it } from "vitest";
import type { PDFDocumentProxy } from "pdfjs-dist";
import {
  assessPdfText,
  blankFilterRemap,
  classifyPdfError,
  extractPdfParagraphsStreaming,
  isBlankParagraph,
} from "./pdfTextExtract";

/** Shifts printable characters up by `by`, leaving spaces alone - the same shape
 * as the Type3-encoded PDFs detectCipherShift rescues. Fixtures need some
 * punctuation: for pure letters, a shift of n and of n+32 both decode to
 * letters (one just changes case), and the detector has no reason to prefer
 * either. Commas and periods only survive one of the two.  */
function cipher(text: string, by = 2): string {
  return [...text]
    .map((ch) => (ch === " " ? " " : String.fromCharCode(ch.charCodeAt(0) + by)))
    .join("");
}

/** A line of \x03 glyph codes: the shape of a paragraph whose Type3 font
 * resources were missing. It is NOT blank before decoding, which is the whole
 * reason the filter has to run after it. */
const MISSING_GLYPHS = "\x03\x03\x03\x03";

function fakeDoc(pages: { text: string; y: number }[][]): PDFDocumentProxy {
  return {
    numPages: pages.length,
    getPage: async (pageNumber: number) => ({
      getTextContent: async () => ({
        items: pages[pageNumber - 1].map((line) => ({
          str: line.text,
          // [,,,scaleY, x, y] - pageParagraphs reads height, x and y from here.
          transform: [12, 0, 0, 12, 40, line.y],
          height: 12,
        })),
      }),
      cleanup: () => {},
    }),
  } as unknown as PDFDocumentProxy;
}

describe("isBlankParagraph", () => {
  it("treats whitespace-only paragraphs as blank", () => {
    expect(isBlankParagraph(" ")).toBe(true);
    expect(isBlankParagraph("   \n ")).toBe(true);
    expect(isBlankParagraph(".")).toBe(false);
    expect(isBlankParagraph(" a ")).toBe(false);
  });
});

describe("blankFilterRemap", () => {
  it("moves an index back by the number of blanks before it", () => {
    const remap = blankFilterRemap([" ", "one", " ", " ", "two", "three"]);
    expect(remap(1)).toBe(0); // "one" is first survivor
    expect(remap(4)).toBe(1); // "two"
    expect(remap(5)).toBe(2); // "three"
  });

  it("sends an index that pointed at a blank to the next survivor", () => {
    const remap = blankFilterRemap(["one", " ", " ", "two"]);
    expect(remap(1)).toBe(1);
    expect(remap(2)).toBe(1);
    expect(remap(3)).toBe(1);
  });

  it("is identity when nothing is blank, and clamps out-of-range input", () => {
    const remap = blankFilterRemap(["a", "b", "c"]);
    expect([0, 1, 2].map(remap)).toEqual([0, 1, 2]);
    expect(remap(99)).toBe(3);
    expect(remap(-5)).toBe(0);
  });
});

describe("extractPdfParagraphsStreaming", () => {
  // Page 1 has a real paragraph then a glyph-code one; page 2 the reverse; page 3
  // is nothing but glyph codes. Lines 100 apart are separate paragraphs (the gap
  // test is 1.5x the 12pt line height).
  const doc = fakeDoc([
    [
      { text: cipher("the quick brown fox, and the lazy dog, sat down. the end of it."), y: 700 },
      { text: MISSING_GLYPHS, y: 600 },
    ],
    [
      { text: MISSING_GLYPHS, y: 700 },
      { text: cipher("another paragraph, with the word the in it, and of course a period."), y: 600 },
    ],
    [{ text: MISSING_GLYPHS, y: 700 }],
  ]);

  it("drops paragraphs that decode to nothing but whitespace", async () => {
    const result = await extractPdfParagraphsStreaming(doc, () => {});
    expect(result.paragraphs).toEqual([
      "the quick brown fox, and the lazy dog, sat down. the end of it.",
      "another paragraph, with the word the in it, and of course a period.",
    ]);
  });

  it("maps each page to its first surviving paragraph, not its raw one", async () => {
    const result = await extractPdfParagraphsStreaming(doc, () => {});
    // Page 2's own first paragraph was dropped, so it points at its second one -
    // index 1 in the filtered array, which would have been 2 unfiltered.
    expect(result.pageToParagraphIndex).toEqual({ 1: 0, 2: 1 });
    // Page 3 survived nothing at all: no entry rather than one pointing past the
    // end of the array.
    expect(result.pageToParagraphIndex[3]).toBeUndefined();
  });

  it("keeps every page's index inside the array it hands back", async () => {
    const result = await extractPdfParagraphsStreaming(doc, () => {});
    for (const index of Object.values(result.pageToParagraphIndex)) {
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(result.paragraphs.length);
    }
  });

  it("streams batches whose paragraphs and indices agree with the final result", async () => {
    const batched: string[] = [];
    const batchedIndex: Record<number, number> = {};
    const result = await extractPdfParagraphsStreaming(doc, (batch) => {
      batched.push(...batch.paragraphs);
      Object.assign(batchedIndex, batch.pageToParagraphIndex);
    });
    expect(batched).toEqual(result.paragraphs);
    expect(batchedIndex).toEqual(result.pageToParagraphIndex);
  });
});

describe("assessPdfText", () => {
  const page = (chars: number) => "x".repeat(chars);

  it("calls a document with no paragraphs at all textless", () => {
    expect(assessPdfText([], 400)).toEqual({ kind: "none" });
    expect(assessPdfText([], undefined)).toEqual({ kind: "none" });
  });

  it("passes a real book, including a sparse one", () => {
    // The chess problems collection: ~860 characters a page, nearly all move
    // notation, and the sparsest real book on hand. It must never be flagged.
    expect(assessPdfText(Array.from({ length: 9006 }, () => page(112)), 1180)).toBeNull();
    // Ordinary prose, ~2800 characters a page.
    expect(assessPdfText(Array.from({ length: 443 }, () => page(2830)), 444)).toBeNull();
  });

  it("flags a scan carrying only a stamped page number per page", () => {
    const verdict = assessPdfText(Array.from({ length: 400 }, () => page(4)), 400);
    expect(verdict).toEqual({ kind: "sparse", words: 320, pages: 400 });
  });

  it("exempts documents too short to be a book", () => {
    // A one-page receipt is legitimately a handful of words.
    expect(assessPdfText([page(20)], 1)).toBeNull();
    expect(assessPdfText([page(20)], 4)).toBeNull();
  });

  it("has no verdict when the page count is unknown but text exists", () => {
    expect(assessPdfText([page(20)], undefined)).toBeNull();
  });
});

describe("classifyPdfError", () => {
  it("tells a locked PDF apart from a broken one", () => {
    const password = Object.assign(new Error("No password given"), { name: "PasswordException" });
    const invalid = Object.assign(new Error("Invalid PDF structure"), { name: "InvalidPDFException" });
    expect(classifyPdfError(password).reason).toBe("password");
    expect(classifyPdfError(invalid).reason).toBe("invalid");
    expect(classifyPdfError(new Error("something else")).reason).toBe("unknown");
    expect(classifyPdfError("a string").reason).toBe("unknown");
  });

  it("keeps the underlying message for the console", () => {
    expect(classifyPdfError(new Error("boom")).message).toBe("boom");
  });
});
