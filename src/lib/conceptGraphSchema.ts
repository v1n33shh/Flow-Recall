import { z } from "zod";

/** What the model returns when asked how one deck's concepts relate.
 *
 * `relation` is a loose string here, not a zod enum, and that is deliberate: the
 * enum would fail the WHOLE response over one invented `related_to`, and a partial
 * map beats no map. `validateEdges` (conceptGraph.ts) drops the ones that are not
 * one of the three - along with every edge naming a concept outside the deck, which
 * is the failure this prompt actually has to fight. */
export const ConceptMapResponseSchema = z.object({
  edges: z
    .array(
      z.object({
        from: z.string().trim().min(1).max(200),
        to: z.string().trim().min(1).max(200),
        relation: z.string().trim().min(1).max(40),
      }),
    )
    .max(400),
});

export type ConceptMapResponse = z.infer<typeof ConceptMapResponseSchema>;

/** Concepts detailed per request. The whole point is that the model sees a batch at
 * once; past this the edge list starts competing with the reasoning budget for
 * output tokens. A bigger deck is several passes, and every pass still carries every
 * label - so a relationship that crosses a batch boundary is never unsayable. */
export const MAP_BATCH_SIZE = 40;

export const conceptMapRequestSchema = z.object({
  /** The concepts this pass should relate, each with the fact it teaches. One is
   * allowed: `allLabels` means even a single detailed concept can be related to the
   * rest of the deck, which is what a 41-concept deck's last pass needs. */
  batch: z
    .array(
      z.object({
        label: z.string().trim().min(1).max(200),
        fact: z.string().trim().max(400),
      }),
    )
    .min(1)
    .max(MAP_BATCH_SIZE),
  /** Every label in the deck, batch or not, so a relationship that crosses a batch
   * boundary is still expressible. Cheap - labels are 2-6 words. */
  allLabels: z.array(z.string().trim().min(1).max(200)).min(2).max(400),
  /** False on continuation batches. One mapping should cost one AI lookup however
   * many passes it takes, exactly as /api/ingest charges per deck and not per
   * chunk. */
  first: z.boolean().default(true),
});

export type ConceptMapRequest = z.infer<typeof conceptMapRequestSchema>;

/** Lives beside the schema rather than in the route so it can be run against the
 * real model without dragging next-auth and a session cookie in - whether the
 * pinned Groq model gets the DIRECTION right, in a shape parseModelJson accepts,
 * is the one thing typechecking cannot tell you. */
export function buildConceptMapPrompt(input: ConceptMapRequest): string {
  return [
    "You are a professor laying out how the ideas in one lecture actually connect.",
    "A student has a deck of flashcards. Each card teaches one fact. Answering all of",
    "them still leaves them unable to say how any two relate. That is what you fix.",
    "",
    "THE CONCEPTS TO RELATE (label, then the fact the card teaches):",
    ...input.batch.map((c) => `- ${c.label}${c.fact ? ` — ${c.fact}` : ""}`),
    "",
    "EVERY LABEL IN THE DECK (you may point at any of these, even ones not detailed above):",
    input.allLabels.map((l) => `"${l}"`).join(", "),
    "",
    "THREE RELATIONS, AND THE DIRECTION OF EACH IS THE PART THAT MATTERS:",
    "",
    '1. "prerequisite" — `from` must be understood BEFORE `to`.',
    '   RIGHT  {"from":"Preload","to":"Frank-Starling Mechanism","relation":"prerequisite"}',
    "          (you cannot understand the mechanism without knowing what preload is)",
    '   WRONG  {"from":"Frank-Starling Mechanism","to":"Preload","relation":"prerequisite"}',
    "          (backwards - this teaches the deck in reverse)",
    "",
    '2. "explains" — `from` is the MECHANISM, `to` is what FOLLOWS from it.',
    '   RIGHT  {"from":"Frank-Starling Mechanism","to":"Stroke Volume","relation":"explains"}',
    "          (the mechanism is why stroke volume changes)",
    "   Not a synonym for prerequisite: use this for cause and consequence, and",
    "   prerequisite for teaching order. A pair can honestly have both.",
    "",
    '3. "contrast" — the two are COMMONLY CONFUSED with each other. Symmetric, so',
    "   assert it once, in either direction.",
    '   RIGHT  {"from":"Stroke Volume","to":"Cardiac Output","relation":"contrast"}',
    "          (both are volumes per beat-ish, and students swap them)",
    "   Only for a confusion a real student would have. Two merely different",
    "   concepts are not a contrast.",
    "",
    "HARD RULES:",
    "- Use labels EXACTLY as written above. Do not rephrase, shorten, translate or",
    "  re-capitalise them, and never invent a concept that is not in the list. An",
    "  edge naming something outside the deck is discarded, so it is wasted output.",
    "- Do NOT relate everything to everything. A relationship a teacher would not",
    "  actually draw on a whiteboard is noise, and noise makes the real ones",
    "  worthless. Most concepts have one or two genuine links; some have none.",
    "- Never point a concept at itself.",
    "- Prefer FEWER, CORRECT edges. There is no credit for volume here.",
    "- If the material genuinely supports no relationship at all, return an empty",
    "  array. That is a valid, useful answer.",
    "",
    "Respond with ONLY raw JSON - no markdown, no code blocks:",
    '{"edges":[{"from":"exact label","to":"exact label","relation":"prerequisite"}]}',
  ].join("\n");
}
