"use client";

import Link from "next/link";
import { useStudyDeck } from "@/lib/storage";
import StudyFeed from "@/components/StudyFeed";

export default function StudyPage() {
  const handoff = useStudyDeck();

  if (!handoff || handoff.concepts.length === 0) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center px-6 text-center">
        <h1 className="text-xl font-semibold text-white">No deck to study yet</h1>
        <p className="mt-2 max-w-sm text-sm text-zinc-400">
          Ingest some notes first and we&apos;ll turn them into a study feed.
        </p>
        <Link
          href="/ingest"
          className="mt-6 rounded-full bg-emerald-500 px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-emerald-400"
        >
          Go to Auto-Ingest
        </Link>
      </main>
    );
  }

  return <StudyFeed deckId={handoff.deckId} concepts={handoff.concepts} />;
}
