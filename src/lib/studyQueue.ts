import type { ChallengeLevel, Concept, QueueItem, StudyProgress } from "@/lib/types";
import type { RetrievalPath } from "@/lib/recallModel";

/** The retrieval format a given challenge level actually puts in front of the
 * student, in the recall engine's vocabulary. Level 1 is the two-option
 * true/false swipe (recognition); level 2 is the typed cloze (production).
 *
 * Lives here, beside the queue that assigns levels, because two places need to
 * agree about it and they used not to: FeedSlide renders by `level`, while the
 * feed recorded the review by `lane`. Those diverge every time D.I.E. requeues a
 * failed lane-2 cloze at the easier level 1 - the item keeps `lane: 2` but is
 * shown as a swipe - so a recognition answer was written to the engine as a
 * production retrieval. `masteryFor` requires a production success precisely so
 * that passing recognition formats repeatedly cannot masquerade as knowledge,
 * and that substitution handed it exactly that. One source of truth now, with
 * the recognition/production split asserted in studyQueue.test.ts. */
export const PATH_BY_LEVEL: Record<ChallengeLevel, RetrievalPath> = {
  1: "swipe",
  2: "cloze",
};

export function pathForLevel(level: ChallengeLevel): RetrievalPath {
  return PATH_BY_LEVEL[level];
}

/** The inverse, for the session builder: which level renders this format.
 *
 * Returns null for a path the feed cannot draw yet. `RetrievalPath` declares five
 * formats and FeedSlide implements two, deliberately - the other three were
 * declared early so the store would not need a migration when they arrive. So the
 * builder has to be able to ask "can this actually be shown?" and get an honest
 * no, rather than scheduling a card that would render as a swipe by fallthrough
 * and then be RECORDED as a swipe, quietly turning a production format into a
 * recognition one. That is the same class of bug PATH_BY_LEVEL exists to prevent. */
export function levelForPath(path: RetrievalPath): ChallengeLevel | null {
  const level = (Object.keys(PATH_BY_LEVEL) as unknown as ChallengeLevel[]).find(
    (candidate) => PATH_BY_LEVEL[Number(candidate) as ChallengeLevel] === path,
  );
  return level === undefined ? null : (Number(level) as ChallengeLevel);
}

export function nextEasierLevel(level: ChallengeLevel): ChallengeLevel | null {
  if (level === 1) return null;
  return (level - 1) as ChallengeLevel;
}

/** The card a failed lane comes back as.
 *
 * Lives here rather than inline in the feed because everything the engine needs to
 * attribute the retry has to be CARRIED, not re-derived, and each field has a bug
 * behind it. `lane` survives a level drop because a cloze that comes back as the
 * easier swipe is still evidence about the cloze lane. `unitId` survives because an
 * engine-built session's feed has no real deckId to fall back on - a retry that
 * dropped it recorded its review against a unit id that does not exist, which the
 * store accepts silently. */
export function retryItemFor(item: QueueItem, retryLevel: ChallengeLevel): QueueItem {
  const attempt = item.attempt + 1;
  return {
    key: `${item.concept.id}::${retryLevel}::${attempt}`,
    concept: item.concept,
    level: retryLevel,
    lane: item.lane,
    attempt,
    unitId: item.unitId,
  };
}

/** Builds the two genuinely different questions the queue needs per concept -
 * a Level 1 swipe (recognize the claim as true/false) and a Level 2 fill-in-
 * the-blank (produce the answer from memory), never the same fact tested
 * twice on one card. `lane` records which of the two a given item (or its
 * retry descendants) belongs to - see the QueueItem/StudyProgress comments
 * in lib/types.ts.
 *
 * Provably never places a concept's two questions adjacent (for 2+ concepts)
 * by construction, not by chance: built as two independent passes ("rounds")
 * over the concept list, each contributing every concept exactly once, so
 * neither round can contain an internal duplicate - a round is a permutation
 * of distinct concepts. The only possible clash is the single seam between
 * round 1's last item and round 2's first, fixed with one swap. (An earlier
 * version tried a flat shuffle-then-patch instead; testing caught it failing
 * on a real 3-concept case - a forward-only repair search missed valid fixes
 * that required swapping backward. This construction has no such gap.)
 * Only genuinely unfixable for a 1-concept deck, where adjacency is
 * unavoidable - not a bug, there's nothing else to put between them. */
export function buildConceptQueueItems(concepts: Concept[], extra?: { isNew?: boolean }): QueueItem[] {
  const order1 = [...concepts].sort(() => Math.random() - 0.5);
  const order2 = [...concepts].sort(() => Math.random() - 0.5);

  if (order2.length > 1 && order1[order1.length - 1]?.id === order2[0].id) {
    // Safe: round 2 is a permutation of distinct concepts, so swapping two of
    // its own entries can't create a new internal clash - there isn't one to
    // create when every element in it is already unique.
    [order2[0], order2[1]] = [order2[1], order2[0]];
  }

  function makeItem(concept: Concept, lane: 1 | 2): QueueItem {
    return {
      key: `${concept.id}::${lane}::1`,
      concept,
      level: lane,
      lane,
      attempt: 1,
      ...(extra?.isNew ? { isNew: true } : {}),
    };
  }

  const round1 = order1.map((concept) => makeItem(concept, Math.random() < 0.5 ? 1 : 2));
  const firstLaneByConceptId = new Map(round1.map((item) => [item.concept.id, item.lane]));
  const round2 = order2.map((concept) =>
    makeItem(concept, firstLaneByConceptId.get(concept.id) === 1 ? 2 : 1),
  );

  return [...round1, ...round2];
}

export function buildInitialQueue(concepts: Concept[]): QueueItem[] {
  return buildConceptQueueItems(concepts);
}

/** Legacy fallback for pre-dual-lane saved progress that lacks StudyProgress's
 * resolvedKeys field - reconstructs which queue items are already resolved
 * from queue/masteredIds alone. See lib/types.ts's resolvedKeys comment for
 * why this heuristic can't be used once a concept has two independent lanes. */
export function reconstructResolvedKeys(progress: StudyProgress): Set<string> {
  const maxAttemptByLane = new Map<string, number>();
  for (const item of progress.queue) {
    const laneKey = `${item.concept.id}::${item.lane}`;
    const current = maxAttemptByLane.get(laneKey) ?? 0;
    if (item.attempt > current) maxAttemptByLane.set(laneKey, item.attempt);
  }

  const resolved = new Set<string>();
  for (const item of progress.queue) {
    const laneKey = `${item.concept.id}::${item.lane}`;
    const isSuperseded = item.attempt < (maxAttemptByLane.get(laneKey) ?? item.attempt);
    // Safe to check plain concept-id mastery here specifically because this
    // function only ever runs on pre-dual-lane legacy data (see call site) -
    // that data never had two lanes per concept, so "mastered" and "this
    // lane resolved" were always the same fact.
    const isMastered = progress.masteredIds.includes(item.concept.id);
    if (isSuperseded || isMastered) resolved.add(item.key);
  }
  return resolved;
}
