"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import type { Concept } from "@/lib/types";
import { saveDeck, setStudyDeck } from "@/lib/storage";
import PdfDropzone from "@/components/PdfDropzone";

// Kept local (not imported from @/lib/ai) on purpose: that module pulls in the
// server-side provider SDKs, and importing it here would drag them into the
// client bundle. These ids must stay in sync with the route's requestSchema.
const DEFAULT_MODEL = "llama-3.3-70b-versatile";
const MODEL_OPTIONS = [
  { id: "llama-3.3-70b-versatile", label: "Llama 3.3 70B (Free)", pro: false },
  { id: "claude-3-5-sonnet-20240620", label: "Claude 3.5 Sonnet (Pro)", pro: true },
  { id: "gpt-4o", label: "GPT-4o (Pro)", pro: true },
] as const;

// Time to wait between chunk requests - Groq's free tier enforces per-minute
// request/token limits, and firing chunks back-to-back (or via Promise.all)
// trips a 429 almost immediately on anything book-sized.
const CHUNK_DELAY_MS = 1000;

// Speed-First Cap: sequential chunking is safe from rate limits, but a 100+
// chunk book would take minutes and still burn through a free-tier daily
// quota in one upload. Capping at 4 chunks (~60,000 chars) keeps every
// generation under ~15 seconds - students study what's processed, then
// upload the next chapter.
const MAX_CHUNKS = 4;

function titleFromFileName(fileName: string): string {
  const withoutExtension = fileName.replace(/\.pdf$/i, "");
  return withoutExtension.trim() || "Untitled Notes";
}

/** Splits raw text into model-sized chunks, preferring to break on paragraph
 * boundaries (blank lines) so a chunk edge doesn't land mid-sentence. A
 * single paragraph longer than chunkSize (e.g. a wall of text with no blank
 * lines) has to be hard-split on its own, since there's nothing else to break on. */
function chunkText(text: string, chunkSize = 15000): string[] {
  const paragraphs = text.split(/\n{2,}/);
  const chunks: string[] = [];
  let current = "";

  for (const paragraph of paragraphs) {
    if (paragraph.length > chunkSize) {
      if (current) {
        chunks.push(current);
        current = "";
      }
      for (let i = 0; i < paragraph.length; i += chunkSize) {
        chunks.push(paragraph.slice(i, i + chunkSize));
      }
      continue;
    }

    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
    if (candidate.length > chunkSize) {
      chunks.push(current);
      current = paragraph;
    } else {
      current = candidate;
    }
  }

  if (current) chunks.push(current);
  return chunks;
}

