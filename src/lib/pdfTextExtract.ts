import type { PDFDocumentProxy } from "pdfjs-dist";
import type { TextItem } from "pdfjs-dist/types/src/display/api";

export function decryptText(raw: string, shift: number): string {
  if (shift === 0) return raw;
  let decrypted = "";
  for (let j = 0; j < raw.length; j++) {
    const charCode = raw.charCodeAt(j);
    if (charCode === 32 || charCode === 3) {
      decrypted += " ";
    } else {
      decrypted += String.fromCharCode(charCode - shift);
    }
  }
  return decrypted
    .replace(/[\x00-\x09\x0B-\x1F\x7F-\x9F]/g, "")
    .replace(/\x03/g, " ");
}

export function formatChapterTitle(raw: string): string {
  const clean = raw.replace(/\s+/g, " ").trim();
  if (clean === clean.toLowerCase() || clean === clean.toUpperCase()) {
    return clean
      .toLowerCase()
      .replace(/(?:^|\s|-)\S/g, (m) => m.toUpperCase());
  }
  return clean;
}

type PdfOutlineNode = {
  title?: string;
  dest?: unknown;
  items?: PdfOutlineNode[];
};

export type PdfTocEntry = {
  id: string;
  title: string;
  pageNum: number;
  paragraphIndex: number;
  level: number;
};

export type PdfExtractResult = {
  paragraphs: string[];
  pageToParagraphIndex: Record<number, number>;
};

export async function extractPdfToc(
  doc: PDFDocumentProxy,
  pageToParagraphIndex: Record<number, number> = {}
): Promise<PdfTocEntry[]> {
  const entries: PdfTocEntry[] = [];

  function getParagraphIdx(pageNum: number): number {
    if (typeof pageToParagraphIndex[pageNum] === "number") {
      return pageToParagraphIndex[pageNum];
    }
    // Find closest page <= pageNum
    let closest = 0;
    for (const [p, idx] of Object.entries(pageToParagraphIndex)) {
      const pNum = Number(p);
      if (pNum <= pageNum && idx > closest) {
        closest = idx;
      }
    }
    return closest;
  }

  // 1. Attempt PDF.js native outline extraction
  try {
    const outline = await doc.getOutline();
    if (outline && outline.length > 0) {
      async function processNodes(nodes: PdfOutlineNode[], level: number = 0) {
        for (const node of nodes) {
          if (!node.title) continue;
          let pageNum = 1;

          if (node.dest) {
            try {
              let destRef: unknown = node.dest;
              if (typeof destRef === "string") {
                destRef = await doc.getDestination(destRef);
              }
              if (Array.isArray(destRef) && destRef.length > 0) {
                const pageIdx = await doc.getPageIndex(destRef[0]);
                pageNum = pageIdx + 1;
              } else if (typeof destRef === "number") {
                pageNum = destRef + 1;
              }
            } catch {
              // Resolution fallback
            }
          }

          const rawTitle = node.title.replace(/\s+/g, " ").trim();
          const shift = detectCipherShift(rawTitle) || 0;
          const cleanTitle = shift !== 0 ? decryptText(rawTitle, shift) : rawTitle;

          entries.push({
            id: `outline_${entries.length}_p${pageNum}`,
            title: formatChapterTitle(cleanTitle),
            pageNum,
            paragraphIndex: getParagraphIdx(pageNum),
            level: Math.min(level, 2),
          });

          if (node.items && node.items.length > 0) {
            await processNodes(node.items, level + 1);
          }
        }
      }

      await processNodes(outline, 0);
    }
  } catch (err) {
    console.warn("Error extracting PDF outline:", err);
  }

  // 2. Text scanning, for PDFs whose own outline is missing or too thin to
  // navigate by. This is the expensive half of TOC extraction - it re-reads
  // page text that reflow extraction has already read once, ~4s on a 444-page
  // book - and it was tempting to tighten. It is left alone deliberately:
  // it already runs strictly behind an already-readable book, and its result is
  // now cached alongside the text (see PdfReaderView), so the cost is paid once
  // per book ever rather than on every open. Narrowing the gate or the page cap
  // measurably cost real chapter entries on the user's own 444-page PDF while
  // saving time nobody was waiting on.
  const isOutlineSparse = entries.length < Math.min(5, Math.ceil(doc.numPages / 5));

  if (entries.length === 0 || isOutlineSparse) {
    const chapterRegex = /^(?:chapter|discourse|talk|lecture|part|section|book|contents|index|preface|introduction|foreword|epilogue)\b/i;
    const chapterNumRegex = /^(?:chapter|discourse|talk|lecture|part|section)\s+(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|[ivxlcdm]+)/i;

    const maxScanPages = Math.min(doc.numPages, 500);

    for (let pageNum = 1; pageNum <= maxScanPages; pageNum++) {
      try {
        const page = await doc.getPage(pageNum);
        const textContent = await page.getTextContent();
        const items = textContent.items.filter((item): item is TextItem => "str" in item);
        if (items.length === 0) continue;

        const lineTexts: string[] = [];
        let curLine = "";
        let lastY: number | null = null;

        for (const item of items) {
          const y = item.transform[5];
          if (lastY !== null && Math.abs(y - lastY) > 2) {
            if (curLine.trim().length > 0) lineTexts.push(curLine.trim());
            curLine = "";
          }
          curLine += item.str;
          lastY = y;
        }
        if (curLine.trim().length > 0) lineTexts.push(curLine.trim());

        for (let i = 0; i < Math.min(lineTexts.length, 6); i++) {
          const line = lineTexts[i];
          const shift = detectCipherShift(line) || 0;
          const decLine = shift !== 0 ? decryptText(line, shift) : line;
          const cleanLine = decLine.replace(/\s+/g, " ").trim();

          if (cleanLine.length >= 4 && cleanLine.length <= 80) {
            if (
              chapterRegex.test(cleanLine) ||
              chapterNumRegex.test(cleanLine)
            ) {
              if (!entries.some((e) => e.pageNum === pageNum)) {
                entries.push({
                  id: `heading_${pageNum}_${entries.length}`,
                  title: formatChapterTitle(cleanLine),
                  pageNum,
                  paragraphIndex: getParagraphIdx(pageNum),
                  level: 0,
                });
              }
              break;
            }
          }
        }
      } catch {
        // Continue
      }

      if (pageNum % 25 === 0) {
        await new Promise((res) => setTimeout(res, 0));
      }
    }
  }

  // Sort all entries by page number
  entries.sort((a, b) => a.pageNum - b.pageNum);

  return entries;
}

