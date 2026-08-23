import type { ChallengeLevel, Concept, QueueItem, StudyProgress } from "@/lib/types";

export function nextEasierLevel(level: ChallengeLevel): ChallengeLevel | null {
  if (level === 1) return null;
  return (level - 1) as ChallengeLevel;
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
