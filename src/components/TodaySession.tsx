"use client";

import { startTransition, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, useReducedMotion } from "motion/react";
import { useSession } from "next-auth/react";
import type { Deck } from "@/lib/types";
import { buildSession } from "@/lib/sessionBuilder";
import { readSessionInputs, type SessionInputs } from "@/lib/recallStorage";
import { setStudySession } from "@/lib/storage";
import { vibrateTap } from "@/lib/haptics";
import { sessionSentence } from "@/lib/sessionSentence";
import { whyTonight } from "@/lib/whyTonight";

/** The three offers, in minutes. A budget rather than a card count, because the student
 * knows how long they have and does not know what 40 cards costs. */
const BUDGETS = [10, 20, 40] as const;

export default function TodaySession({ decks }: { decks: Deck[] }) {
  const router = useRouter();
  const { data: session } = useSession();
  const reduceMotion = useReducedMotion();
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
  // The statement, and the explanation under it. Both pure functions over the plan, so the
  // copy lives somewhere reviewable and testable rather than inside this JSX - see
  // sessionSentence.ts for why the card count never appears in either.
  const sentence = sessionSentence(plan);
  const why = whyTonight(plan);

  return (
    <motion.section
      aria-labelledby="tonight-heading"
      initial={reduceMotion ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 280, damping: 24 }}
      className="relative w-full max-w-xl text-left"
    >
      <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
        Tonight
      </p>

      {/* THE STATEMENT. Weight 540, not 600 - an in-between weight only a variable font
          can render, which Geist is (verified by measuring 400/500/540/600 and finding
          all four distinct). Superhuman's system calls these mid-weights "quiet warmth",
          and that warmth is the entire reason this screen leads with a sentence in
          arbitrary-weight type instead of a 72pt numeral. Negative tracking and a 1.1
          line-height give it the editorial density that goes with it. */}
      <h2
        id="tonight-heading"
        className="mt-3 font-sans text-[28px] leading-[1.1] tracking-[-0.02em] text-foreground sm:text-[34px]"
        style={{ fontWeight: 540 }}
      >
        {sentence.lead}
      </h2>
      {sentence.offer && (
        <p className="mt-2 text-base font-normal leading-relaxed text-muted-foreground">
          {sentence.offer}
        </p>
      )}

      {!nothingDue && (
        <>
          <div className="mt-6 flex items-center gap-2">
            <button
              type="button"
              onClick={handleStart}
              disabled={starting}
              className="rounded-full bg-accent px-8 py-3.5 text-sm font-semibold text-accent-foreground ring-1 ring-inset ring-accent/30 shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_8px_28px_-6px_rgba(0,0,0,0.45)] transition-all duration-200 active:scale-[0.98] disabled:opacity-70"
            >
              {/* No card count. "Start 108 cards" was a wall; the chips beside it already
                  say how long, and the sentence above says what for. */}
              {starting ? "Starting…" : "Start"}
            </button>

            <div className="flex gap-1.5">
              {BUDGETS.map((minutes) => (
                <button
                  key={minutes}
                  type="button"
                  onClick={() => { vibrateTap(); setBudget(minutes); }}
                  aria-pressed={budget === minutes}
                  aria-label={`${minutes} minute session`}
                  className={`rounded-full border px-3 py-2 text-[11px] font-medium tabular-nums transition-all duration-200 active:scale-[0.98] ${
                    budget === minutes
                      ? "border-foreground/30 bg-foreground/10 text-foreground"
                      : "border-border text-muted-foreground"
                  }`}
                >
                  {minutes}m
                </button>
              ))}
            </div>
          </div>

          {/* No number here on purpose. A student with a full library sees a deferred
              count in the hundreds, and "379 more waiting" is the same wall as the card
              count this screen just removed - it reframes a finished session as a rounding
              error. That there IS more is worth saying; how much is not. */}
          {plan.deferred > 0 && (
            <p className="mt-3 text-xs text-muted-foreground">
              More is waiting — a longer session reaches further down the list.
            </p>
          )}
        </>
      )}

      {/* WHY IT LOOKS LIKE THIS. The content about the app, and it is not onboarding: it
          explains the decision the scheduler just made, using the mechanism behind it. */}
      {why && (
        <div className="mt-8 border-t border-border pt-5">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70">
            {why.title}
          </p>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{why.body}</p>
        </div>
      )}
    </motion.section>
  );
}
