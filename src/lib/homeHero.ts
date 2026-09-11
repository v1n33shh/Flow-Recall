import type { Deck } from "@/lib/types";
import { getProgress } from "@/lib/storage";

/** Which number the home screen leads with, and why that is the honest one.
 *
 * The app's best figure is the retention projection - "61 of 94 concepts you'll still
 * recall" - but it cannot exist for most of the people who open the app. `MemoryOverview`
 * returns null unless there is an account AND something has actually been answered
 * (`studied === 0` blocks it even when a library is full). So a new student was shown a
 * marketing headline instead, which is how the home screen ended up reading as a landing
 * page inside an app somebody had already installed.
 *
 * There are three honest states, and this decides between them. Pure, so the decision is
 * testable without rendering anything:
 *
 *   `projection` - signed in, something answered. The real number, and the best one.
 *   `progress`   - a deck has been started but the engine has nothing to project from.
 *                  Counts answered concepts out of the deck, straight from localStorage,
 *                  which needs no account at all.
 *   `waiting`    - a library exists, untouched. The number is simply how much is there.
 *   `empty`      - no decks. Nothing true to say, so the caller shows nothing.
 *
 * The ladder matters as much as any single rung: a signed-out student watches a local
 * count move, and signing in turns that same slot into a prediction. That is a better
 * argument for an account than any copy, because they have already seen the smaller
 * version of it work.
 */

export type HomeHero =
  | { kind: "projection" }
  | { kind: "progress"; deck: Deck; answered: number; total: number }
  | { kind: "waiting"; deck: Deck; total: number }
  | { kind: "empty" };

/** How many of a deck's concepts the student has actually answered.
 *
 * `resolvedKeys`, not `masteredIds`, and the difference matters more than it looks.
 * `masteredIds` is the library's "N mastered" bar, and mastery needs BOTH of a concept's
 * lanes answered correctly - so a student who answers six cards would watch a hero number
 * that says "answered" sit at zero. A progress figure that does not move while you make
 * progress is worse than no figure at all.
 *
 * `resolvedKeys` is `${conceptId}::${lane}` per answered lane, so the distinct concept
 * ids in it are exactly "concepts I have been asked about and dealt with" - which is what
 * the word on screen says. Counted as a set because two lanes of one concept are one
 * concept.
 *
 * Falls back to `masteredIds` for sessions saved before `resolvedKeys` existed, which is
 * what that field's own optionality is there for. */
export function deckProgress(deck: Deck): number {
  const progress = getProgress(deck.id);
  if (!progress) return 0;

  const answered = progress.resolvedKeys
    ? new Set(progress.resolvedKeys.map((key) => key.split("::")[0])).size
    : progress.masteredIds.length;
  return Math.min(answered, deck.concepts.length);
}

/** The deck the student is most likely to mean: the one they have started and not
 * finished, else the most recently touched one. */
function leadDeck(decks: readonly Deck[]): Deck | null {
  let started: Deck | null = null;
  let startedAt = -Infinity;
  let newest: Deck | null = null;
  let newestAt = -Infinity;

  for (const deck of decks) {
    const touched = deck.updatedAt ?? deck.createdAt;
    if (touched > newestAt) {
      newestAt = touched;
      newest = deck;
    }
    const answered = deckProgress(deck);
    if (answered > 0 && answered < deck.concepts.length && touched > startedAt) {
      startedAt = touched;
      started = deck;
    }
  }
  return started ?? newest;
}

export function chooseHero(opts: {
  decks: readonly Deck[];
  /** True only once the recall engine has something to project from - i.e. signed in and
   * at least one concept answered. The caller reads this from useMemoryOverview rather
   * than re-deriving it, so the hero and MemoryOverview can never disagree about whether
   * a projection exists. */
  hasProjection: boolean;
}): HomeHero {
  if (opts.hasProjection) return { kind: "projection" };

  const deck = leadDeck(opts.decks);
  if (!deck || deck.concepts.length === 0) return { kind: "empty" };

  const answered = deckProgress(deck);
  if (answered > 0) {
    return { kind: "progress", deck, answered, total: deck.concepts.length };
  }
  return { kind: "waiting", deck, total: deck.concepts.length };
}
