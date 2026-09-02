"use client";

import { useState } from "react";
import type { Concept } from "@/lib/types";
import { pathsFor, unitIdFor } from "@/lib/recallModel";
import { normaliseBlank } from "@/lib/conceptProse";
import { deleteConcept, getSavedDecks, updateConcept } from "@/lib/storage";
import { forgetUnit, importDeck } from "@/lib/recallStorage";
import { vibrateTap } from "@/lib/haptics";

/** Fix a card the generator got wrong, or throw it away.
 *
 * The trust hole this closes: generation is not perfect - this repo has already
 * caught a cloze whose answer could not fill its own blank - and until now a wrong
 * card was permanent. The engine would keep drilling it, and the only escape was
 * deleting the entire deck. Anki's core competence is that you own your cards; an
 * app that generates them for you and then refuses to let you correct them is
 * asking for more trust than it has earned.
 *
 * Editing keeps the card's id, and therefore its whole history - see
 * `updateConcept`. Deleting drops the unit and its memory rows but keeps the review
 * log - see `forgetUnit`.
 *
 * The live path readout is the point of the form, not decoration. `pathsFor` refuses
 * to schedule a format a card's own fields cannot support, so a card whose cloze lost
 * its blank was silently never scheduled at all. Showing what the card WILL be asked
 * as makes that visible while it can still be fixed - and makes the rescue case
 * ("this card was not being asked; now it will be") legible rather than magic. */

const PLACEHOLDER_BLANK = "_____";

type Draft = Pick<Concept, "concept" | "question" | "answer" | "distractor" | "cloze">;

const FIELDS: { key: keyof Draft; label: string; hint: string; rows: number }[] = [
  { key: "concept", label: "Label", hint: "2-6 words naming the idea", rows: 1 },
  { key: "question", label: "Question", hint: "What you'll be asked", rows: 2 },
  { key: "answer", label: "Answer", hint: "Short - a few words", rows: 1 },
  { key: "distractor", label: "Wrong answer", hint: "Plausible, but false", rows: 1 },
  {
    key: "cloze",
    label: "Fill the blank",
    hint: `The fact as a sentence, with ${PLACEHOLDER_BLANK} where the answer goes`,
    rows: 2,
  },
];

export default function ConceptEditor({
  deckId,
  concept,
  userId,
  onDone,
}: {
  deckId: string;
  concept: Concept;
  /** Absent when signed out, in which case there is no engine state to bring into
   * line and the edit is a plain deck write. */
  userId: string | undefined;
  onDone: () => void;
}) {
  const [draft, setDraft] = useState<Draft>({
    concept: concept.concept,
    question: concept.question,
    answer: concept.answer,
    distractor: concept.distractor,
    cloze: concept.cloze,
  });
  const [busy, setBusy] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // What the engine will be able to ask this card as, recomputed as they type.
  // Built from the draft rather than the saved card so the readout describes what
  // Save would produce.
  const edited: Concept = { ...concept, ...draft, cloze: normaliseBlank(draft.cloze) };
  const paths = pathsFor(edited);
  const before = pathsFor(concept).length;
  const sameClaim =
    edited.answer.trim().toLowerCase() === edited.distractor.trim().toLowerCase();

  async function save() {
    setBusy(true);
    try {
      updateConcept(deckId, edited);
      if (userId) {
        // A card with no schedulable path is not imported at all, and `importDeck`
        // uses put() - it overwrites, it never deletes. So an edit that removes the
        // last path has to drop the unit explicitly, or the engine keeps scheduling
        // the pre-edit text forever.
        if (paths.length === 0) {
          await forgetUnit(userId, unitIdFor(deckId, concept.id));
        } else {
          const deck = getSavedDecks().find((row) => row.id === deckId);
          if (deck) await importDeck(deck, userId);
        }
      }
      onDone();
    } catch (error) {
      console.error("saving a card edit failed", error);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      deleteConcept(deckId, concept.id);
      if (userId) await forgetUnit(userId, unitIdFor(deckId, concept.id));
      onDone();
    } catch (error) {
      console.error("deleting a card failed", error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 space-y-3 rounded-2xl border border-border bg-surface p-4">
      {FIELDS.map(({ key, label, hint, rows }) => (
        <label key={key} className="block">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            {label}
          </span>
          <textarea
            value={draft[key]}
            rows={rows}
            onChange={(event) => setDraft({ ...draft, [key]: event.target.value })}
            className="mt-1 w-full resize-y rounded-xl border border-border bg-background/60 px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-accent/60"
          />
          <span className="mt-0.5 block text-[10px] text-muted-foreground">{hint}</span>
        </label>
      ))}

      {/* --- What this card will be asked as. A card with no path is not broken
          material, it is material the engine cannot probe - so say that, rather
          than blocking the save on it. --- */}
      <p className="text-xs text-muted-foreground">
        {paths.length === 0 ? (
          <span className="text-pending">
            Nothing to ask yet - needs an answer plus either a wrong answer or a
            sentence with {PLACEHOLDER_BLANK} in it. Saved as reading material only.
          </span>
        ) : (
          <>
            Asked as {paths.join(" and ")}
            {before === 0 && (
              <span className="text-accent"> - this card wasn&apos;t being asked before</span>
            )}
          </>
        )}
      </p>

      {sameClaim && (
        <p className="text-xs text-pending">
          The wrong answer says the same thing as the answer, so the true/false card
          would mark a correct answer wrong half the time.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            vibrateTap();
            void save();
          }}
          className="rounded-full bg-accent px-4 py-2 text-xs font-semibold text-accent-foreground transition-transform duration-200 active:scale-[0.98] disabled:opacity-60"
        >
          Save
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            vibrateTap();
            onDone();
          }}
          className="rounded-full border border-border bg-foreground/5 px-4 py-2 text-xs font-medium text-foreground transition-colors duration-200 active:bg-foreground/10 disabled:opacity-60"
        >
          Cancel
        </button>

        {/* Two taps rather than a native confirm(): a WebView dialog is jarring and
            can be suppressed outright, and this is destructive. */}
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            vibrateTap();
            if (confirmingDelete) void remove();
            else setConfirmingDelete(true);
          }}
          className="ml-auto rounded-full border border-danger/40 bg-danger/10 px-4 py-2 text-xs font-medium text-danger transition-colors duration-200 active:bg-danger/20 disabled:opacity-60"
        >
          {confirmingDelete ? "Delete for good?" : "Delete"}
        </button>
      </div>

      {confirmingDelete && (
        <p className="text-[11px] text-muted-foreground">
          The card goes, along with its schedule. What you have already answered stays
          in your history.
        </p>
      )}
    </div>
  );
}
