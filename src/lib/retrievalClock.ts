/** When each card came into view, so a resolution can be timed.
 *
 * Keyed by the queue item's own `key` rather than its index, and that is the
 * whole point of the module. The study queue mutates mid-session - a failed lane
 * is requeued three slides ahead, Infinite Recall splices new cards in right
 * after the current one - so an index identifies a *different card* before and
 * after any insertion, while `QueueItem.key` identifies the same card for the
 * life of the session.
 *
 * It also has to be read by the resolving card's key, not by whatever happens to
 * be on screen when the answer lands. Cloze grading is an async fetch, so a
 * student who scrolls while a verdict is pending would otherwise have their
 * correct answer credited with another card's latency - and since cloze is a
 * production path, a borrowed short latency grades EASY (see gradeFor) and
 * inflates stability on a card they may have laboured over. */
export type RetrievalClock = Map<string, number>;

export function createRetrievalClock(): RetrievalClock {
  return new Map();
}

/** Records when a card entered the viewport. First entry wins: scrolling back to
 * a card the student already looked at must not restart its clock and turn a
 * long deliberation into a suspiciously fast answer. */
export function markEntered(clock: RetrievalClock, key: string, at: number): void {
  if (!clock.has(key)) clock.set(key, at);
}

/** How long the student spent on this card, or 0 for "not measured".
 *
 * 0 is read downstream as trustworthy rather than suspect, which is the safe
 * direction: it happens when a card resolves without ever having entered the
 * viewport, and treating that as a suspiciously fast answer would withhold
 * credit from an answer nobody was in a position to time. */
export function latencyFor(clock: RetrievalClock, key: string, resolvedAt: number): number {
  const enteredAt = clock.get(key);
  if (enteredAt === undefined) return 0;
  return Math.max(0, resolvedAt - enteredAt);
}
