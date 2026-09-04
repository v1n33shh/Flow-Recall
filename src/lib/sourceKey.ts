// A stable identity for a block of source text, so re-uploading the same PDF is
// recognised as the deck the student already has rather than becoming a second
// copy of it in the library.
//
// Why a hash at all: nothing else about an upload is stable. The filename is
// whatever the download was called ("wisdom", "The Book of Wisdom (Osho)
// (z-library.sk...)" - both real, both the same book), the title is typed by the
// student, and the deck's consumed source text is not kept. The text itself is the
// only thing that is the same on the second upload as it was on the first.

/** Whitespace, as PDF extraction actually emits it - not just the ASCII five.
 *
 * pdf.js reconstructs spacing from glyph positions and routinely produces NBSP
 * (0xA0), thin and en/em spaces (0x2000-0x200A), narrow NBSP (0x202F) and a
 * leading BOM. Treating those as ordinary characters would make a re-extraction
 * of the same file hash differently, which is the one thing this must never do. */
function isWhitespace(code: number): boolean {
  return (
    code === 0x20 ||
    (code >= 0x09 && code <= 0x0d) ||
    code === 0xa0 ||
    (code >= 0x2000 && code <= 0x200a) ||
    code === 0x2028 ||
    code === 0x2029 ||
    code === 0x202f ||
    code === 0x205f ||
    code === 0x3000 ||
    code === 0xfeff
  );
}

// FNV-1a's prime, and a second one (xxHash32's) so the two passes diverge on
// their multiply as well as their seed. Math.imul because a plain `*` on these
// overflows into a double and silently stops being a 32-bit hash.
const PRIME_A = 16777619;
const PRIME_B = 2246822519;

/**
 * A deterministic key for `text`, insensitive to how its whitespace is laid out.
 *
 * Two independent 32-bit passes plus the character count, so the result behaves
 * like a 64-bit hash with a length check on top. That is far more than enough for
 * what it is asked to do: match a student's own re-upload against the handful of
 * decks in their own library. Nobody is constructing collisions against their own
 * flashcards, so a cryptographic digest would buy nothing - and `crypto.subtle`
 * is async, which would push a promise into the middle of the upload path for no
 * gain.
 *
 * Whitespace is collapsed *during* the walk rather than by normalising the string
 * first. A textbook measured 6,027,603 characters on the user's phone; a
 * `.replace(/\s+/g, " ")` would allocate a second copy of that before hashing it.
 * This makes one pass and allocates nothing.
 *
 * Leading and trailing whitespace contribute nothing (`started`/`pendingSpace`
 * only emit a separator *between* real characters), so the same text with a
 * trailing newline keys identically.
 */
export function sourceKeyFor(text: string): string {
  let hashA = 2166136261;
  let hashB = 3792840193;
  let count = 0;
  let pendingSpace = false;
  let started = false;

  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);

    if (isWhitespace(code)) {
      // Held, not emitted: a run of whitespace becomes one separator, and a run
      // at the very end becomes nothing at all.
      if (started) pendingSpace = true;
      continue;
    }

    if (pendingSpace) {
      hashA = Math.imul(hashA ^ 0x20, PRIME_A);
      hashB = Math.imul(hashB ^ 0x20, PRIME_B);
      count++;
      pendingSpace = false;
    }

    hashA = Math.imul(hashA ^ code, PRIME_A);
    hashB = Math.imul(hashB ^ code, PRIME_B);
    count++;
    started = true;
  }

  // Base 36 keeps it short enough to read in a debugger and in a synced row.
  return `${count.toString(36)}:${(hashA >>> 0).toString(36)}${(hashB >>> 0).toString(36)}`;
}
