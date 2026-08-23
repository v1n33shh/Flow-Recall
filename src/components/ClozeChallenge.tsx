"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import type { Concept } from "@/lib/types";
import { vibrateCorrect, vibrateIncorrect } from "@/lib/haptics";
import { API_FETCH_CREDENTIALS, apiUrl } from "@/lib/apiUrl";
import { normalizeForCompare } from "@/lib/clozeMatch";

type ClozeChallengeProps = {
  concept: Concept;
  onAnswered: (correct: boolean) => void;
};

/** Level 2 - a genuinely different question from Level 1's swipe, not the
 * same fact bolted onto the back of it. Swipe only asks the student to
 * recognize a claim as true or false; this asks them to produce the answer
 * from memory before anything on screen confirms it, using the `cloze`
 * field the AI already generates but Level 1 never used. */
export default function ClozeChallenge({ concept, onAnswered }: ClozeChallengeProps) {
  const [attempt, setAttempt] = useState("");
  const [submitted, setSubmitted] = useState(false);
  // null = the AI check hasn't come back yet; boolean = its verdict;
  // "failed" = the request itself errored (offline, etc). Fired the instant
  // a non-exact answer is submitted, in parallel with the student choosing
  // below - never gated behind their tap, so there's no artificial wait
  // before they can act, and by the time most people read the correct
  // answer and pick, this has usually already resolved in the background.
  const [aiVerdict, setAiVerdict] = useState<boolean | "failed" | null>(null);
  // The student's own tap - kept separate from aiVerdict so the two can be
  // compared: the AI is authoritative whenever it responds, overriding a
  // careless or dishonest tap, and this is only the final answer if the AI
  // check itself failed (no authoritative source left).
  const [userPick, setUserPick] = useState<boolean | null>(null);
  const [showExplanation, setShowExplanation] = useState(false);
  const announcedRef = useRef(false);

  // "_____" is required by the schema, but AI output isn't guaranteed to
  // comply - a malformed cloze degrades to a plain typed-recall prompt
  // against the full question instead of rendering a broken sentence.
  const clozeParts = concept.cloze.split("_____");
  const hasBlank = clozeParts.length === 2;
  const [before, after] = hasBlank ? clozeParts : ["", ""];

  const autoMatch = normalizeForCompare(attempt) === normalizeForCompare(concept.answer);
  const tapped = userPick !== null;
  const awaitingVerdict = submitted && !autoMatch && tapped && aiVerdict === null;
  const resolved = autoMatch || (tapped && aiVerdict !== null);
  const correct = autoMatch || aiVerdict === true || (aiVerdict === "failed" && userPick === true);

  // Fires onAnswered/haptics exactly once, the moment BOTH the student has
  // picked AND the AI (or its failure) has weighed in - whichever finishes
  // last. The autoMatch case announces synchronously in handleSubmit instead
  // since there's nothing to wait for there.
  useEffect(() => {
    if (autoMatch || !resolved || announcedRef.current) return;
    announcedRef.current = true;
    if (correct) vibrateCorrect();
    else vibrateIncorrect();
    onAnswered(correct);
  }, [autoMatch, resolved, correct, onAnswered]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitted || !attempt.trim()) return;
    setSubmitted(true);

    if (autoMatch) {
      vibrateCorrect();
      onAnswered(true);
      return;
    }

    // Not an exact normalized match - that only rules out a formatting
    // difference, not a wording difference, so ask the AI whether the typed
    // answer still names the same fact. This runs immediately, not after the
    // student taps a choice below - see the aiVerdict comment above.
    try {
      const res = await fetch(apiUrl("/api/cloze-grade"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: API_FETCH_CREDENTIALS,
        body: JSON.stringify({
          cloze: hasBlank ? concept.cloze : concept.question,
          correctAnswer: concept.answer,
          userAnswer: attempt,
          timezoneOffsetMinutes: new Date().getTimezoneOffset(),
        }),
      });
      if (!res.ok) throw new Error(`grade request failed: ${res.status}`);
      const data: unknown = await res.json();
      if (!data || typeof (data as { correct?: unknown }).correct !== "boolean") {
        throw new Error("malformed grade response");
      }
      setAiVerdict((data as { correct: boolean }).correct);
    } catch (error) {
      console.error("Cloze AI grading failed, falling back to self-report", error);
      setAiVerdict("failed");
    }
  }

  function handleChoice(pick: boolean) {
    if (tapped) return;
    setUserPick(pick);
  }

  return (
    <div className="w-full">
      <p className="mb-4 text-center text-sm text-muted-foreground">
        {hasBlank ? "Fill in the blank" : concept.question}
      </p>

      <div className="relative flex h-56 w-full flex-col items-center justify-center rounded-3xl border border-border bg-surface p-6 text-center">
        {!submitted ? (
          <form onSubmit={handleSubmit} className="flex w-full flex-col items-center gap-4">
            <p className="text-lg leading-relaxed text-foreground">
              {hasBlank ? before : concept.question}
              <input
                type="text"
                value={attempt}
                onChange={(e) => setAttempt(e.target.value)}
                placeholder="?"
                autoComplete="off"
                autoCapitalize="off"
                autoCorrect="off"
                // No autoFocus: this slide enters the viewport via scroll-
                // snap, and focusing an input the instant it appears would
                // pop the mobile keyboard mid-gesture and fight the snap
                // scroll. Let the student tap in when they're ready.
                className={hasBlank ? "mx-1 w-32 rounded border-b-2 border-accent bg-transparent px-1 text-center text-lg font-semibold text-accent placeholder:text-muted-foreground/50 focus:outline-none" : "w-full rounded-xl border border-border bg-foreground/5 px-3 py-2 text-center text-base font-medium text-foreground focus:outline-none"}
              />
              {hasBlank ? after : null}
            </p>
            <button
              type="submit"
              disabled={!attempt.trim()}
              className="rounded-full bg-accent px-6 py-2.5 text-sm font-semibold text-accent-foreground ring-1 ring-inset ring-accent/30 transition-transform active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Check
            </button>
          </form>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <p className="text-lg leading-relaxed text-foreground">
              {hasBlank ? before : null}
              <span
                className={`font-semibold ${
                  resolved
                    ? correct
                      ? "text-success"
                      : "text-danger line-through"
                    : tapped
                      ? "text-pending"
                      : "text-foreground"
                }`}
              >
                {attempt.trim()}
              </span>
              {hasBlank ? after : null}
            </p>
            {!autoMatch && !resolved && (
              <p>
                <span className="text-[10px] font-semibold uppercase tracking-widest text-pending">
                  Correct answer
                </span>
                <br />
                <span className="font-semibold text-pending">{concept.answer}</span>
              </p>
            )}
          </div>
        )}
      </div>

      {submitted && !autoMatch && !tapped && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-6 rounded-2xl border border-pending/30 bg-pending/10 px-4 py-4 text-center"
        >
          <p className="text-xs font-medium uppercase tracking-widest text-pending">
            Not an exact match - did you get it right?
          </p>
          <div className="mt-4 flex justify-center gap-3">
            <button
              type="button"
              onClick={() => handleChoice(false)}
              className="rounded-full border border-border px-4 py-2 text-sm font-medium text-foreground transition-transform hover:scale-105 active:scale-95"
            >
              Incorrect
            </button>
            <button
              type="button"
              onClick={() => handleChoice(true)}
              className="rounded-full bg-accent px-4 py-2 text-sm font-medium text-accent-foreground ring-1 ring-inset ring-accent/30 shadow-[inset_0_1px_0_rgba(255,255,255,0.15),0_8px_24px_-6px_rgba(0,0,0,0.4)] transition-transform hover:scale-105 active:scale-95"
            >
              Correct
            </button>
          </div>
        </motion.div>
      )}

      {awaitingVerdict && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-6 rounded-2xl border border-pending/30 bg-pending/10 px-4 py-3 text-center"
        >
          <p className="flex items-center justify-center gap-2 text-xs font-medium uppercase tracking-widest text-pending">
            <motion.span
              className="h-1.5 w-1.5 rounded-full bg-pending"
              animate={{ opacity: [1, 0.3, 1] }}
              transition={{ duration: 1, repeat: Infinity }}
            />
            Confirming your answer
          </p>
        </motion.div>
      )}

      {resolved && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className={`mt-6 rounded-2xl border px-4 py-3 text-center text-sm ${
            correct ? "border-success/30 bg-success/10" : "border-danger/30 bg-danger/10"
          }`}
        >
          <p className={`font-medium ${correct ? "text-success" : "text-danger"}`}>
            {correct ? "Correct!" : "Not quite"}
          </p>
          <p className="mt-1 text-foreground">
            {concept.question} &rarr; {concept.answer}
          </p>
          {aiVerdict === "failed" && (
            <p className="mt-2 text-xs text-muted-foreground">Auto-check unavailable - your own grading was used.</p>
          )}
        </motion.div>
      )}

      {resolved && concept.explanation && !showExplanation && (
        <div className="mt-4 text-center">
          <button
            type="button"
            onClick={() => setShowExplanation(true)}
            className="text-xs font-medium text-accent hover:underline"
          >
            Read Deep Dive ↓
          </button>
        </div>
      )}
      {resolved && concept.explanation && showExplanation && (
        <div className="mt-4 rounded-r-xl border-l-4 border-l-accent bg-foreground/5 p-4 text-sm text-left leading-relaxed text-muted-foreground">
          {concept.explanation}
        </div>
      )}
    </div>
  );
}
