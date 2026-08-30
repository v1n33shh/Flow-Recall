import type { DefinitionResponse } from "./definitionSchema";

/** Longest note we will store. Mirrors DefinitionPopover's textarea maxLength,
 * so a note assembled in code can never end up longer than one the reader is
 * allowed to type by hand. */
export const NOTE_MAX_LENGTH = 2000;

/** The whole lookup as plain text - definition first, then the examples,
 * numbered the way the panel shows them.
 *
 * Deliberately the single source for BOTH "Copy" and "Save as Note". Those two
 * used to disagree: Copy put only `definition` on the clipboard and dropped the
 * examples on the floor, while the only way to save anything at all required an
 * existing highlight. Sharing one formatter means the clipboard and a saved
 * note can never carry different versions of the same definition, and neither
 * can silently hand over half of what is on screen. */
export function definitionAsText(data: DefinitionResponse): string {
  return [data.definition, "", "Examples:", ...data.examples.map((example, i) => `${i + 1}. ${example}`)].join("\n");
}

/** Adds `text` to whatever note already exists, rather than replacing it.
 *
 * Saving a definition onto a highlight the reader has already annotated must
 * not discard what they wrote - "I looked a word up and lost my own note" is
 * precisely the class of failure this module exists to prevent. Blank-line
 * separated so the join reads as two entries, and clamped to NOTE_MAX_LENGTH so
 * repeated saves cannot grow a record without bound. */
export function appendToNote(existing: string | undefined, text: string): string {
  const before = existing?.trim();
  const combined = before ? `${before}\n\n${text}` : text;
  return combined.slice(0, NOTE_MAX_LENGTH);
}
