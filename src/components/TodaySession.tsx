"use client";

import { startTransition, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import { useSession } from "next-auth/react";
import type { Deck } from "@/lib/types";
import { buildSession } from "@/lib/sessionBuilder";
import { readSessionInputs, type SessionInputs } from "@/lib/recallStorage";
import { setStudySession } from "@/lib/storage";
import { vibrateTap } from "@/lib/haptics";

/** "Got 20 minutes?" - the app answering what to study, instead of asking.
 *
 * The deck grid below this asks the student to decide, which is the same question
 * Anki hands back and the reason a scheduler that knew exactly what was slipping
 * still felt like nothing. This is the engine's output made visible: what has
 * decayed, how long it will take, and - the line no other flashcard app can
 * print - what it has decided NOT to ask tonight.
 *
 * Signed out it renders nothing at all: the engine records nothing without an
 * account, so there is no memory to schedule against and a "Got 20 minutes?" card
 * built on no data would be a lie. */

const BUDGETS = [10, 20, 40] as const;

export default function TodaySession({ decks }: { decks: Deck[] }) {
  const router = useRouter();
  const { data: session } = useSession();
  const userId = session?.user?.id;

  const [inputs, setInputs] = useState<SessionInputs | null>(null);
  const [budget, setBudget] = useState<number>(20);
  const [starting, setStarting] = useState(false);

  // The three reads happen once per engine change, not once per chip tap - the
  // review log only grows, and re-ranking is pure.
  useEffect(() => {
    if (!userId || decks.length === 0) return;
    let alive = true;
    const read = () => {
      void readSessionInputs(userId, decks)
        .then((next) => { if (alive) setInputs(next); })
        .catch((error) => console.error("readSessionInputs failed", error));
    };
    read();
    window.addEventListener("recall-engine-update", read);
    return () => {
      alive = false;
      window.removeEventListener("recall-engine-update", read);
    };
  }, [userId, decks]);

  const plan = useMemo(
    () => (inputs ? buildSession({ ...inputs, budgetMinutes: budget }) : null),
    [inputs, budget],
  );

  function handleStart() {
    if (!plan || plan.items.length === 0) return;
    vibrateTap();
    setStarting(true);
    setStudySession(plan.items);
    startTransition(() => router.push("/study"));
  }

  // Nothing to schedule against yet, or still reading. Rendering a skeleton here
  // would put a loading shimmer above the student's own library on every visit for
  // the sake of two IndexedDB reads.
  if (!userId || decks.length === 0 || !plan) return null;

  const nothingDue = plan.items.length === 0;

  return (
    <motion.section
      aria-labelledby="tonight-heading"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 280, damping: 24 }}
      className="relative mt-12 w-full max-w-2xl overflow-hidden rounded-3xl border border-border bg-surface/60 p-6 text-left shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] md:backdrop-blur-xl"
    >
      {/* The ambient bloom the rest of the app uses for a primary surface. */}
      <div className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-accent/15 blur-3xl" />

      <div className="relative">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          Tonight
        </p>

        <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
          <h2 id="tonight-heading" className="text-2xl font-bold tracking-tight text-foreground">
            {nothingDue ? "Nothing needs you tonight" : `Got ${budget} minutes?`}
          </h2>
          {!nothingDue && (
            <div className="flex gap-1.5">
              {BUDGETS.map((minutes) => (
                <button
                  key={minutes}
                  type="button"
                  onClick={() => { vibrateTap(); setBudget(minutes); }}
                  aria-pressed={budget === minutes}
                  className={`rounded-full border px-3 py-1 text-[11px] font-semibold tabular-nums transition-all duration-200 active:scale-[0.98] ${
                    budget === minutes
                      ? "border-accent/30 bg-accent text-accent-foreground ring-1 ring-inset ring-accent/30"
                      : "border-border bg-foreground/5 text-muted-foreground hover:bg-foreground/10"
                  }`}
                >
                  {minutes}m
                </button>
              ))}
            </div>
          )}
        </div>

        {nothingDue ? (
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            {plan.resting > 0
              ? `Everything is holding. ${plan.resting} concept${plan.resting === 1 ? " is" : "s are"} resting — you have ${plan.resting === 1 ? "it" : "them"} solidly, so drilling ${plan.resting === 1 ? "it" : "them"} now would buy you almost nothing.`
              : "No concepts are due. Generate more material, or study a deck below anyway."}
          </p>
        ) : (
          <>
            <p className="mt-3 text-sm text-muted-foreground tabular-nums">
              {plan.slipping > 0 && (
                <>
                  <span className="font-medium text-foreground">{plan.slipping} slipping</span>
                  {plan.urgent > 0 && (
                    <span className="text-pending"> · {plan.urgent} nearly gone</span>
                  )}
                </>
              )}
              {plan.slipping > 0 && plan.fresh > 0 && " · "}
              {plan.fresh > 0 && `${plan.fresh} new`}
              {plan.deckCount > 1 && ` · across ${plan.deckCount} decks`}
            </p>

            {/* The restraint. summariseDeck's own docblock calls this the number
                worth showing most, and it is only sayable because due-ness here is a
                shortfall against each concept's target rather than a calendar date -
                so the engine can genuinely conclude "not tonight". */}
            {plan.resting > 0 && (
              <p className="mt-1.5 text-sm text-muted-foreground">
                {plan.resting} resting — we&apos;re not asking about{" "}
                {plan.resting === 1 ? "that one" : "those"} tonight.
              </p>
            )}

            <button
              type="button"
              onClick={handleStart}
              disabled={starting}
              className="mt-5 w-full rounded-full bg-accent px-6 py-3.5 text-sm font-semibold text-accent-foreground ring-1 ring-inset ring-accent/30 shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_8px_28px_-6px_rgba(0,0,0,0.45)] transition-all duration-200 hover:bg-accent/90 active:scale-[0.98] disabled:opacity-70 sm:w-auto sm:px-8"
            >
              {starting
                ? "Starting…"
                : `Start ${plan.items.length} card${plan.items.length === 1 ? "" : "s"} · ~${Math.max(plan.estimatedMinutes, 1)} min`}
            </button>

            {plan.deferred > 0 && (
              <p className="mt-2 text-xs text-muted-foreground">
                {plan.deferred} more waiting — a longer session picks {plan.deferred === 1 ? "it" : "them"} up.
              </p>
            )}
          </>
        )}
      </div>
    </motion.section>
  );
}
