"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { useSession } from "next-auth/react";
import type { Concept } from "@/lib/types";
import { API_FETCH_CREDENTIALS, apiUrl } from "@/lib/apiUrl";
import { listAsks, saveAsk, type AskRecord } from "@/lib/recallStorage";
import { vibrateTap } from "@/lib/haptics";

/** Ask a question about this concept, and keep the answer.
 *
 * The gap this closes: a student who reads the explanation and still does not
 * follow it has no move left. They cannot ask the app anything - they can only
 * answer the card wrong again. That is the difference between a flashcard app and
 * something worth relying on, and it is the one thing Anki structurally cannot do.
 *
 * Answers are stored per (user x concept) in the recall engine's database rather
 * than on the deck, so they come back on the next encounter and accumulate into
 * that person's own route into the concept. Deliberately collapsed by default:
 * every open box is an invitation to spend an AI lookup, and most cards do not
 * need one. */
export default function ConceptAsk({
  unitId,
  concept,
}: {
  unitId: string;
  concept: Concept;
}) {
  const { data: session } = useSession();
  const userId = session?.user?.id;

  const [open, setOpen] = useState(false);
  const [history, setHistory] = useState<AskRecord[]>([]);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [limitReached, setLimitReached] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Read the saved conversation as soon as the card exists, not on expand: the
  // pill has to be able to say how many answers are already waiting, which is the
  // only thing that makes a collapsed control worth opening.
  useEffect(() => {
    if (!userId) return;
    let alive = true;
    listAsks(userId, unitId)
      .then((rows) => { if (alive) setHistory(rows); })
      .catch((err) => console.error("listAsks failed", err));
    return () => { alive = false; };
  }, [userId, unitId]);

  async function handleAsk(event: React.FormEvent) {
    event.preventDefault();
    const ask = draft.trim();
    if (!ask || pending || !userId) return;

    setPending(true);
    setError(null);
    try {
      const res = await fetch(apiUrl("/api/ask"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: concept.concept,
          question: concept.question,
          answer: concept.answer,
          explanation: concept.explanation ?? "",
          ask,
        }),
        credentials: API_FETCH_CREDENTIALS,
      });
      const data = await res.json().catch(() => null);

      if (res.status === 403 && data?.error === "LIMIT_REACHED") {
        setLimitReached(true);
        return;
      }
      if (!res.ok || typeof data?.answer !== "string") {
        throw new Error(data?.error ?? "Couldn't get an answer. Please try again.");
      }

      // Saved before it is rendered, so a student who closes the app straight
      // after reading it still has it next time - they spent a lookup on it.
      const saved = await saveAsk({
        userId,
        unitId,
        question: ask,
        answer: data.answer,
        beyondMaterial: data.beyondMaterial === true,
      });
      setHistory((prev) => [...prev, saved]);
      setDraft("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setPending(false);
    }
  }

  // Signed out the engine records nothing at all, so there is nowhere to keep an
  // answer and nothing to show - the same posture the rest of the engine takes.
  if (!userId) return null;

  return (
    <div className="mt-3">
      {!open ? (
        <button
          type="button"
          onClick={() => {
            vibrateTap();
            setOpen(true);
            // Focus after the row has mounted. Deliberately only on an explicit
            // tap - the cloze input learned the hard way that focusing during a
            // scroll-snap entrance pops the keyboard mid-gesture.
            requestAnimationFrame(() => inputRef.current?.focus());
          }}
          className="inline-flex items-center gap-2 rounded-full border border-border bg-foreground/5 px-4 py-2 text-xs font-medium text-foreground transition-all duration-200 hover:bg-foreground/10 active:scale-[0.98]"
        >
          <span aria-hidden="true" className="text-accent">✦</span>
          {history.length > 0 ? `Your questions (${history.length})` : "Ask about this"}
        </button>
      ) : (
        <div className="rounded-2xl border border-border bg-surface/60 p-4 md:backdrop-blur-xl">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              Ask about this concept
            </p>
            <button
              type="button"
              onClick={() => { vibrateTap(); setOpen(false); }}
              aria-label="Close"
              className="text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              Done
            </button>
          </div>

          {history.length > 0 && (
            <div className="mt-3 space-y-3">
              {history.map((row) => (
                <div key={row.id} className="rounded-r-xl border-l-2 border-l-accent/50 pl-3">
                  <p className="text-xs font-medium text-foreground">{row.question}</p>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{row.answer}</p>
                  {row.beyondMaterial && (
                    <p className="mt-1.5 inline-block rounded-full border border-pending/40 bg-pending/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-pending">
                      Beyond your material
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}

          {limitReached ? (
            <div className="mt-3 rounded-xl border border-accent/30 bg-accent/5 p-3 text-center">
              <p className="text-xs text-muted-foreground">
                You&apos;ve used all your free AI lookups. Pro asks as many questions as you need.
              </p>
              <Link
                href="/pricing"
                className="mt-2 inline-block rounded-full bg-accent px-4 py-2 text-xs font-semibold text-accent-foreground ring-1 ring-inset ring-accent/30 shadow-[inset_0_1px_0_rgba(255,255,255,0.15),0_8px_24px_-6px_rgba(0,0,0,0.4)] transition-all duration-200 hover:bg-accent/90 active:scale-[0.98]"
              >
                Upgrade to Pro
              </Link>
            </div>
          ) : (
            <form onSubmit={handleAsk} className="mt-3 flex items-center gap-2">
              <input
                ref={inputRef}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="Why does this happen?"
                disabled={pending}
                autoComplete="off"
                autoCapitalize="sentences"
                maxLength={300}
                className="min-w-0 flex-1 rounded-full border border-border bg-background/60 px-4 py-2 text-sm text-foreground placeholder:text-muted-foreground/70 outline-none transition-colors focus:border-accent/60 disabled:opacity-60"
              />
              <button
                type="submit"
                disabled={pending || !draft.trim()}
                className="shrink-0 rounded-full bg-accent px-4 py-2 text-xs font-semibold text-accent-foreground ring-1 ring-inset ring-accent/30 shadow-[inset_0_1px_0_rgba(255,255,255,0.15),0_8px_24px_-6px_rgba(0,0,0,0.4)] transition-all duration-200 hover:bg-accent/90 active:scale-[0.98] disabled:opacity-50"
              >
                {pending ? "…" : "Ask"}
              </button>
            </form>
          )}

          <AnimatePresence>
            {pending && (
              <motion.p
                key="thinking"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="mt-3 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-widest text-accent"
              >
                <span className="relative flex h-3 w-3">
                  <span className="absolute inset-0 rounded-full bg-accent/40 blur-[5px]" />
                  <svg className="relative h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
                    <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                  </svg>
                </span>
                Thinking
              </motion.p>
            )}
          </AnimatePresence>

          {error && <p className="mt-2 text-xs text-danger">{error}</p>}
        </div>
      )}
    </div>
  );
}
