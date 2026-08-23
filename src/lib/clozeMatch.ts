/** A typed answer that's conceptually identical to the reference answer
 * shouldn't fail on a leading article, trailing punctuation, extra
 * whitespace, or a singular/plural or verb-conjugation "s" on any word (a
 * multi-word answer can carry that mismatch on a word other than the last,
 * e.g. "excite electrons..." vs "excites electrons...") - none of that
 * changes whether the student actually recalled the right fact, so grading
 * on raw string equality would mark genuinely correct recall as wrong. */
export function normalizeForCompare(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^(a|an|the)\s+/, "")
    .replace(/[.,!?;:'"]+$/, "")
    .split(/\s+/)
    .map((word) => word.replace(/s$/, ""))
    .join(" ");
}