/** Bumped whenever paragraph reconstruction or cipher-shift resolution changes,
 * so readerStorage's cache invalidates instead of serving text this code would
 * no longer produce.
 *
 * v2 drops paragraphs that decode to nothing but whitespace. A v1 record does
 * not have to be re-extracted to become a v2 one - the surviving paragraphs are
 * byte-identical, so filtering the old array in place produces exactly what a
 * fresh extraction would (see blankFilterRemap, which is also what keeps saved
 * positions and highlights pointing at the same words across the upgrade). */
export const PDF_EXTRACT_VERSION = 2;

/** A paragraph with no visible characters. These come from the same missing
 * Type3 font resources the cipher decoder exists to work around: pdf.js hands
 * back glyph codes it cannot map, and once decoded and stripped of control
 * characters some paragraphs have nothing left. On the user's 444-page Osho PDF
 * that was 885 of 1328 paragraphs - two thirds of the book rendering as empty
 * `<p>` elements with a 24px margin each, which is what made page turns crawl
 * through whitespace. */
export function isBlankParagraph(paragraph: string): boolean {
  return paragraph.trim().length === 0;
}

/** Maps an index into a pre-v2 (unfiltered) paragraph array to its index in the
 * filtered one: the number of surviving paragraphs before it. An index that
 * pointed AT a blank paragraph lands on the next surviving one, which is where a
 * reader resuming there wants to be anyway.
 *
 * Used both to upgrade a cached record and to move every saved reading position,
 * highlight and TOC anchor with it. */
