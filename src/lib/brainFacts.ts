/** One interesting, true thing about the brain, on the shelf a student opens most.
 *
 * These are FACTS ABOUT MEMORY, not study tips, and not one of them is attributed to
 * anybody. That constraint is the whole design: a misattributed quotation is worse
 * than no quotation, and the only way to be sure a name belongs to a sentence is to
 * have the source in front of you rather than in your head. Stated plainly instead,
 * in this app's own voice, where each claim can be checked.
 *
 * The effect behind each line is named in the comments below so a future edit can be
 * verified rather than trusted. Two of them carry numbers, and both were checked
 * against sources rather than recalled:
 *
 *   - The 2% / 20% split and the ~20 W figure: NCBI Basic Neurochemistry ("Regulation
 *     of Cerebral Metabolic Rate") and BrainFacts.org. The brain is ~2% of body mass
 *     and takes ~20% of resting oxygen consumption, an energy equivalent of ~20 W.
 *   - Working memory's capacity: Cowan's four-chunk limit. Estimates in the
 *     literature still range from four to seven depending on how chunking is
 *     controlled, which is why the copy says "about four" and not "four".
 *
 * ADDING A LINE: it has to be a claim someone could check, short enough to sit on two
 * lines of a 360dp phone (~110 characters), and free of any name.
 */
export const BRAIN_FACTS: readonly string[] = [
  // Systems consolidation: hippocampal replay during sleep, handing memories to cortex.
  "Your hippocampus replays the day while you sleep, handing what it learned to the cortex to keep.",
  // Long-term potentiation: memory as synaptic weight, not as a cell's contents.
  "A memory isn't stored in a cell. It's stored in the strength of the connections between them.",
  // Reconsolidation: retrieval returns a memory to a labile state before it re-stabilises.
  "Pulling a memory up makes it briefly editable again before it settles back down.",
  // Cowan's limit - "about four" deliberately, see the docblock above.
  "Working memory juggles about four things at once. Everything else has to be grouped, or written down.",
  // Attention as the gate on encoding.
  "You can't remember what you never attended to. Attention is the gate encoding has to pass.",
  // Cerebral metabolic rate - verified, see the docblock above.
  "Your brain is about 2% of your body weight and spends about 20% of your energy.",
  "All of that thinking runs on roughly 20 watts.",
  // Amygdala modulation of hippocampal consolidation under emotional arousal.
  "Emotion decides what's worth keeping: the amygdala tells the hippocampus what to prioritise.",
  // Novelty-related dopamine release enhancing hippocampal encoding.
  "Novelty releases dopamine, and dopamine makes the minutes around it stick better.",
  // Method of loci: spatial coding recruited for arbitrary material.
  "The memory-palace trick works because your brain files places and facts with the same machinery.",
  // Sleep deprivation impairs encoding, not only alertness.
  "A bad night doesn't just tire you out. It leaves the hippocampus worse at taking anything in.",
  // Reconstructive memory: recall as reassembly, hence drift.
  "Every recall is a reconstruction, not a replay. That's why a memory drifts a little each time.",
  // Spacing effect.
  "Massed practice climbs fastest and falls fastest. Spacing the same hours out is what makes them hold.",
  // Testing effect vs the fluency illusion.
  "Testing yourself changes the memory. Re-reading mostly changes how familiar it feels.",
];

/** The fact at a given position in the cycle.
 *
 * Total, and deliberately so: the cursor comes out of localStorage, where anything can
 * be sitting - a value from a build with more facts in it, or a negative left by a
 * hand-edited store. Both wrap to a real fact rather than to `undefined`, which would
 * render as an empty line under the title. */
export function factAt(cursor: number): string {
  const size = BRAIN_FACTS.length;
  // JS `%` keeps the sign of the dividend, so a negative cursor would index backwards
  // off the front of the array.
  const index = ((Math.trunc(cursor) % size) + size) % size;
  return BRAIN_FACTS[index];
}

/** The position to store for next time.
 *
 * Advancing by one, rather than picking at random, is what stops a student seeing the
 * same fact twice in a row - and means they meet every one of these before meeting any
 * of them twice. Wrapped here rather than left to grow forever so the stored number
 * stays small and readable. */
export function nextCursor(cursor: number): number {
  const size = BRAIN_FACTS.length;
  return (((Math.trunc(cursor) + 1) % size) + size) % size;
}
