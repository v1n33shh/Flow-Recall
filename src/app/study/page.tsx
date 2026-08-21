"use client";

import Link from "next/link";
import { useStudyDeck } from "@/lib/storage";
import StudyFeed from "@/components/StudyFeed";

export default function StudyPage() {
  const handoff = useStudyDeck();

  if (!handoff || handoff.concepts.length === 0) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center px-6 text-center">
        <h1 className="text-xl font-semibold text-foreground">No deck to study yet</h1>
        <p className="mt-2 max-w-sm text-sm text-muted-foreground">
          Ingest some notes first and we&apos;ll turn them into a study feed.
        </p>
        <Link
          href="/ingest"
          className="mt-6 rounded-full bg-accent px-6 py-2.5 text-sm font-medium text-accent-foreground ring-1 ring-inset ring-accent/30 shadow-[inset_0_1px_0_rgba(255,255,255,0.15),0_8px_24px_-6px_rgba(0,0,0,0.4)] transition-all duration-200 hover:bg-accent/90 active:scale-[0.98]"
        >
          Go to Auto-Ingest
        </Link>
      </main>
    );
  }

  return <StudyFeed deckId={handoff.deckId} concepts={handoff.concepts} />;
}