export function blankFilterRemap(unfiltered: string[]): (index: number) => number {
  const remapped = new Int32Array(unfiltered.length + 1);
  let kept = 0;
  for (let i = 0; i < unfiltered.length; i++) {
    remapped[i] = kept;
    if (!isBlankParagraph(unfiltered[i])) kept++;
  }
  remapped[unfiltered.length] = kept;
  return (index) => remapped[Math.max(0, Math.min(index, unfiltered.length))];
}

export type PdfExtractBatch = {
  /** Decoded paragraphs from this batch, to append to whatever is on screen. */
  paragraphs: string[];
  /** 1-based page number -> index of its first paragraph, for this batch's pages. */
  pageToParagraphIndex: Record<number, number>;
  pagesDone: number;
  totalPages: number;
  done: boolean;
};

/** A PDF whose text couldn't be recovered, and why. `none` is a fact - pdf.js
 * found no text layer at all, which is what a scan looks like. `sparse` is a
 * judgement: there IS text, just far too little of it to be the book, so the
 * reader is offered the message AND the book. */
export type TextlessPdf = { kind: "none" } | { kind: "sparse"; words: number; pages: number };

// Below this, a document is almost certainly page-scan images with a few stamped
// characters per page rather than prose. Chosen with a wide margin: the sparsest
// real book in testing (a chess problems collection, nearly all move notation)
// still runs at ~860 characters a page.
const SPARSE_CHARS_PER_PAGE = 100;
// Short documents are exempt: a one-page receipt or a cover sheet is legitimately
// a handful of words, and there is no book for it to be missing.
const SPARSE_MIN_PAGES = 5;

export function assessPdfText(paragraphs: string[], pageCount: number | undefined): TextlessPdf | null {
  if (paragraphs.length === 0) return { kind: "none" };
  if (!pageCount || pageCount < SPARSE_MIN_PAGES) return null;
  const chars = paragraphs.reduce((sum, paragraph) => sum + paragraph.length, 0);
  if (chars / pageCount >= SPARSE_CHARS_PER_PAGE) return null;
  // ~5 characters a word including its space - close enough for "about N words".
  return { kind: "sparse", words: Math.max(1, Math.round(chars / 5)), pages: pageCount };
}

/** Messages between the reader (src/lib/pdfExtractClient.ts) and the extraction
 * worker (src/workers/pdfExtract.worker.ts).
 *
 * They live here, in the one module both sides already import, so neither side
 * has to import the other: the client is what holds the `new Worker(...)`
 * reference, and a worker importing the client would bundle a reference to
 * itself. */
export type PdfExtractRequest = {
  /** The book's own file. Blobs are structured-cloneable, so this hands the
   * worker the bytes without the main thread ever reading them into an
   * ArrayBuffer of its own. */
  file: File;
  /** Absolute, because a worker resolves relative URLs against its own script
   * rather than the document. */
  workerSrc: string;
  cMapUrl: string;
  standardFontDataUrl: string;
};

export type PdfExtractResponse =
  | ({ type: "batch" } & PdfExtractBatch)
  | { type: "toc"; toc: PdfTocEntry[] }
  | ({ type: "error" } & PdfExtractFailure);

/** Why a document couldn't be read. `password` and `invalid` are worth telling
 * the reader apart: one is a file they can fix, the other is a file that is
 * broken, and calling the first one "corrupted" sends someone off deleting a
 * perfectly good book. */
export type PdfExtractFailure = {
  reason: "password" | "invalid" | "unknown";
  message: string;
};

/** pdf.js throws named exception objects (PasswordException, InvalidPDFException
 * and friends) rather than typed classes we can instanceof across a worker
 * boundary, so this reads the name. */
export function classifyPdfError(error: unknown): PdfExtractFailure {
  const name =
    error && typeof error === "object" && "name" in error ? String((error as { name: unknown }).name) : "";
  const message = error instanceof Error ? error.message : String(error);
  if (name === "PasswordException") return { reason: "password", message };
  if (name === "InvalidPDFException") return { reason: "invalid", message };
  return { reason: "unknown", message };
}

