"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import type { Deck } from "@/lib/types";
import { daysUntilExam, localMidnight } from "@/lib/recallModel";
import { applyExamDateToMemory } from "@/lib/recallStorage";
import { setDeckExamDate } from "@/lib/storage";
import { vibrateTap } from "@/lib/haptics";

/** When this deck is examined, and the one thing that makes the engine drill harder.
 *
 * `desiredRetentionFor` has always accepted a `daysUntilExam` and never been given
 * one. Inside 21 days it lifts this deck's retention floor to 0.95, which shortens
 * every interval in it - so this control is not a label, it changes what the app asks
 * for. It also anchors the home projection to a real paper instead of a generic week.
 *
 * A native `<input type="date">` on purpose: it opens the OS date picker on the phone
 * this ships to, is keyboard- and screen-reader-accessible for free, and needs no
 * dependency. Custom pickers are where accessibility quietly goes to die.
 *
 * Signed out it renders nothing - the engine records nothing without an account, so
 * there is no schedule for a date to tighten. */

/** `YYYY-MM-DD` in LOCAL terms, which is what the input wants. `toISOString` would
 * hand back the previous day for anyone east of UTC after their afternoon. */
function toInputValue(examDate: number | undefined): string {
  if (examDate === undefined) return "";
  const d = new Date(examDate);
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join("-");
}

export default function DeckExamDate({ deck }: { deck: Deck }) {
  const { data: session } = useSession();
  const userId = session?.user?.id;
  const [busy, setBusy] = useState(false);

  async function commit(examDate: number | null) {
    setBusy(true);
    try {
      setDeckExamDate(deck.id, examDate);
      // Existing memory rows carry the target that was in force when they were last
      // written, so the deck row alone would leave everything already studied on the
      // old schedule. Clearing runs the same sweep in reverse.
      if (userId) await applyExamDateToMemory(userId, deck.id);
    } catch (error) {
      console.error("exam date sweep failed", error);
    } finally {
      setBusy(false);
    }
  }

  if (!userId) return null;

  const days = daysUntilExam(deck.examDate);
  const set = deck.examDate !== undefined;

  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="shrink-0">Exam</span>
        <input
          type="date"
          value={toInputValue(deck.examDate)}
          disabled={busy}
          onChange={(event) => {
            const value = event.target.value;
            if (!value) {
              void commit(null);
              return;
            }
            // Parsed from the parts rather than `new Date(value)`, which reads a bare
            // `YYYY-MM-DD` as UTC midnight - the previous evening for half the world.
            const [y, m, d] = value.split("-").map(Number);
            void commit(localMidnight(new Date(y, m - 1, d)));
          }}
          className="min-w-0 rounded-lg border border-border bg-background/60 px-2 py-1 text-xs text-foreground outline-none transition-colors focus:border-accent/60 disabled:opacity-60"
        />
      </label>

      {set && days !== null && (
        <span className="text-xs tabular-nums text-muted-foreground">
          {days > 1
            ? `in ${days} days`
            : days === 1
              ? "tomorrow"
              : days === 0
                ? "today"
                : "passed"}
        </span>
      )}

      {set && (
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            vibrateTap();
            void commit(null);
          }}
          className="rounded-full border border-border bg-foreground/5 px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors duration-200 hover:bg-foreground/10 active:scale-[0.98] disabled:opacity-60"
        >
          Clear
        </button>
      )}
    </div>
  );
}