export default function IngestPage() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const plan = session?.user?.plan ?? "FREE";
  const isAuthenticated = status === "authenticated";

  const [selectedModel, setSelectedModel] = useState<string>(DEFAULT_MODEL);
  const [text, setText] = useState("");
  const [title, setTitleState] = useState("Untitled Notes");
  // saveDeck() needs the title as of whenever generation actually finishes,
  // not whatever it was when generation *started* - a plain closure over
  // `title` inside handleGenerate would go stale if the user edits the
  // title while a request is in flight. Keep a ref in lockstep instead.
  const titleRef = useRef(title);
  const [concepts, setConcepts] = useState<Concept[] | null>(null);
  const [savedDeckId, setSavedDeckId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Distinct from `error`: when the server rejects with FREE_LIMIT_REACHED we
  // show the premium upsell block instead of the generic error banner.
  const [showPaywall, setShowPaywall] = useState(false);
  // 1-indexed - currentChunk is 0 whenever we're not mid-generation.
  const [currentChunk, setCurrentChunk] = useState(0);
  const [totalChunks, setTotalChunks] = useState(0);
  const [truncated, setTruncated] = useState(false);

  const selectedIsPro = MODEL_OPTIONS.find((m) => m.id === selectedModel)?.pro ?? false;
  // A free user who picked a Pro model - the one state we hard-block generation on.
  const proModelLocked = selectedIsPro && plan !== "PRO";

  function setTitle(value: string) {
    titleRef.current = value;
    setTitleState(value);
  }

  async function handleGenerate(sourceText: string = text) {
    if (!isAuthenticated) {
      setError("Please sign in to generate concepts.");
      return;
    }
    if (proModelLocked) {
      setError("You need a Pro subscription to use this model.");
      return;
    }

    const trimmed = sourceText.trim();
    if (trimmed.length === 0) return;

    const allChunks = chunkText(trimmed);
    const wasTruncated = allChunks.length > MAX_CHUNKS;
    const chunks = wasTruncated ? allChunks.slice(0, MAX_CHUNKS) : allChunks;
    const pendingChunks = wasTruncated ? allChunks.slice(MAX_CHUNKS) : [];

    setLoading(true);
    setError(null);
    setShowPaywall(false);
    setConcepts(null);
    setTruncated(wasTruncated);
    setTotalChunks(chunks.length);

    // Chunks are sent one at a time, in order - Promise.all-ing these would
    // fire them all at once and trip Groq's free-tier rate limit instantly.
    const accumulated: Concept[] = [];

    try {
      for (let i = 0; i < chunks.length; i++) {
        setCurrentChunk(i + 1);

        const res = await fetch("/api/ingest", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // Only the first chunk of a deck counts against the FREE daily quota
          // - continuation chunks are part of the same deck.
          body: JSON.stringify({ text: chunks[i], model: selectedModel, isFirstChunk: i === 0 }),
        });

        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.error ?? `Something went wrong on part ${i + 1} of ${chunks.length}.`);
        }

        accumulated.push(...data.concepts);

        if (i < chunks.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, CHUNK_DELAY_MS));
        }
      }

      setConcepts(accumulated);
      // Auto-persist immediately so a refresh (even before the user clicks
      // "Start studying") never loses a freshly generated deck.
      const deck = saveDeck(titleRef.current, accumulated, pendingChunks);
      setSavedDeckId(deck.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Something went wrong.";
      if (message === "FREE_LIMIT_REACHED") {
        // Swap the generic error banner for the dedicated upsell block.
        setError(null);
        setShowPaywall(true);
      } else {
        setError(message);
      }
    } finally {
      setLoading(false);
      setCurrentChunk(0);
      setTotalChunks(0);
    }
  }

  function handlePdfExtracted(extractedText: string, fileName: string) {
    setText(extractedText);
    setTitle(titleFromFileName(fileName));
    handleGenerate(extractedText);
  }

  function handleStartStudying() {
    if (!concepts || concepts.length === 0 || !savedDeckId) return;
    setStudyDeck(savedDeckId, concepts);
    router.push("/study");
  }

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-4 py-10 sm:px-6 sm:py-16">
      <h1 className="text-2xl font-semibold tracking-tight text-zinc-100">Auto-Ingest</h1>
      <p className="mt-2 text-sm text-zinc-400">
        Paste your lecture notes, textbook chapter, or a PDF below. We&apos;ll
        break it into micro-concepts ready for recall practice.
      </p>

      {status === "unauthenticated" && (
        <div className="mt-6 rounded-xl border border-white/10 bg-graphite px-4 py-3 text-sm text-zinc-300">
          You need to be signed in to generate concepts.{" "}
          <Link href="/login" className="font-medium underline">
            Sign in
          </Link>
        </div>
      )}

      <div className="mt-6">
        <PdfDropzone onExtracted={handlePdfExtracted} />
      </div>

      <div className="mt-4 flex items-center gap-3 text-xs uppercase tracking-widest text-zinc-500">
        <div className="h-px flex-1 bg-white/10" />
        or paste text
        <div className="h-px flex-1 bg-white/10" />
      </div>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Paste your notes here..."
        rows={10}
        className="mt-4 w-full resize-y rounded-2xl border border-white/10 bg-graphite p-4 text-base text-zinc-300 placeholder-zinc-600 outline-none focus:"
      />

      <label className="mt-4 block text-xs font-medium uppercase tracking-wide text-zinc-400">
        Deck title
      </label>
      <input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Untitled Notes"
        className="mt-1.5 w-full rounded-xl border border-white/10 bg-graphite px-4 py-3 text-base text-zinc-300 placeholder-zinc-600 outline-none focus:"
      />

      <label
        htmlFor="model-select"
        className="mt-6 block text-xs font-bold uppercase tracking-widest text-zinc-300"
      >
        Model
      </label>
      <div className="relative mt-1.5">
        <select
          id="model-select"
          value={selectedModel}
          onChange={(e) => setSelectedModel(e.target.value)}
          className="w-full cursor-pointer appearance-none rounded-lg border border-white/10 bg-graphite px-4 py-3 pr-11 text-base font-bold text-zinc-300 outline-none transition-all focus:-translate-x-0.5 focus:-translate-y-0.5 focus:"
        >
          {MODEL_OPTIONS.map((m) => (
            <option key={m.id} value={m.id} className="bg-graphite font-medium text-zinc-300">
              {m.label}
            </option>
          ))}
        </select>
        <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-lg font-bold text-zinc-300">
          ▾
        </span>
      </div>

      {proModelLocked && (
        <div className="mt-3 rounded-lg border border-white/10 bg-graphite px-4 py-3 text-sm font-bold text-zinc-300">
          You need a Pro subscription to use this model.
        </div>
      )}

      <button
        type="button"
        onClick={() => handleGenerate()}
        disabled={loading || text.trim().length === 0 || !isAuthenticated || proModelLocked}
        className="mt-4 self-stretch rounded-full bg-gold px-6 py-3.5 text-base font-medium text-matte transition-colors hover:bg-gold/90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 sm:self-start sm:py-2.5 sm:text-sm"
      >
        {loading ? `Generating part ${currentChunk} of ${totalChunks}...` : "Generate micro-concepts"}
      </button>

      {showPaywall && (
        <div className="mt-4 overflow-hidden rounded-2xl border border-gold/30 bg-gradient-to-br from-gold/10 via-graphite to-graphite p-6 shadow-lg shadow-gold/5">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-widest text-gold">
              ✦ Flowrecall Pro
            </span>
          </div>
          <p className="mt-3 text-lg font-semibold text-zinc-100">
            You&apos;ve reached your free limit of 1 deck per day.
          </p>
          <p className="mt-1.5 text-sm text-zinc-400">
            Upgrade to Pro to unlock unlimited AI studying.
          </p>
          <Link
            href="/pricing"
            className="mt-5 inline-flex items-center justify-center rounded-full bg-gold px-6 py-3 text-sm font-semibold text-matte shadow-md shadow-gold/20 transition-all hover:bg-gold/90 hover:shadow-gold/30 active:scale-[0.98]"
          >
            Upgrade to Pro &rarr;
          </Link>
        </div>
      )}

      {loading && totalChunks > 1 && (
        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full bg-gold transition-all"
            style={{ width: `${(currentChunk / totalChunks) * 100}%` }}
          />
        </div>
      )}

      {truncated && (
        <div className="mt-4 rounded-xl border border-white/10 bg-graphite px-4 py-3 text-sm font-medium text-zinc-300">
          To keep generation blazing fast, we processed the first section. You
          can generate the rest anytime from your Library!
        </div>
      )}

      {error && !proModelLocked && (
        <div className="mt-6 rounded-xl border border-white/10 bg-graphite px-4 py-3 text-sm text-zinc-300">
          {error}
        </div>
      )}

      {concepts && (
        <div className="mt-8 flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium text-zinc-400">
              {concepts.length} concepts generated &middot; saved to your library
            </p>
            <button
              type="button"
              onClick={handleStartStudying}
              className="rounded-full bg-gold px-5 py-2.5 text-sm font-medium text-matte transition-colors hover:bg-gold/90 active:scale-95"
            >
              Start studying &rarr;
            </button>
          </div>
          {concepts.map((c) => (
            <div
              key={c.id}
              className="rounded-xl border border-white/10 bg-graphite p-4"
            >
              <p className="text-xs font-medium uppercase tracking-wide text-gold/70">
                {c.concept}
              </p>
              <p className="mt-2 text-sm text-zinc-300">{c.question}</p>
              <p className="mt-1 text-sm text-zinc-400">{c.answer}</p>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
