import type { Concept, ConceptEdge, Deck } from "@/lib/types";

/** The deck every install starts with: how memory works.
 *
 * WHY THIS EXISTS. A new student used to open the app to four empty screens and one
 * closed door. Ingest is the primary call to action, `PdfDropzone` happily extracts
 * their PDF with no account, and only then does `handleGenerate` stop them - /api/ingest
 * is a hard 401, deliberately, because generation costs money. So the app's very first
 * interaction was a wall, with an empty Library, an empty Mindmap and an empty feed
 * behind it. Nothing to try, and no reason to believe the thing was worth signing up for.
 *
 * This is the answer that needs no policy change: a real deck, already generated, already
 * mapped, that works signed out. It fills the Library, gives the Mindmap something to
 * draw, and lets a student run the entire loop - swipe, type, read, map - before deciding
 * whether to make an account.
 *
 * WHY THIS SUBJECT. Because it is the one topic that is simultaneously a demo and the
 * argument. Every concept here is a reason the scheduler behind the app works the way it
 * does: `testing-effect` is why the feed asks before it tells, `spacing-effect` is why
 * FSRS widens the gap, `forgetting-curve` is the line drawn on the landing page. A
 * student who studies this deck learns why they should study.
 *
 * TWO DELIBERATE OMISSIONS.
 *
 * `sourceQuote` is absent from every concept. That field means "the sentence from the
 * uploaded material this card came from", and there is no uploaded material here. Filling
 * it would be inventing provenance - the same lie BRAIN_FACTS refuses when it declines to
 * put a name on a sentence nobody can check. Both consumers already guard on it
 * (RevisionSheet, MapNodeSheet), so absent renders as nothing.
 *
 * `pendingChunks` is absent too: there is no remaining source text, so the Library must
 * not offer to "generate the rest".
 *
 * HOW IT STAYS OUT OF THE ACCOUNT. The deck is owned by STARTER_USER_ID, a reserved
 * string no real account can hold. `syncNow` pushes only decks where
 * `userId === undefined || userId === <the signed-in user>` (recallStorage.ts), so this
 * one is never uploaded and never lands on the student's other devices - it is a local
 * demo artifact, not their work. Nothing in sync had to change to make that true.
 * `getSavedDecks` filters tombstones only, so it still shows everywhere it should.
 */

/** Reserved owner. Not a user id, and deliberately unable to collide with one. */
export const STARTER_USER_ID = "__starter__";

export const STARTER_DECK_ID = "starter-how-memory-works";

/** Set once the starter has been seeded, so a student who deletes it is obeyed rather
 * than handed it back on next launch. */
export const STARTER_SEEDED_KEY = "flowrecall:starterSeeded";

export const STARTER_DECK_TITLE = "How Memory Works";

/** Twelve concepts. Each `misconception` names the belief its own `distractor` encodes,
 * so a failed card can say why the wrong answer was tempting.
 *
 * Claims worth checking, since this deck is shipped rather than generated:
 *   - Working memory's capacity is given as "about four", following Cowan. Estimates
 *     range from four to seven depending on how chunking is controlled, which is why the
 *     copy hedges rather than stating a number as settled.
 *   - "Stability" is used here in the sense fsrs.ts defines it: the interval at which
 *     recall probability has decayed to 90%.
 *   - The forgetting curve is described as steep-then-flattening, which is both the
 *     classic finding and what src/lib/fsrs.ts's power curve actually computes.
 */
