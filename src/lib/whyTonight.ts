import type { SessionPlan } from "@/lib/sessionBuilder";

/** Why tonight's session looks the way it does.
 *
 * The answer to "there is no content about the app". It is not a description of FlowRecall
 * and it is deliberately not onboarding - it explains the decision the scheduler just
 * made, using the mechanism that decision is based on. A student reads why these
 * particular cards, and learns the memory research as a side effect of being told what is
 * happening to them.
 *
 * KEYED TO THE PLAN, NOT RANDOM. BRAIN_FACTS rotates freely because any true thing about
 * memory is worth reading; this does not, because a paragraph about spacing above a
 * session made entirely of new cards would be wrong. The shape of the session picks the
 * explanation, so it is always about what is actually on offer.
 *
 * Same rules as brainFacts.ts: every claim checkable, nothing attributed to anybody, and
 * short enough to read in the gap between deciding to study and starting.
 */

export type WhyTonight = { title: string; body: string };

/** Ranked in the same order as `sessionSentence`, so the explanation is always about the
 * thing the statement above it named. */
export function whyTonight(plan: SessionPlan): WhyTonight | null {
  if (plan.items.length === 0) {
    if (plan.resting > 0) {
      return {
        title: "Why it is not asking",
        // The engine's most counter-intuitive behaviour, and the one most likely to read
        // as a bug if it goes unexplained.
        body: "Retrieving something you still know well barely strengthens it. The gain comes from recalling what has started to fade, so a concept you have solidly is left alone until it has.",
      };
    }
    return null;
  }

  if (plan.urgent > 0) {
    return {
      title: "Why these first",
      body: "These have decayed furthest past the point where they were worth reviewing. A memory is not lost when it drops below that line, but every day after makes getting it back more expensive.",
    };
  }

  if (plan.slipping > 0) {
    return {
      title: "Why tonight looks like this",
      body: "These were answered a while ago and recall has had time to fade. That is exactly when retrieving them is worth most: the harder a memory is to pull up, the more the act of pulling it up strengthens it.",
    };
  }

  if (plan.fresh > 0) {
    return {
      title: "Why answer before reading",
      body: "Being asked first and told second builds a stronger memory than reading the answer twice, even when the first attempt fails. The attempt is the part that does the work.",
    };
  }

  return {
    title: "Why it keeps asking",
    body: "One correct answer is not proof. A concept counts as solid here only once you have produced it a second way and after a week away, because both are what separate knowing something from recognising it.",
  };
}