// The first batch is deliberately tiny: it is the only thing standing between
// tapping a book and seeing words. Text extraction measures ~9ms/page on a
// laptop and roughly 12x that on a mid-range phone, so 12 pages is a second or
// two on the phone against 75s+ for a whole 444-page book - which is the entire
// point of streaming rather than extracting everything up front.
const FIRST_BATCH_PAGES = 12;
// Later batches trade latency for throughput; nobody is waiting on them.
const LATER_BATCH_PAGES = 40;
// How many of the first batch's paragraphs get a vote on the document's
// fallback shift (see decodeBatch).
const SHIFT_VOTE_PARAGRAPHS = 60;

type RawLine = { y: number; items: TextItem[]; height: number };

const ASCII_BLANKS = /[ \t\n\r\f\v]+/g;
/** All whitespace, Unicode included - safe only after decoding. */
const ANY_BLANKS = /\s+/g;

function collapseAsciiBlanks(text: string): string {
  return text.replace(ASCII_BLANKS, " ").trim();
}

/** Final tidy-up for a paragraph whose shift is already resolved: now that no
 * character still stands for a letter, Unicode whitespace can be collapsed. */
function finishParagraph(text: string): string {
  return text.replace(ANY_BLANKS, " ").trim();
}

/** Groups one page's positioned text items into paragraphs. No decoding here -
 * this is purely geometric, because PDFs carry no paragraph markup at all:
 * items sharing a baseline (within 2pt) form a line, and a vertical gap wider
 * than 1.5x the taller of the two neighbouring line-heights ends a paragraph. */
function pageParagraphs(items: TextItem[]): string[] {
  const lines: RawLine[] = [];

  for (const item of items) {
    const y = item.transform[5];
    const height = item.height || item.transform[3] || 12;

    let merged = false;
    for (const line of lines) {
      if (Math.abs(line.y - y) < 2) {
        line.items.push(item);
        line.height = Math.max(line.height, height);
        merged = true;
        break;
      }
    }
    if (!merged) lines.push({ y, items: [item], height });
  }

  // PDF y grows upward, so reading order is descending y; within a line,
  // ascending x.
  lines.sort((a, b) => b.y - a.y);
  for (const line of lines) line.items.sort((a, b) => a.transform[4] - b.transform[4]);

  const paragraphs: string[] = [];
  let current: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const lineText = lines[i].items.map((item) => item.str).join("");
    if (lineText.replace(ASCII_BLANKS, "").length === 0) continue;
    current.push(lineText);

    let isBreak = i === lines.length - 1;
    if (!isBreak) {
      const gap = lines[i].y - lines[i + 1].y;
      const threshold = Math.max(lines[i].height, lines[i + 1].height) * 1.5;
      if (gap > threshold) isBreak = true;
    }

    if (isBreak) {
      // ASCII blanks only, deliberately. A Caesar-shifted glyph code can land on
      // a Unicode space (a 'y' at shift 39 becomes U+00A0), and /\s+/ would
      // collapse it into a real space - destroying that letter before the
      // decoder ever sees it, irreversibly. Anything left is normalized by
      // finishParagraph once the shift has been undone.
      const joined = collapseAsciiBlanks(current.join(" "));
      if (joined.length > 0) paragraphs.push(joined);
      current = [];
    }
  }

  return paragraphs;
}

// --- Is this text already fine? -------------------------------------------
//
// detectCipherShift only ever answers "which shift makes this look most like
// English"; it has no way to answer "was this text already legible in some other
// language". So on its own it happily shifts perfectly good German, Spanish and
// French prose into mojibake ("Das Gedächtnis" -> "@]o Ca`à_dpjeo"), and turns a
// table of numbers into letters. Those are not hypotheticals - they are what the
// tests in pdfLanguageSafety.test.ts caught.
//
// The gate below is deliberately comparative rather than a language check: the
// question is never "is this English" but "did applying this shift make the text
// MORE word-like than it already was". A vowel per word is the one property
// Latin-script prose has and Caesar-shifted prose mostly loses, and it holds for
// every language the alphabet is used for.