export const STARTER_CONCEPTS: readonly Concept[] = [
  {
    id: "attention",
    concept: "Attention",
    question: "What has to happen before anything can be remembered?",
    answer: "it has to be attended to first",
    distractor: "it has to be repeated several times first",
    cloze: "Nothing reaches memory without passing through _____ first.",
    explanation:
      "Attention is the gate that encoding has to pass. Information you never attended to was never encoded, so there is no trace to find later - the failure happened at the door, not in storage. This is why reading a page while thinking about something else leaves nothing behind, however long your eyes were on it. Divided attention during learning reliably weakens what gets stored, even when the time spent is identical.",
    misconception:
      "Repetition feels like the thing that makes memories, so students assume more passes will fix a blank. But a repeated pass that is equally unattended encodes just as little - repetition without attention is not weak learning, it is no learning.",
    whyItMatters:
      "It tells you that studying with divided attention is not slower learning. It is often no learning at all.",
  },
  {
    id: "encoding",
    concept: "Encoding",
    question: "What does encoding actually mean?",
    answer: "turning an experience into a durable trace the brain can store",
    distractor: "moving a memory from short-term storage into long-term storage",
    cloze: "_____ is the process that turns an experience into a trace the brain can keep.",
    explanation:
      "Encoding is the conversion of an experience into a physical change the brain can hold on to. The change lives in the strength of connections between neurons rather than inside any single cell, which is why a memory has no one address. How deeply you process something at this moment determines how findable it is later: material you related to what you already know is encoded better than material you only looked at. Encoding is a separate step from storage and from retrieval, and each can fail on its own.",
    misconception:
      "Encoding gets confused with the transfer from short-term to long-term memory, which is consolidation. Encoding is the making of the trace; consolidation is what stabilises it afterwards.",
    whyItMatters:
      "It separates three different ways to fail, so you can tell 'I never learned it' from 'I cannot find it right now'.",
  },
  {
    id: "working-memory",
    concept: "Working memory",
    question: "Roughly how many separate items can working memory hold at once?",
    answer: "about four",
    distractor: "about twelve",
    cloze: "Working memory holds roughly _____ separate items at one time.",
    explanation:
      "Working memory is the small, temporary workspace you think in, and it is far smaller than it feels - somewhere around four independent items when grouping is controlled for. Anything beyond that has to be grouped, offloaded to paper, or lost. The limit is on items held simultaneously, not on how much you know, and it does not improve much with practice. It is the bottleneck every study method is really working around.",
    misconception:
      "The famous figure is seven, and it is still widely quoted. Later work showed that seven was inflated by chunking the participants were doing unnoticed; with chunking controlled, the number lands near four.",
    whyItMatters:
      "It explains why a dense page defeats you while the same content in grouped pieces does not.",
  },
  {
    id: "chunking",
    concept: "Chunking",
    question: "How does chunking get around the working memory limit?",
    answer: "it turns several items into one item by giving them a single meaning",
    distractor: "it increases the number of slots working memory has available",
    cloze: "Chunking beats the capacity limit by turning several items into _____.",
    explanation:
      "Chunking does not expand the workspace, it changes what counts as one thing inside it. A string of unrelated digits occupies many slots; the same digits recognised as a date occupy one. Because a chunk is built out of what you already know, expertise shows up as bigger chunks rather than a bigger memory - a chess player sees one position where a beginner sees twenty pieces. This is why the same capacity limit constrains a novice far more than an expert.",
    misconception:
      "Chunking sounds like it adds capacity. It does not: the number of slots is fixed, and chunking only changes how much meaning each slot can carry.",
    whyItMatters:
      "It means the fix for an overwhelming topic is to find its structure, not to try harder to hold the pieces.",
  },
  {
    id: "consolidation",
    concept: "Consolidation",
    question: "What happens to a new memory during consolidation?",
    answer: "it is gradually stabilised and handed from the hippocampus to the cortex",
    distractor: "it is rehearsed silently until it becomes permanent",
    cloze: "During _____ a new memory is stabilised and handed from the hippocampus to the cortex.",
    explanation:
      "A freshly encoded memory is fragile, and consolidation is the slow process that stabilises it. During sleep the hippocampus replays the day's patterns, and those replays gradually transfer the memory into cortical networks where it can last. This is why a night of poor sleep damages learning twice over: it weakens what was consolidated, and it leaves the hippocampus worse at encoding the next day. The process takes hours to years and continues long after the studying stops.",
    misconception:
      "Consolidation is imagined as deliberate rehearsal, something you do. Most of it is automatic and happens while you are asleep and not doing anything at all.",
    whyItMatters:
      "It makes sleep part of the study method rather than the thing you sacrifice to it.",
  },
  {
    id: "retrieval",
    concept: "Retrieval",
    question: "What is happening when you recall something?",
    answer: "the memory is being reconstructed from partial traces and cues",
    distractor: "a stored recording is being played back unchanged",
    cloze: "Recall is a _____ of the memory, not a replay of a stored recording.",
    explanation:
      "Retrieval rebuilds a memory from fragments and whatever cues are present rather than replaying a file. Because it is a reconstruction, it can be assembled slightly differently each time, and gaps get filled with what is plausible instead of what happened. That is why memories drift with repeated telling and why confident recall is not the same as accurate recall. It also means retrieval is an act that changes the memory rather than a read-only lookup.",
    misconception:
      "Memory feels like playback, so an error feels like a corrupted recording. Nothing is played back - what is returned was assembled just now, which is why it can be wrong while feeling vivid.",
    whyItMatters:
      "It is why testing yourself does something to the memory that re-reading cannot.",
  },
  {
    id: "testing-effect",
    concept: "The testing effect",
    question: "Why does testing yourself beat re-reading?",
    answer: "retrieving an answer strengthens the memory, while re-reading mostly raises familiarity",
    distractor: "testing exposes gaps, which you then close by re-reading them",
    cloze: "Testing yourself beats re-reading because retrieval _____ the memory.",
    explanation:
      "Attempting to retrieve an answer changes the memory itself, making it easier to retrieve next time - the act of testing is the learning, not a measurement of it. Re-reading raises how familiar the material feels without doing the same work, which is why it feels more productive and delivers less. The gap between the two grows the longer you wait before the real test. A retrieval attempt helps even when it fails, provided the answer follows.",
    misconception:
      "Testing is treated as diagnosis: find the gaps, then learn them by re-reading. The finding is stronger than that - the retrieval attempt is itself the thing that strengthens the memory, regardless of what you do afterwards.",
    whyItMatters:
      "It is the reason this app makes you commit to an answer before it shows you one.",
  },
  {
    id: "forgetting-curve",
    concept: "The forgetting curve",
    question: "What shape does forgetting follow after you learn something once?",
    answer: "a steep early drop that flattens out over time",
    distractor: "a steady decline at the same rate every day",
    cloze: "Forgetting is fastest _____ and slows down as time goes on.",
    explanation:
      "Recall falls sharply in the hours and days right after learning, then the decline slows and the curve flattens into a long tail. The practical consequence is that the first review is worth far more than a later one, because it catches the memory before the steep part has done its damage. The flat tail is also why an item you have known for months barely benefits from being reviewed again today. A scheduler that understands this spends your time where the curve is steep.",
    misconception:
      "Forgetting is pictured as a constant daily leak, which makes every day of delay look equally costly. The early days cost far more than the later ones.",
    whyItMatters:
      "It tells you when a review is worth doing, which matters more than how many you do.",
  },
  {
    id: "spacing-effect",
    concept: "The spacing effect",
    question: "Why does spacing study sessions out beat cramming them together?",
    answer: "a retrieval made when recall has partly faded is worth more than an easy one",
    distractor: "spacing gives the brain time to finish filing each session before the next",
    cloze: "Spaced practice wins because a harder retrieval is worth _____ than an easy one.",
    explanation:
      "The same total hours produce a far more durable memory when spread out than when massed together. The reason is that a retrieval attempted while the memory has partly faded does more work than one attempted while it is still fresh - difficulty at the moment of recall is what buys durability. Cramming climbs fastest and falls fastest, because every retrieval in it is easy. This is why review intervals should widen rather than repeat.",
    misconception:
      "Spacing is explained as giving the brain time to file things. The gap is not rest, it is difficulty: the benefit comes from recall having decayed before you attempt it again.",
    whyItMatters:
      "It is why the gap between your reviews keeps growing instead of staying fixed.",
  },
  {
    id: "reconsolidation",
    concept: "Reconsolidation",
    question: "What happens to a memory immediately after it is recalled?",
    answer: "it becomes briefly unstable again before it re-stabilises",
    distractor: "it is locked in more firmly the moment it is recalled",
    cloze: "Recalling a memory makes it briefly _____ again before it settles back down.",
    explanation:
      "Bringing a memory to mind returns it to a temporarily editable state, and it has to be stabilised all over again before it settles. In that window the memory can be updated - strengthened, corrected, or distorted by what is around at the time. This is the mechanism behind memories drifting with retelling, and it is also the opening that makes correcting a wrong belief possible rather than merely adding a competing one. Recall is therefore an act of rewriting as much as of reading.",
    misconception:
      "Recall is assumed to simply reinforce, so a memory can only ever get stronger by being used. The window it opens is genuinely editable, which is why a confident error repeated can entrench rather than correct.",
    whyItMatters:
      "It means the moment right after you answer is when a correction actually lands.",
  },
  {
    id: "interference",
    concept: "Interference",
    question: "What does interference say about why we forget?",
    answer: "similar memories compete with each other at retrieval",
    distractor: "unused memories decay and are eventually erased",
    cloze: "Interference explains forgetting as similar memories _____ with each other.",
    explanation:
      "A great deal of forgetting is not loss but competition: similar memories get in each other's way when you reach for one. Material learned before can obstruct newer material, and newer material can obstruct the old. The more alike two items are, the more they interfere, which is why confusable pairs are so much harder than unrelated facts. The fix is to make the items more distinguishable rather than to repeat them more.",
    misconception:
      "Forgetting is assumed to be decay - the memory faded and is gone. Much of it is a retrieval failure caused by a competitor, which is why the 'lost' item often returns given a better cue.",
    whyItMatters:
      "It is why the pairs you keep mixing up need separating, not more repetitions.",
  },
  {
    id: "context",
    concept: "Context-dependent memory",
    question: "Why does recall improve when the setting matches where you learned?",
    answer: "the context was encoded alongside the material and acts as a cue",
    distractor: "a familiar setting lowers anxiety, which frees up working memory",
    cloze: "Recall improves in a matching setting because the context itself was stored as a _____.",
    explanation:
      "What you encode is not only the material but the circumstances around it, and those circumstances become retrieval cues. Recall is measurably better when the state at retrieval resembles the state at encoding, whether that is a place, a mood, or the format of the question. The practical implication runs the other way too: varying where and how you practise builds a memory that fewer cues can unlock but more situations can reach. Studying in exactly one way ties the memory to exactly that way.",
    misconception:
      "The effect is put down to comfort or lower anxiety in a familiar room. The mechanism is cue overlap - the context was stored with the memory and is doing retrieval work.",
    whyItMatters:
      "It argues for practising in more than one format, which is why a concept here is asked in more than one way.",
  },
];

