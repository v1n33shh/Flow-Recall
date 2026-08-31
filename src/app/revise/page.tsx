"use client";

import Link from "next/link";
import { getSavedDecks, useStudyDeck } from "@/lib/storage";
import RevisionSheet from "@/components/RevisionSheet";

/** Reuses the same sessionStorage handoff `/study` does (`setStudyDeck`), rather
 * than taking the deck id from the URL. Under `output: "export"` a dynamic
 * `/revise/[id]` segment would need `generateStaticParams` at build time, and
 * decks live in the student's own localStorage - there are no ids to enumerate.
 * The handoff is also what makes a cold deep-link harmless: the export writes
 * `revise.html`, so a full document load lands on `/` regardless, and this page is
 * only ever reached by an in-app navigation. */
export default function RevisePage() {
  const handoff = useStudyDeck();

  if (!handoff || handoff.concepts.length === 0) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center px-6 text-center">
        <h1 className="text-xl font-semibold text-foreground">Nothing to read yet</h1>
        <p className="mt-2 max-w-sm text-sm text-muted-foreground">
          Open a deck from your library and we&apos;ll lay its concepts out as a revision sheet.
        </p>
        <Link
          href="/"
          className="mt-6 rounded-full bg-accent px-6 py-2.5 text-sm font-medium text-accent-foreground ring-1 ring-inset ring-accent/30 shadow-[inset_0_1px_0_rgba(255,255,255,0.15),0_8px_24px_-6px_rgba(0,0,0,0.4)] transition-all duration-200 hover:bg-accent/90 active:scale-[0.98]"
        >
          Back to library
        </Link>
      </main>
    );
  }

  // Safe to read localStorage here: useStudyDeck's server snapshot is null, so
  // this branch only ever runs after mount.
  const title = getSavedDecks().find((deck) => deck.id === handoff.deckId)?.title ?? "Your deck";

  return <RevisionSheet deckId={handoff.deckId} title={title} concepts={handoff.concepts} />;
}
