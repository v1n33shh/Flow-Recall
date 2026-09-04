// Splitting a book's text into model-sized pieces for /api/ingest.
//
// Lifted out of src/app/ingest/page.tsx so the packing rules can be tested
// against real book shapes rather than only exercised by uploading a PDF and
// reading the cards that come back.
//
// The rule that matters: a chunk edge must never land inside a sentence. The
// ingest prompt asks the model for a verbatim `sourceQuote` and a `cloze` whose
// blank the `answer` fills exactly, and both of those demands are impossible to
// satisfy against a fragment that starts mid-clause. A mutilated chunk does not
// degrade a card, it kills the whole batch: the model either invents the missing
// half or gives up on the JSON shape, and /api/ingest answers 502.

/** Characters per chunk.
 *
 * Sized to keep the request count down rather than to fill the model's context:
 * every chunk is one HTTP request against Groq's free-tier per-minute request
 * AND token limits, and a book-length upload at the old 1500 spent 40 requests
 * where this spends 14. The model is capped at 3 cards per chunk regardless (see
 * buildConceptsPrompt), so a bigger chunk costs no extra output tokens - it just
 * gives the model more material to pick its 3 best cards from. */
export const DEFAULT_CHUNK_SIZE = 4500;

// Words that take a trailing period without ending a sentence. Stored without
// the period and lower-cased; the internal periods of "e.g." are stripped before
// the lookup, so both "eg" and "e.g" match this one entry.
const ABBREVIATIONS = new Set([
  "mr", "mrs", "ms", "dr", "prof", "rev", "hon", "st", "sr", "jr",
  "vs", "etc", "eg", "ie", "cf", "al", "ibid", "approx", "est",
  "fig", "figs", "no", "nos", "vol", "vols", "ch", "chap", "ed", "eds",
  "pp", "p", "para", "sec", "trans", "inc", "ltd", "co", "dept", "univ",
  "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec",
]);

// A run of terminators, any closing quotes or brackets that belong to it, then
// the whitespace that separates it from whatever is next. Requiring the
// whitespace is what keeps "3.5" and "www.example.com" out of this entirely.
const SENTENCE_END = /([.!?…]+)(["'”’)\]]*)(\s+)/gu;

/** Offsets in `text` where one sentence ends and the next begins. */
function sentenceBoundaries(text: string): number[] {
  const boundaries: number[] = [];
  SENTENCE_END.lastIndex = 0;
  for (let match = SENTENCE_END.exec(text); match !== null; match = SENTENCE_END.exec(text)) {
    const nextStart = match.index + match[0].length;
    if (endsSentence(text, match.index, match[1], nextStart)) boundaries.push(nextStart);
  }
  return boundaries;
}

/** Whether the terminator at `terminatorStart` really ends a sentence.
 *
 * Only a lone period is ever in doubt - "!", "?" and "…" are not used for
 * anything else. Every test here answers "no" on doubt, because refusing a
 * boundary only makes one piece longer while taking a false one splits a
 * sentence, which is the exact damage this module exists to prevent. */
function endsSentence(
  text: string,
  terminatorStart: number,
  terminator: string,
  nextStart: number,
): boolean {
  if (terminator !== ".") return true;

  const word = /([\p{L}\p{N}.]+)$/u.exec(text.slice(0, terminatorStart))?.[1] ?? "";

  // "J. R. R. Tolkien" - a single capital is an initial, not a sentence.
  if (/^\p{Lu}$/u.test(word)) return false;
  if (ABBREVIATIONS.has(word.replace(/\./g, "").toLowerCase())) return false;

  // Prose that continues in lower case (or in a digit) did not end here. No
  // abbreviation list survives contact with a real book - "Bhagwan.", "sutra.",
  // journal citations, "Rs." - and this catches the rest of them.
  return !/^[\p{Ll}\p{N}]/u.test(text.slice(nextStart));
}

/** `text` split at its sentence boundaries, each piece trimmed. */
export function splitSentences(text: string): string[] {
  const sentences: string[] = [];
  let start = 0;
  for (const boundary of sentenceBoundaries(text)) {
    const sentence = text.slice(start, boundary).trim();
    if (sentence) sentences.push(sentence);
    start = boundary;
  }
  const tail = text.slice(start).trim();
  if (tail) sentences.push(tail);
  return sentences;
}

/** Greedy packer: appends each unit to the piece being built, starting a new one
 * whenever the next unit would overflow. `overflow` handles a single unit that
 * is longer than the whole budget on its own. */
function pack(
  units: string[],
  chunkSize: number,
  joiner: string,
  overflow: (unit: string) => string[],
): string[] {
  const pieces: string[] = [];
  let current = "";

  for (const unit of units) {
    if (unit.length > chunkSize) {
      if (current) {
        pieces.push(current);
        current = "";
      }
      const split = overflow(unit);
      pieces.push(...split.slice(0, -1));
      current = split[split.length - 1] ?? "";
      continue;
    }

    const candidate = current ? `${current}${joiner}${unit}` : unit;
    if (candidate.length > chunkSize) {
      pieces.push(current);
      current = unit;
    } else {
      current = candidate;
    }
  }

  if (current) pieces.push(current);
  return pieces;
}

/** Last resort, for a "sentence" the length of a page: an unpunctuated wall of
 * text, a table of contents, a run of move notation. There is no boundary left
 * worth respecting, so break on whitespace - at least no word is cut in half. */
function splitOnWords(sentence: string, chunkSize: number): string[] {
  return pack(sentence.split(/\s+/).filter(Boolean), chunkSize, " ", (word) => {
    const parts: string[] = [];
    for (let i = 0; i < word.length; i += chunkSize) parts.push(word.slice(i, i + chunkSize));
    return parts;
  });
}

/** Splits raw text into chunks of at most `chunkSize` characters, breaking on
 * paragraph boundaries where it can, sentence boundaries where it must, and
 * whitespace only when a single sentence is itself too long to send. */
export function chunkText(text: string, chunkSize = DEFAULT_CHUNK_SIZE): string[] {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);

  return pack(paragraphs, chunkSize, "\n\n", (paragraph) =>
    pack(splitSentences(paragraph), chunkSize, " ", (sentence) =>
      splitOnWords(sentence, chunkSize),
    ),
  );
}