/** How these twelve hold each other up.
 *
 * Stored by id rather than by label, which is what `ConceptEdge` requires and what
 * `validateEdges` exists to produce from a model's label-keyed output. Shipped rather
 * than generated so the Mindmap has something to draw on a first launch - mapping is
 * otherwise a separate, signed-in, AI-backed pass over a finished deck.
 *
 * Directions, per ConceptRelation: `prerequisite` means `from` has to be understood
 * before `to`; `explains` means `from` is the mechanism and `to` the consequence;
 * `contrast` is symmetric and names a pair that actually gets mixed up.
 */
export const STARTER_CONCEPT_MAP: readonly ConceptEdge[] = [
  // The route in: attention gates encoding, encoding is what consolidation stabilises.
  { from: "attention", to: "encoding", relation: "prerequisite" },
  { from: "attention", to: "working-memory", relation: "prerequisite" },
  { from: "encoding", to: "consolidation", relation: "prerequisite" },
  { from: "encoding", to: "retrieval", relation: "prerequisite" },
  { from: "working-memory", to: "chunking", relation: "prerequisite" },
  { from: "consolidation", to: "forgetting-curve", relation: "prerequisite" },
  { from: "forgetting-curve", to: "spacing-effect", relation: "prerequisite" },
  { from: "retrieval", to: "reconsolidation", relation: "prerequisite" },

  // Mechanisms and what follows from them.
  { from: "retrieval", to: "testing-effect", relation: "explains" },
  { from: "encoding", to: "context", relation: "explains" },
  { from: "working-memory", to: "interference", relation: "explains" },

  // The pairs students actually confuse.
  { from: "encoding", to: "consolidation", relation: "contrast" },
  { from: "consolidation", to: "reconsolidation", relation: "contrast" },
  { from: "testing-effect", to: "spacing-effect", relation: "contrast" },
  { from: "interference", to: "forgetting-curve", relation: "contrast" },
];

/** A fresh copy of the starter deck.
 *
 * Built on each call rather than exported as a frozen object: it is written into
 * localStorage, where it will be mutated by ordinary use (renaming, an exam date), and a
 * shared module-level object would leak those edits back into the constant.
 *
 * `createdAt` is the caller's clock rather than a fixed date, so the deck does not sort as
 * years old in a library that orders by recency.
 */
export function buildStarterDeck(now: number = Date.now()): Deck {
  return {
    id: STARTER_DECK_ID,
    title: STARTER_DECK_TITLE,
    createdAt: now,
    updatedAt: now,
    userId: STARTER_USER_ID,
    concepts: STARTER_CONCEPTS.map((concept) => ({ ...concept })),
    conceptMap: STARTER_CONCEPT_MAP.map((edge) => ({ ...edge })),
  };
}

/** Whether a deck is the shipped starter - used to label it, and to decide whether the
 * student has yet made anything of their own. */
export function isStarterDeck(deck: { userId?: string }): boolean {
  return deck.userId === STARTER_USER_ID;
}
