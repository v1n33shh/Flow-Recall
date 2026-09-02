"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useSession } from "next-auth/react";
import type { Concept } from "@/lib/types";
import { API_FETCH_CREDENTIALS, apiUrl } from "@/lib/apiUrl";
import { MAX_ATTEMPT_LENGTH } from "@/lib/teachBackSchema";
import { listTeachBacks, saveTeachBack, type TeachBackRecord } from "@/lib/recallStorage";
import { vibrateTap } from "@/lib/haptics";

/** Explain the concept back, and be corrected.
 *
 * Everything else in this app asks the student to RECOGNISE an answer somebody else
 * wrote - the swipe, the cloze, even the ask box, where the model does the
 * explaining. This is the only place they have to produce the understanding
 * themselves, which is the difference between knowing a card and knowing a subject,
 * and the thing a flashcard app structurally cannot test.
 *
 * Three lists and no score, deliberately. A number here would become the thing they
 * optimise, and "write until the number goes up" is not the exercise; what a student
 * actually needs is which part of their own explanation was the broken one.
 *
 * Collapsed by default and never auto-focused, for the same reason ConceptAsk is:
 * every open box invites an AI call, most cards do not need one, and focusing a
 * field during a scroll entrance pops the phone keyboard mid-gesture. */

const ROWS = [
  { key: "correct", label: "You got", tone: "border-l-accent/60", text: "text-foreground" },
  { key: "missing", label: "You left out", tone: "border-l-pending/60", text: "text-muted-foreground" },
  { key: "wrong", label: "Your material says otherwise", tone: "border-l-danger/60", text: "text-muted-foreground" },
] as const;

function Debrief({ record }: { record: TeachBackRecord }) {
  return (
    <div className="rounded-xl border border-border bg-background/40 p-3">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
        {new Date(record.attemptedAt).toLocaleDateString(undefined, {
          day: "numeric",
          month: "short",
        })}
      </p>
      {/* Their own words, kept verbatim and shown first: the debrief is only
          readable next to the attempt it is about, and re-reading last month's
          attempt beside this month's is the whole reason these are stored. */}
      <p className="mt-1.5 whitespace-pre-wrap text-xs italic leading-relaxed text-muted-foreground">
        {record.attempt}
      </p>
      <div className="mt-3 space-y-2.5">
        {ROWS.map(({ key, label, tone, text }) => {
          const items = record[key];
          if (items.length === 0) return null;
          return (
            <div key={key} className={`border-l-2 pl-3 ${tone}`}>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                {label}
              </p>
              <ul className="mt-1 space-y-1">
                {items.map((item, index) => (
                  <li key={index} className={`text-sm leading-relaxed ${text}`}>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function ConceptTeachBack({
  unitId,
  concept,
}: {
  unitId: string;
  concept: Concept;
}) {
  const { data: session } = useSession();
  const userId = session?.user?.id;

  const [open, setOpen] = useState(false);
  const [history, setHistory] = useState<TeachBackRecord[]>([]);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Read on mount rather than on expand, so the collapsed pill can say how many
  // attempts are already there - which is the only thing that makes it worth opening.
  useEffect(() => {
    if (!userId) return;
    let alive = true;
    listTeachBacks(userId, unitId)
      .then((rows) => {
        if (alive) setHistory(rows);
      })
      .catch((err) => console.error("listTeachBacks failed", err));
    return () => {
      alive = false;
    };
  }, [userId, unitId]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const attempt = draft.trim();
    if (!attempt || pending || !userId) return;

    setPending(true);
    setError(null);
    try {
      const res = await fetch(apiUrl("/api/teach-back"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: API_FETCH_CREDENTIALS,
        body: JSON.stringify({
          label: concept.concept,
          question: concept.question,
          answer: concept.answer,
          explanation: concept.explanation ?? "",
          attempt,
          // Lets the server roll the daily cap over at the student's own midnight
          // rather than UTC's, exactly as the cloze grader does.
          timezoneOffsetMinutes: new Date().getTimezoneOffset(),
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.error ?? "Couldn't read your explanation. Please try again.");
      }

      // Saved before it is rendered, so closing the app straight after reading the
      // debrief does not lose it - and the attempt is theirs, not ours to drop.
      const saved = await saveTeachBack({
        userId,
        unitId,
        attempt,
        correct: Array.isArray(data.correct) ? data.correct : [],
        missing: Array.isArray(data.missing) ? data.missing : [],
        wrong: Array.isArray(data.wrong) ? data.wrong : [],
      });
      setHistory((prev) => [...prev, saved]);
      setDraft("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setPending(false);
    }
  }

  // Signed out the engine records nothing, so there is nowhere to keep an attempt -
  // the same posture the rest of the engine takes.
  if (!userId) return null;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          vibrateTap();
          setOpen(true);
        }}
        className="mt-2 inline-flex items-center gap-2 rounded-full border border-border bg-foreground/5 px-4 py-2 text-xs font-medium text-foreground transition-all duration-200 hover:bg-foreground/10 active:scale-[0.98]"
      >
        <span aria-hidden="true" className="text-accent">✎</span>
        {history.length > 0 ? `Your explanations (${history.length})` : "Explain it back"}
      </button>
    );
  }

  return (
    <div className="mt-2 rounded-2xl border border-border bg-surface/60 p-4 md:backdrop-blur-xl">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          Explain it in your own words
        </p>
        <button
          type="button"
          onClick={() => {
            vibrateTap();
            setOpen(false);
          }}
          aria-label="Close"
          className="text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          Done
        </button>
      </div>

      {history.length > 0 && (
        <div className="mt-3 space-y-3">
          {history.map((row) => (
            <Debrief key={row.id} record={row} />
          ))}
        </div>
      )}

      <form onSubmit={handleSubmit} className="mt-3">
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Say it the way you would to someone who has not read this yet."
          disabled={pending}
          rows={4}
          maxLength={MAX_ATTEMPT_LENGTH}
          autoCapitalize="sentences"
          className="w-full resize-none rounded-xl border border-border bg-background/60 px-3 py-2.5 text-sm leading-relaxed text-foreground placeholder:text-muted-foreground/70 outline-none transition-colors focus:border-accent/60 disabled:opacity-60"
        />
        <div className="mt-2 flex items-center justify-between gap-3">
          {/* Only once it is close to mattering. A counter on an empty box is
              pressure to fill it, and this box wants a paragraph, not a target. */}
          <span className="text-[10px] tabular-nums text-muted-foreground">
            {draft.length > MAX_ATTEMPT_LENGTH - 300
              ? `${MAX_ATTEMPT_LENGTH - draft.length} left`
              : ""}
          </span>
          <button
            type="submit"
            disabled={pending || !draft.trim()}
            className="shrink-0 rounded-full bg-accent px-4 py-2 text-xs font-semibold text-accent-foreground ring-1 ring-inset ring-accent/30 shadow-[inset_0_1px_0_rgba(255,255,255,0.15),0_8px_24px_-6px_rgba(0,0,0,0.4)] transition-all duration-200 hover:bg-accent/90 active:scale-[0.98] disabled:opacity-50"
          >
            {pending ? "…" : history.length > 0 ? "Try again" : "Check my explanation"}
          </button>
        </div>
      </form>

      <AnimatePresence>
        {pending && (
          <motion.p
            key="reading"
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
            Reading what you wrote
          </motion.p>
        )}
      </AnimatePresence>

      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
    </div>
  );
}
