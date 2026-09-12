"use client";

import { startTransition, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import type { Deck } from "@/lib/types";
import { buildSession } from "@/lib/sessionBuilder";
import { readSessionInputs, type SessionInputs } from "@/lib/recallStorage";
import { setStudySession } from "@/lib/storage";
import { vibrateTap } from "@/lib/haptics";

/** The three offers, in minutes. A budget rather than a card count, because the student
 * knows how long they have and does not know what 40 cards costs. */
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

  // Nothing at all when there is nothing due. An introduction page does not need to
  // announce an empty queue, and "nothing needs you tonight" sitting above a pitch reads
  // as a dead end rather than as the good news it is - the completion slide and the
  // library both say it where it means something.
  if (nothingDue) return null;

  return (
    <section
      aria-labelledby="tonight-heading"
      // NO motion/react HERE ANY MORE, AND IT WAS THE LAST ONE ON THIS ROUTE. page.tsx's
      // header claims the home page mounts no JS animation runtime; that was true of the
      // file and false of the route, because this child still imported a spring for one
      // entrance. `.fr-rise` is the same move as a CSS keyframe, on the compositor.
      //
      // `p-6` rather than `p-4`, and no `mt-10`: this card is the primary action of the
      // slab it sits in now rather than an afterthought under two buttons, so it gets the
      // padding of a card and the parent owns the space above it.
      className="fr-rise w-full max-w-md rounded-2xl border border-border bg-surface/60 p-6 text-left md:backdrop-blur-xl"
    >
      {/* ONE LINE, NO COUNTS. This slot carried "Start 108 cards", then "11 slipping · 97
          new · across 6 decks", then "Eleven questions are nearly gone" - each one a wall
          of arithmetic on a page whose job is to introduce the app. A returning student
          needs a door back into tonight, not a readout. The numbers live where they mean
          something: per deck in the Library, and at the end of a session. */}
      <p id="tonight-heading" className="text-sm text-muted-foreground">
        Pick up where you left off · about{" "}
        <span className="tabular-nums text-foreground">{budget}</span> minutes
      </p>

      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={handleStart}
          disabled={starting}
          className="rounded-full bg-accent px-6 py-2.5 text-sm font-semibold text-accent-foreground ring-1 ring-inset ring-accent/30 shadow-[inset_0_1px_0_rgba(255,255,255,0.18)] transition-all duration-200 active:scale-[0.98] disabled:opacity-70"
        >
          {starting ? "Starting…" : "Continue"}
        </button>

        {/* The only control kept: how long. Removing it would take away the student's say
            over session length, which is a function rather than a decoration. */}
        <div className="flex gap-1.5">
          {BUDGETS.map((minutes) => (
            <button
              key={minutes}
              type="button"
              onClick={() => { vibrateTap(); setBudget(minutes); }}
              aria-pressed={budget === minutes}
              aria-label={`${minutes} minute session`}
              className={`rounded-full border px-2.5 py-1.5 text-[11px] font-medium tabular-nums transition-all duration-200 active:scale-[0.98] ${
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
    </section>
  );
}
