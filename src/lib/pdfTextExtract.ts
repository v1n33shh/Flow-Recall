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
 * no longer produce. */
export const PDF_EXTRACT_VERSION = 1;

export type PdfExtractBatch = {
  /** Decoded paragraphs from this batch, to append to whatever is on screen. */
  paragraphs: string[];
  /** 1-based page number -> index of its first paragraph, for this batch's pages. */
  pageToParagraphIndex: Record<number, number>;
  pagesDone: number;
  totalPages: number;
  done: boolean;
};

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
    if (lineText.trim().length === 0) continue;
    current.push(lineText);

    let isBreak = i === lines.length - 1;
    if (!isBreak) {
      const gap = lines[i].y - lines[i + 1].y;
      const threshold = Math.max(lines[i].height, lines[i + 1].height) * 1.5;
      if (gap > threshold) isBreak = true;
    }

    if (isBreak) {
      const joined = current.join(" ").replace(/\s+/g, " ").trim();
      if (joined.length > 0) paragraphs.push(joined);
      current = [];
    }
  }

  return paragraphs;
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
    for (const shift of detected.slice(0, SHIFT_VOTE_PARAGRAPHS)) {
      if (shift !== null) votes.set(shift, (votes.get(shift) ?? 0) + 1);
    }
    let bestShift = 0;
    let bestCount = 0;
    for (const [shift, count] of votes) {
      if (count > bestCount) {
        bestCount = count;
        bestShift = shift;
      }
    }
    state.carried = bestShift;
    state.seeded = true;
  }

  return raws.map((raw, i) => {
    const shift = detected[i];
    if (shift !== null) state.carried = shift;
    return decryptText(raw, shift ?? state.carried);
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
    const batchPageIndex: Record<number, number> = {};

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
        batchPageIndex[pageNum] = paragraphs.length + rawParagraphs.length;
        rawParagraphs.push(...pageResult);
      }
    }

    const decoded = decodeBatch(rawParagraphs, shiftState);
    paragraphs.push(...decoded);
    Object.assign(pageToParagraphIndex, batchPageIndex);

    const done = pageNum > doc.numPages;
    onBatch({
      paragraphs: decoded,
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