const VOWEL = /[aeiouyàáâãäåæèéêëìíîïòóôõöøùúûüýÿœ]/i;

function wordTokens(text: string): string[] {
  return text.match(/\p{L}{2,}/gu) ?? [];
}

/** Share of word-like tokens containing a vowel, or null when there are too few
 * words to draw any conclusion. Legible prose sits at 0.9-1.0; shifted prose
 * lands far lower, because a shift maps vowels onto arbitrary letters. */
function vowelWordRatio(text: string): number | null {
  const words = wordTokens(text);
  if (words.length < 4) return null;
  let withVowel = 0;
  for (const word of words) if (VOWEL.test(word)) withVowel++;
  return withVowel / words.length;
}

/** Digits among the non-space characters. Notation, tables, indexes and formulas
 * are digit-dense, and a Caesar shift moves digits out of the digit range - so a
 * high ratio here is positive evidence that the text was never shifted. */
function digitRatio(text: string): number {
  const dense = text.replace(/\s+/g, "");
  if (dense.length === 0) return 0;
  return (dense.match(/[0-9]/g)?.length ?? 0) / dense.length;
}

/** Characters that decryptText strips as undefined: C0 controls other than the
 * \x03 PDFs use as a word separator, plus DEL and the C1 block. Genuinely
 * legible extracted text never contains any of these, in any language - but a
 * Type3 cipher produces them the moment a shift pushes a letter past 127. */
