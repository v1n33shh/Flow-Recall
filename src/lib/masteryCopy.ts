import type { MasteryLevel } from "@/lib/recallModel";

/** What the five mastery levels are called, and what each one means.
 *
 * WHY THIS FILE EXISTS. The same five levels were being named in four different places,
 * and they disagreed:
 *
 *   RevisionSheet   met -> "Met"        fading -> "Fading"
 *   MapNodeSheet    met -> "Met once"   fading -> "Fading"
 *   MemoryOverview                      fading -> "Slipping"
 *   the map legend  met/familiar/holding collapsed to "Not yet"
 *
 * So a concept could be "Slipping" on the home screen and "Fading" on the map, and a
 * student had no way to know those were the same word for the same state. Four maps also
 * meant adding a level could half-land: three screens updated, one silently falling back
 * to nothing.
 *
 * "Fading" wins over "Slipping" because it is what the type itself is called, and what
 * two of the three call sites already said. "Met once" wins over "Met" because "Met" on
 * its own reads as a verb.
 *
 * WHY THE MEANINGS ARE HERE TOO. Nothing in the app ever explained what any of these
 * words meant - the one good sentence lived in CompletionSlide and nowhere else. The
 * definitions are not decoration: they are the memory research stated as a rule. "Solid"
 * requires two different question formats and a gap of a week, which is retrieval
 * practice and the spacing effect written as an acceptance test. A student who reads why
 * "solid" is hard to reach has learned the thing the app is built on.
 *
 * These describe `masteryFor` in recallModel.ts. If that function's thresholds change,
 * these sentences are wrong and have to change with it.
 */
export const MASTERY_LABEL: Record<MasteryLevel, string> = {
  met: "Met once",
  familiar: "Familiar",
  holding: "Holding",
  solid: "Solid",
  fading: "Fading",
};

/** One line each, in the second person, short enough to sit under a chip on a phone. */
export const MASTERY_MEANING: Record<MasteryLevel, string> = {
  met: "You have seen this, but never answered it correctly yet.",
  familiar: "You have got it right, but only in one format so far.",
  holding: "Right in two different formats. It needs the week-long gap now.",
  solid: "Answered two ways, including once after a week away. That gap is the proof.",
  fading: "You had this solidly, and it has now slipped below where it should be.",
};

/** The three groups the map's dots can actually distinguish.
 *
 * The map colours a node by only three states, because a five-way colour code on an
 * 8px dot is a code nobody can read. "Not yet" covers met, familiar and holding - a
 * grouping, not a sixth level, which is why it lives here rather than in MASTERY_LABEL.
 */
export const MASTERY_DOT_LABEL = {
  solid: MASTERY_LABEL.solid,
  fading: MASTERY_LABEL.fading,
  notYet: "Not yet",
} as const;
