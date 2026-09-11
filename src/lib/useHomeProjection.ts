"use client";

import { useSession } from "next-auth/react";
import type { Deck } from "@/lib/types";
import { soonestExamDate } from "@/lib/recallModel";
import { useMemoryOverview, type MemoryOverview } from "@/lib/recallStorage";

/** Does the engine have a real prediction to show, and what is it.
 *
 * Read ONCE, at the top of the home screen, and handed to both things that depend on it.
 * That is the entire reason this hook exists: the hero number and the projection panel are
 * two renderings of the same question - "can we print a prediction yet?" - and if each
 * asked independently they could disagree for a frame and show two heroes, or none. It
 * also halves the IndexedDB work, since `useMemoryOverview` is a real read.
 */
export function useHomeProjection(decks: readonly Deck[]): {
  overview: MemoryOverview;
  loading: boolean;
  signedIn: boolean;
  /** True only when there is an account AND something has actually been answered. A full
   * library nobody has opened projects nothing - every unit is `met`, and "0 of 94" is
   * arithmetically true and reads as an accusation. */
  hasProjection: boolean;
} {
  const { data: session } = useSession();
  const userId = session?.user?.id;
  // Clock-free on purpose: a component may not read the clock while rendering, so which
  // exam is resolved here and whether it is still ahead is decided inside the hook.
  const { overview, loading } = useMemoryOverview(userId, soonestExamDate(decks));

  // `met` is a unit with no credited success, so this is "has anything been answered"
  // rather than "does a library exist".
  const studied = overview.summary.units - overview.summary.met;
  return {
    overview,
    loading,
    signedIn: Boolean(userId),
    hasProjection: Boolean(userId) && !loading && overview.total > 0 && studied > 0,
  };
}