const CONTROL_CHARS = /[\x00-\x02\x04-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/;

/** Rough per-mille letter frequencies, averaged across the Latin-script
 * languages this reader is likely to meet (English, German, Spanish, French,
 * Italian, Portuguese, Dutch). They differ in the details but agree on the
 * shape: e/a/i/o/n/r/s/t carry the text and j/q/x/z barely appear. A Caesar
 * shift wrecks that shape - at shift 1 every 'e' becomes an 'f' - which is what
 * makes this measurable even where the vowel test cannot tell. */
const LETTER_FREQUENCY: Record<string, number> = {
  e: 12, a: 8.5, i: 7.5, o: 7, n: 7, r: 6.5, s: 6, t: 6, l: 4.5, u: 4, d: 4,
  c: 3, m: 2.7, h: 2.5, p: 2, g: 2, b: 1.6, f: 1.5, v: 1, k: 0.8, w: 0.8,
  y: 0.7, z: 0.5, j: 0.3, x: 0.3, q: 0.3,
};

/** Mean letter frequency of a text's letters, or null with too little to judge.
 * Real prose in any of those languages scores ~5.5-7; shifted prose scores far
 * lower, because the shift maps common letters onto rare ones. */
function letterProfileScore(text: string): number | null {
  const letters = text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .match(/[a-z]/g);
  if (!letters || letters.length < 40) return null;
  let total = 0;
  for (const letter of letters) total += LETTER_FREQUENCY[letter] ?? 0;
  return total / letters.length;
}

// How much better the letter profile has to get before a shift is believed on
// this evidence alone. Measured: undoing a real shift gains 1.5-3 points, while
// shifting legible prose in any language loses ground rather than gaining it.
const PROFILE_GAIN = 0.75;

/** Last word on a paragraph whose shift the vowel test could not settle, used
 * only once the document's shift is already established by majority vote. */
function profileImproves(raw: string, shift: number): boolean {
  const before = letterProfileScore(raw);
  const after = letterProfileScore(decryptText(raw, shift));
  if (before === null || after === null) return false;
  return after > before + PROFILE_GAIN;
}

// Above this, the text already reads as words and must be left alone.
const LEGIBLE_VOWEL_RATIO = 0.85;
// How much more word-like decoding has to make it before it is worth believing.
const VOWEL_GAIN = 0.1;
const MAX_DIGIT_RATIO = 0.1;
// Votes a shift needs before it becomes the document's fallback for paragraphs
// that are too short to judge on their own.
const MIN_DOCUMENT_SHIFT_VOTES = 3;

type ShiftVerdict = "improves" | "unjudged" | "reject";

function judgeShift(raw: string, shift: number): ShiftVerdict {
  if (shift === 0) return "improves";
  if (digitRatio(raw) > MAX_DIGIT_RATIO) return "reject";

  // The vowel test asks whether characters that *look* like vowels are spread
  // through the words - and a shift can satisfy it by accident. At shift 16 the
  // English vowels land on 'u' and 'y', which the test counts as vowels too, so
  // ciphered prose scored MORE legible than the plaintext and was left in
  // cipher (paragraphs 0 and 2 of the sweep in pdfLanguageSafety.test.ts).
  // Control characters settle that question outright and are not fooled by which
  // letter maps to which: no legible text has them, so their presence means
  // there is nothing legible here to protect.
  const before = CONTROL_CHARS.test(raw) ? null : vowelWordRatio(raw);
  const after = vowelWordRatio(decryptText(raw, shift));

  if (before === null) {
    // Either no word-like tokens at all, or text known not to be legible. Either
    // way there is nothing here a shift could damage, so decoding is worth it
    // provided it actually produced words.
    return after !== null && after >= LEGIBLE_VOWEL_RATIO ? "improves" : "unjudged";
  }
  // It already reads as words. Whatever the detector found is a coincidence.
  if (before >= LEGIBLE_VOWEL_RATIO) return "reject";
  if (after === null) return "unjudged";
  return after > before + VOWEL_GAIN ? "improves" : "reject";
}

type ShiftState = { carried: number; seeded: boolean };

/** Decodes one batch's paragraphs, resolving each one's Caesar shift without
 * ever depending on paragraphs that haven't been extracted yet.
 *
 * This replaced a whole-document right-to-left sweep, where an undetectable
 * paragraph could borrow its shift from a LATER one. That is fine when every
 * page is extracted before anything renders, but it makes streaming impossible:
 * appending a page could silently re-decode text already on screen. Here a
 * paragraph uses its own detected shift when it has one and otherwise carries
 * forward the last one seen - seeded by a majority vote across the first batch,
 * so the opening paragraphs aren't stuck with an unlucky default.
 *
 * Verified character-for-character identical to the old sweep on the user's
 * 444-page Osho PDF (100% of prose paragraphs legible either way) and on a
 * 1184-page chess book. */
function decodeBatch(raws: string[], state: ShiftState): string[] {
  const detected = raws.map((raw) => detectCipherShift(raw));

  if (!state.seeded) {
    const votes = new Map<number, number>();
    for (let i = 0; i < Math.min(detected.length, SHIFT_VOTE_PARAGRAPHS); i++) {
      const shift = detected[i];
      // Only paragraphs a shift demonstrably rescued get a vote. Without this, one
      // coincidental detection on a legible paragraph becomes the whole
      // document's default and poisons every paragraph that follows it.
      if (shift !== null && shift !== 0 && judgeShift(raws[i], shift) === "improves") {
        votes.set(shift, (votes.get(shift) ?? 0) + 1);
      }
    }
    let bestShift = 0;
    let bestCount = 0;
    for (const [shift, count] of votes) {
      if (count > bestCount) {
        bestCount = count;
        bestShift = shift;
      }
    }
    state.carried = bestCount >= MIN_DOCUMENT_SHIFT_VOTES ? bestShift : 0;
    state.seeded = true;
  }

  return raws.map((raw, i) => {
    const own = detected[i];
    if (own !== null && own !== 0) {
      const verdict = judgeShift(raw, own);
      if (verdict === "improves") {
        state.carried = own;
        return finishParagraph(decryptText(raw, own));
      }
      if (verdict === "reject") {
        // The detector's own answer was a coincidence - but that is a verdict on
        // the answer, not on the paragraph, and it used to end the matter here.
        // In a book whose shift is known, that left the odd paragraph sitting in
        // cipher amid legible ones (a whole page of the Osho book, at shift 16),
        // because the detector had merely guessed wrong rather than found
        // nothing. The document's voted shift is the better evidence, so try it
        // - insisting on "improves" this time, which is what keeps a genuinely
        // legible paragraph (the other reason a shift gets rejected) untouched.
        // The vowel test is blind at small shifts - shift-1 English keeps a
        // vowel in nearly every word ("uif nbtufs tbje"), so it reads as
        // perfectly legible prose and the paragraph stayed in cipher while its
        // neighbours were rescued. The letter profile is not fooled by that, and
        // it is safe to lean on here specifically: state.carried is only ever
        // non-zero once a majority of paragraphs were demonstrably rescued by
        // it, which a legible book of any language never manages.
        if (
          state.carried !== 0 &&
          (judgeShift(raw, state.carried) === "improves" || profileImproves(raw, state.carried))
        ) {
          return finishParagraph(decryptText(raw, state.carried));
        }
        return finishParagraph(raw);
      }
      // "unjudged" - too few words to tell - falls through to the document's
      // shift, which is the stronger evidence.
    }
    if (state.carried === 0) return finishParagraph(raw);
    // The document-level shift is only ever set when at least
    // MIN_DOCUMENT_SHIFT_VOTES paragraphs were demonstrably rescued by it, so by
    // this point the book is known to be encoded and the vowel test has done its
    // job. Applying it here is what rescues headings and short lines, which are
    // too brief to judge on their own. Digit-dense lines - page numbers, tables,
    // notation - are still left alone.
    if (digitRatio(raw) > MAX_DIGIT_RATIO) return finishParagraph(raw);
    return finishParagraph(decryptText(raw, state.carried));
  });
}

/** Extracts a PDF's text in page batches, handing each batch to `onBatch` as
 * soon as it is ready so the reader can render the opening pages while the rest
 * of the book is still being read. Resolves with the complete result, which is
 * what gets written to the cache. */
export async function extractPdfParagraphsStreaming(
  doc: PDFDocumentProxy,
  onBatch: (batch: PdfExtractBatch) => void,
): Promise<PdfExtractResult> {
  const paragraphs: string[] = [];
  const pageToParagraphIndex: Record<number, number> = {};
  const shiftState: ShiftState = { carried: 0, seeded: false };

  let pageNum = 1;
  let isFirstBatch = true;

  while (pageNum <= doc.numPages) {
    const batchEnd = Math.min(pageNum + (isFirstBatch ? FIRST_BATCH_PAGES : LATER_BATCH_PAGES) - 1, doc.numPages);
    const rawParagraphs: string[] = [];
    // Where each page's paragraphs begin within rawParagraphs. The page ->
    // paragraph map can't be written during collection any more: blank
    // paragraphs are only recognisable after decoding, and dropping them shifts
    // every index after them.
    const pageStarts: { page: number; rawIndex: number }[] = [];

    for (; pageNum <= batchEnd; pageNum++) {
      const page = await doc.getPage(pageNum);
      const textContent = await page.getTextContent();
      const items = textContent.items.filter(
        (item): item is TextItem => "str" in item && "transform" in item,
      );
      // Releases the page's parsed operator list and font data. Without this a
      // 1000-page book keeps every page it has ever touched resident, which
      // turns a slow open into an out-of-memory kill on a mid-range phone.
      page.cleanup();
      if (items.length === 0) continue;

      const pageResult = pageParagraphs(items);
      if (pageResult.length > 0) {
        pageStarts.push({ page: pageNum, rawIndex: rawParagraphs.length });
        rawParagraphs.push(...pageResult);
      }
    }

    const decoded = decodeBatch(rawParagraphs, shiftState);

    // Filter, then rebuild the page map against the filtered array.
    // keptAtOrAfter[i] is where raw paragraph i landed - or, if it was dropped,
    // where the next surviving paragraph landed, which is the right answer for a
    // page whose own first paragraph was blank.
    const batchParagraphs: string[] = [];
    const keptAtOrAfter = new Int32Array(decoded.length + 1);
    for (let i = 0; i < decoded.length; i++) {
      keptAtOrAfter[i] = batchParagraphs.length;
      if (!isBlankParagraph(decoded[i])) batchParagraphs.push(decoded[i]);
    }
    keptAtOrAfter[decoded.length] = batchParagraphs.length;

    const batchPageIndex: Record<number, number> = {};
    for (const { page, rawIndex } of pageStarts) {
      const local = keptAtOrAfter[rawIndex];
      // Nothing from this page, or anywhere after it in this batch, survived
      // decoding - there is no paragraph on screen to point the page at.
      if (local < batchParagraphs.length) batchPageIndex[page] = paragraphs.length + local;
    }

    paragraphs.push(...batchParagraphs);
    Object.assign(pageToParagraphIndex, batchPageIndex);

    const done = pageNum > doc.numPages;
    onBatch({
      paragraphs: batchParagraphs,
      pageToParagraphIndex: batchPageIndex,
      pagesDone: Math.min(pageNum - 1, doc.numPages),
      totalPages: doc.numPages,
      done,
    });

    isFirstBatch = false;
    // Hand the frame back so the reader can paint what it was just given, and
    // stay responsive to taps, before the next batch takes the thread again.
    if (!done) await new Promise((resolve) => setTimeout(resolve, 0));
  }

  return { paragraphs, pageToParagraphIndex };
}

/** Non-streaming convenience wrapper - the whole book, no intermediate paints. */
export async function extractPdfParagraphs(doc: PDFDocumentProxy): Promise<PdfExtractResult> {
  return extractPdfParagraphsStreaming(doc, () => {});
}

function detectCipherShift(text: string): number | null {
  const alphabeticRatio = (text.match(/[a-zA-Z]/g) || []).length / Math.max(text.length, 1);
  const containsCommonWords = /\b(THE|the|AND|and|OF|of|IN|in|TO|to|A|a)\b/.test(text);
  
  if (alphabeticRatio > 0.7 && containsCommonWords) {
    return 0;
  }

  const trigrams: Record<string, number> = {};
  const cleanText = text.replace(/[\s\x03]+/g, "");

  for (let i = 0; i <= cleanText.length - 3; i++) {
    const tg = cleanText.substring(i, i + 3);
    trigrams[tg] = (trigrams[tg] || 0) + 1;
  }

  const sortedTrigrams = Object.entries(trigrams).sort((a, b) => b[1] - a[1]);
  const candidateShifts = new Set<number>();
  
  const targets = ["THE", "the", "AND", "and", "FOR", "for", "HAT", "hat", "ING", "ing", "ION", "ion"];
  
  for (let i = 0; i < Math.min(sortedTrigrams.length, 50); i++) {
    const tg = sortedTrigrams[i][0];
    for (const target of targets) {
      const char0Shift = tg.charCodeAt(0) - target.charCodeAt(0);
      const char1Shift = tg.charCodeAt(1) - target.charCodeAt(1);
      const char2Shift = tg.charCodeAt(2) - target.charCodeAt(2);
      if (char0Shift === char1Shift && char1Shift === char2Shift) {
        candidateShifts.add(char0Shift);
      }
    }
  }

  if (candidateShifts.size === 0) return null;

  let bestShift = null;
  let maxScore = -1;
  const sample = text.substring(0, Math.min(text.length, 300));

  for (const shift of candidateShifts) {
    let score = 0;
    for (let i = 0; i < sample.length; i++) {
      const charCode = sample.charCodeAt(i);
      if (charCode === 32 || charCode === 3) {
        score += 1;
        continue;
      }
      const dec = charCode - shift;
      if (
        (dec >= 65 && dec <= 90) ||
        (dec >= 97 && dec <= 122) ||
        (dec >= 48 && dec <= 57) ||
        [33, 34, 39, 44, 45, 46, 63].includes(dec)
      ) {
        score += 1;
      } else {
        score -= 1;
      }
    }
    if (score > maxScore) {
      maxScore = score;
      bestShift = shift;
    }
  }

  if (maxScore > sample.length * 0.4) {
    return bestShift;
  }
  
  return null;
}
