"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { IMPORTANCE_DEFAULT, IMPORTANCE_STARRED } from "@/lib/recallModel";
import { setUnitImportance, unitImportance } from "@/lib/recallStorage";
import { vibrateTap } from "@/lib/haptics";

/** Mark a concept as one that matters more than the rest.
 *
 * What it actually does, which is why it is worth a control at all: `importance` is the
 * one input the scheduler takes from the student rather than from their answers, and
 * until now every concept carried the same flat IMPORTANCE_DEFAULT. Starring lifts the
 * retention target from 0.905 to 0.95 - roughly a third less forgetting allowed - so
 * the card comes back sooner and stays in rotation. It is the difference between a deck
 * the engine treats as uniform and one that knows what the exam is actually about.
 *
 * Labelled, not a bare icon. A lone star glyph does not say whether it is showing state
 * or offering an action, and there is no hover on the phone this ships to to
 * disambiguate it - the same reason the deep-dive control here is a bordered button
 * rather than an underlined-on-hover link.
 *
 * Renders nothing at all until the unit is known. A star that appears unstarred while
 * the read is in flight would flip under the student's thumb, and a tap landing in that
 * window would write the value it was already at. */
export default function ConceptStar({ unitId }: { unitId: string }) {
  const { data: session } = useSession();
  const userId = session?.user?.id;
  const [importance, setImportance] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    unitImportance(userId, unitId)
      .then((value) => {
        if (!cancelled) setImportance(value);
      })
      .catch(() => {
        // A failed read leaves the control hidden rather than guessing at a state, for
        // the same reason the allowance line on /ingest omits itself: a wrong answer
        // here invites a tap that writes the value it is already at.
      });
    return () => {
      cancelled = true;
    };
  }, [userId, unitId]);

  if (!userId || importance === null) return null;

  const starred = importance >= IMPORTANCE_STARRED;

  async function toggle() {
    if (saving || !userId) return;
    vibrateTap();
    const next = starred ? IMPORTANCE_DEFAULT : IMPORTANCE_STARRED;
    // Optimistic, because the write re-dates every memory row for this concept and the
    // student should not watch a spinner to find out whether their own tap landed.
    setImportance(next);
    setSaving(true);
    try {
      await setUnitImportance(userId, unitId, next);
    } catch {
      setImportance(starred ? IMPORTANCE_STARRED : IMPORTANCE_DEFAULT);
    } finally {
      setSaving(false);
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={starred}
      className={`mt-3 inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition-all duration-200 active:scale-[0.97] ${
        starred
          ? "border-accent/40 bg-accent/10 text-accent"
          : "border-border bg-transparent text-muted-foreground hover:bg-foreground/10"
      }`}
    >
      <span aria-hidden="true">{starred ? "★" : "☆"}</span>
      {starred ? "Starred - shown more often" : "Star this concept"}
    </button>
  );
}
