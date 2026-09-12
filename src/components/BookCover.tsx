import type { BookMeta } from "@/lib/types";

/** A book's thumbnail, or the fallback for the ones that have none.
 *
 * EXTRACTED from src/app/reader/page.tsx, where it was a private function, when the
 * Continue Reading card and the rewritten /library both needed the same three cases.
 * A second copy would have drifted the first time a fallback was retuned.
 *
 * The three cases are not decorative: `coverDataUrl` is a real asset (an EPUB's embedded
 * cover, or page 1 of a PDF rasterized at 0.35 scale — see readerStorage.addPdf), pasted
 * text genuinely has no cover so it gets ruled lines, and anything else falls back to its
 * own initial rather than to a generic glyph, so a shelf of fallbacks is still scannable.
 */
export default function BookCover({ book, className = "" }: { book: BookMeta; className?: string }) {
  if (book.coverDataUrl) {
    // Raw <img>, not next/image: covers are data: URLs generated client-side from the
    // user's own local file, not remote assets next/image could optimize.
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={book.coverDataUrl} alt="" className={`h-full w-full object-cover ${className}`} />;
  }
  if (book.type === "text") {
    return (
      <div className={`flex h-full w-full flex-col items-center justify-center gap-1.5 bg-white/[0.06] px-4 ${className}`}>
        {[1, 0.8, 0.9].map((width, i) => (
          <div key={i} className="h-1 rounded-full bg-white/25" style={{ width: `${width * 100}%` }} />
        ))}
      </div>
    );
  }
  return (
    <div className={`flex h-full w-full items-center justify-center bg-white/[0.06] text-2xl font-semibold text-white/40 ${className}`}>
      {book.title.charAt(0).toUpperCase()}
    </div>
  );
}
