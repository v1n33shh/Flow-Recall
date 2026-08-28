"use client";

import { useLayoutEffect, useRef, useState, useEffect } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import type { DefinitionResponse } from "@/lib/definitionSchema";
import type { SelectionAnchor } from "./selection";
import { useIsTouchDevice } from "./useIsTouchDevice";
import { apiUrl, API_FETCH_CREDENTIALS } from "@/lib/apiUrl";

// PERFORMANCE CONTRACT (matches StreakModal/StudyFeed): entrance/exit only
// ever animates transform + opacity. backdrop-blur is static.

type Stage =
  | { kind: "actions" }
  | { kind: "loading" }
  | { kind: "result"; data: DefinitionResponse }
  | { kind: "error"; message: string }
  | { kind: "limit-reached" }
  | { kind: "note-view"; note: string }
  | { kind: "note-edit" };

const CARD_WIDTH = 300;
const VIEWPORT_MARGIN = 12;
const NOTE_MAX_LENGTH = 2000;

// How long the AI lookup gets before we stop waiting on it and answer from the
// free dictionary instead. Measured on-device: the request DOES complete, but
// it can take the better part of a minute (cold serverless function plus the
// native HTTP bridge), and a minute of "Thinking..." is indistinguishable from
// a broken feature. A definition in seconds beats a better definition later.
const LOOKUP_TIMEOUT_MS = 8000;
const FALLBACK_TIMEOUT_MS = 5000;

// When the AI lookup passes this, say so in the sheet rather than leaving the
// spinner to imply nothing is happening.
const SLOW_NOTICE_MS = 4000;

/** Bounds a promise by wall-clock time.
 *
 * Not AbortSignal: capacitor.config.ts enables CapacitorHttp, which replaces
 * window.fetch with a native bridge that never reads init.signal - the string
 * "signal" does not appear anywhere in @capacitor/android's native-bridge.js -
 * so AbortSignal.timeout() is silently ignored for the credentialed POST that
 * has to go through that bridge. Racing a timer is what actually bounds it: the
 * native request carries on, but the UI stops waiting on it. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** The unpatched window.fetch, which Capacitor's bridge stashes aside before
 * installing its own (native-bridge.js: `win.CapacitorWebFetch = window.fetch`).
 *
 * Used for the public dictionary lookup only. That request carries no cookies,
 * so it has nothing to gain from the native path - and going direct both
 * honours AbortSignal and skips the `_capacitor_http_interceptor_?u=` rewrite
 * the shim applies to every GET, one less hop that can stall. Falls back to
 * plain fetch on the web, where the bridge was never installed. */
function directFetch(input: string, init?: RequestInit): Promise<Response> {
  const scope = globalThis as typeof globalThis & { CapacitorWebFetch?: typeof fetch };
  const unpatched = scope.CapacitorWebFetch ?? fetch;
  return unpatched(input, init);
}

function timeoutSignal(ms: number): AbortSignal | undefined {
  return typeof AbortSignal !== "undefined" && "timeout" in AbortSignal ? AbortSignal.timeout(ms) : undefined;
}

function formatDefinitionAsNote(data: DefinitionResponse): string {
  return [data.definition, "", "Examples:", ...data.examples.map((example, i) => `${i + 1}. ${example}`)].join("\n");
}

function GlassIconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground active:scale-90"
    >
      {children}
    </button>
  );
}

/** The Define/Copy/loading/result/note stage machine - identical logic and
 * API calls regardless of whether it ends up inside a floating card
 * (desktop) or a bottom sheet (touch). Kept as a hook so both chrome
 * variants share exactly one implementation instead of two copies that
 * could drift. `initialNote` seeds the stage straight to note-view when the
 * highlight being viewed already has one - the whole point being that
 * re-reading a saved note never touches /api/define (and never spends quota). */
function useDefinitionStage(phrase: string, context: string, initialNote: string | undefined) {
  const [stage, setStage] = useState<Stage>(initialNote ? { kind: "note-view", note: initialNote } : { kind: "actions" });
  const [copied, setCopied] = useState(false);
  const [slow, setSlow] = useState(false);
  // Bumped per lookup, so a response that arrives after the reader hit Cancel
  // (or long-pressed a different word) can't land on top of whatever they're
  // looking at now - the request itself is unabortable through the native
  // bridge, so orphaning its result is the only way to cancel it.
  const lookupGeneration = useRef(0);

  function handleCancel() {
    lookupGeneration.current += 1;
    setSlow(false);
    setStage(initialNote ? { kind: "note-view", note: initialNote } : { kind: "actions" });
  }

  async function handleDefine() {
    const generation = ++lookupGeneration.current;
    const isCurrent = () => lookupGeneration.current === generation;

    setSlow(false);
    setStage({ kind: "loading" });

    const slowTimer = setTimeout(() => {
      if (isCurrent()) setSlow(true);
    }, SLOW_NOTICE_MS);

    const commit = (next: Stage) => {
      clearTimeout(slowTimer);
      if (!isCurrent()) return;
      setSlow(false);
      setStage(next);
    };

    // Why the primary lookup fell over, kept for the error stage so a failure
    // says something actionable instead of blaming the reader's connection.
    let primaryFailure = "Couldn't reach FlowRecall's AI definitions.";

    try {
      const res = await withTimeout(
        fetch(apiUrl("/api/define"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phrase, context }),
          credentials: API_FETCH_CREDENTIALS,
        }),
        LOOKUP_TIMEOUT_MS,
      );
      const data = await res.json().catch(() => null);

      if (res.status === 403 && data?.error === "LIMIT_REACHED") {
        commit({ kind: "limit-reached" });
        return;
      }
      if (res.ok && data && data.definition && Array.isArray(data.examples)) {
        commit({ kind: "result", data });
        return;
      }

      primaryFailure =
        res.status === 401
          ? "You need to be signed in for AI definitions."
          : `FlowRecall's AI definitions answered ${res.status}.`;
    } catch (error) {
      primaryFailure =
        (error as Error | undefined)?.message === "timeout"
          ? `The AI definition took longer than ${Math.round(LOOKUP_TIMEOUT_MS / 1000)}s.`
          : "Couldn't reach FlowRecall's AI definitions.";
    }

    if (!isCurrent()) {
      clearTimeout(slowTimer);
      return;
    }

    // Free dictionary fallback - bounded the same way, and sent through the
    // unpatched fetch since it needs no session (see directFetch).
    try {
      const cleanWord = phrase.trim().replace(/^[^\w]+|[^\w]+$/g, "").toLowerCase();
      if (cleanWord) {
        const dictRes = await withTimeout(
          directFetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(cleanWord)}`, {
            signal: timeoutSignal(FALLBACK_TIMEOUT_MS),
          }),
          FALLBACK_TIMEOUT_MS,
        );
        if (dictRes.ok) {
          const dictData = await dictRes.json();
          if (Array.isArray(dictData) && dictData.length > 0) {
            const entry = dictData[0];
            let foundDef = "";
            const foundExamples: string[] = [];

            for (const meaning of entry.meanings || []) {
              for (const def of meaning.definitions || []) {
                if (!foundDef && def.definition) {
                  foundDef = `${meaning.partOfSpeech ? `(${meaning.partOfSpeech}) ` : ""}${def.definition}`;
                }
                if (def.example && foundExamples.length < 2) {
                  foundExamples.push(def.example);
                }
              }
            }

            if (foundDef) {
              if (foundExamples.length === 0 && context) {
                foundExamples.push(`"${phrase}" as used in context: "${context.slice(0, 120)}..."`);
              }
              if (foundExamples.length < 2) {
                foundExamples.push(`Understanding "${phrase}" enhances retention and comprehension during reading.`);
              }

              commit({
                kind: "result",
                data: {
                  definition: foundDef,
                  examples: foundExamples.slice(0, 2),
                },
              });
              return;
            }
          }
        }
      }
    } catch {
      // Fallback failed
    }

    commit({
      kind: "error",
      message: `${primaryFailure} The offline dictionary didn't have it either.`,
    });
  }

  function handleCopy(text: string) {
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1400);
      })
      .catch(() => {
        // Clipboard access can be denied (browser permissions, insecure
        // context) - copy is a convenience action, not core to the "magic"
        // moment, so this fails silently rather than surfacing an error.
      });
  }

  return { stage, setStage, copied, slow, handleDefine, handleCancel, handleCopy };
}

/** The shared inner body (phrase header + stage-dependent content), rendered
 * identically inside FloatingCard and BottomSheet - only the outer
 * positioning/chrome differs between them. */
function DefinitionContent({
  phrase,
  stage,
  setStage,
  copied,
  slow,
  onDefine,
  onCancel,
  onCopy,
  onClose,
  onHighlight,
  onRemoveHighlight,
  onSaveNote,
  note,
  isHighlighted,
  maxBodyHeight,
}: {
  phrase: string;
  stage: Stage;
  setStage: (stage: Stage) => void;
  copied: boolean;
  /** The AI lookup has passed SLOW_NOTICE_MS - tells the reader the wait is
   * known about and bounded, rather than leaving a bare spinner to imply it. */
  slow: boolean;
  onDefine: () => void;
  onCancel: () => void;
  onCopy: (text: string) => void;
  onClose: () => void;
  onHighlight: () => void | Promise<void>;
  onRemoveHighlight: () => void | Promise<void>;
  onSaveNote: (note: string) => void | Promise<void>;
  /** The highlight's currently-persisted note, if any - used only to decide
   * where "Cancel" in note-edit reverts to (the local `stage` state is the
   * source of truth for what's currently rendered). */
  note: string | undefined;
  isHighlighted: boolean;
  maxBodyHeight: string;
}) {
  const [highlighting, setHighlighting] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [savingNote, setSavingNote] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");

  async function handleHighlightClick() {
    setHighlighting(true);
    await onHighlight();
    // Brief inline confirmation (matches Copy's "Copied" feedback) before
    // auto-dismissing - the highlight painting onto the text itself is the
    // real confirmation, this just avoids the popover vanishing too abruptly.
    setTimeout(onClose, 500);
  }

  async function handleRemoveClick() {
    setRemoving(true);
    await onRemoveHighlight();
    // No confirmation delay here (unlike highlighting) - the underline
    // disappearing from the text is instant and unambiguous, and lingering
    // on a "Removed" state for a destructive action reads as sluggish rather
    // than considered.
    onClose();
  }

  function openNoteEditor() {
    setNoteDraft(note ?? "");
    setStage({ kind: "note-edit" });
  }

  function cancelNoteEdit() {
    // Reverts to whichever state is actually correct right now - if a note
    // already existed, back to viewing it (unedited); if this was a fresh
    // "add a note" flow, back to actions. Driven by the persisted `note`
    // prop, not the in-progress draft, so Cancel truly discards the edit.
    setStage(note ? { kind: "note-view", note } : { kind: "actions" });
  }

  async function saveNoteDraft() {
    setSavingNote(true);
    await onSaveNote(noteDraft);
    setSavingNote(false);
    const trimmed = noteDraft.trim();
    setStage(trimmed ? { kind: "note-view", note: trimmed } : { kind: "actions" });
  }

  async function saveDefinitionAsNote() {
    if (stage.kind !== "result") return;
    const formatted = formatDefinitionAsNote(stage.data);
    setSavingNote(true);
    await onSaveNote(formatted);
    setSavingNote(false);
    setStage({ kind: "note-view", note: formatted });
  }

  // Define + Copy always available when viewing a highlight; the second row
  // is highlight-management (add/edit the note, remove the highlight
  // entirely) - visually separated so "read" and "manage" don't blur
  // together. A plain function returning JSX, not a nested component - a
  // component declared inside another component's render body gets a fresh
  // identity every render, forcing React to remount (and reset the state
  // of) everything inside it.
  function renderHighlightActionRows() {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onDefine}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-accent px-3 py-2 text-[13px] font-semibold text-accent-foreground ring-1 ring-inset ring-accent/30 shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_6px_20px_-4px_rgba(0,0,0,0.45)] transition-all duration-150 hover:bg-accent/90 active:scale-[0.97]"
          >
            <span aria-hidden="true">✦</span> Define
          </button>
          <button
            type="button"
            onClick={() => onCopy(phrase)}
            className="flex items-center justify-center rounded-xl border border-border bg-foreground/5 px-2.5 py-2 text-[13px] font-medium text-foreground transition-colors hover:bg-foreground/10 active:scale-[0.97]"
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <div className="flex items-center gap-2 border-t border-border pt-2">
          <button
            type="button"
            onClick={openNoteEditor}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-accent/30 bg-accent/10 px-2.5 py-2 text-[13px] font-medium text-accent transition-colors hover:bg-accent/20 active:scale-[0.97]"
          >
            <span aria-hidden="true">📝</span> {stage.kind === "note-view" ? "Edit Note" : "+ Note"}
          </button>
          <button
            type="button"
            onClick={handleRemoveClick}
            disabled={removing}
            className="flex items-center justify-center gap-1 rounded-xl border border-red-500/30 bg-red-500/10 px-2.5 py-2 text-[13px] font-medium text-red-400 transition-colors hover:bg-red-500/20 active:scale-[0.97] disabled:opacity-70"
          >
            <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5" aria-hidden="true">
              <path
                d="M5 7h14M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m2 0-.8 12.2a2 2 0 0 1-2 1.8H8.8a2 2 0 0 1-2-1.8L6 7"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Remove
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="flex items-center justify-between gap-2 border-b border-border px-3.5 py-2.5">
        <p className="truncate text-[13px] font-semibold text-foreground">&ldquo;{phrase}&rdquo;</p>
        <GlassIconButton label="Close" onClick={onClose}>
          <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
          </svg>
        </GlassIconButton>
      </div>

      <div className="overflow-y-auto no-scrollbar px-3.5 py-3" style={{ maxHeight: maxBodyHeight }}>
        {stage.kind === "actions" &&
          (isHighlighted ? (
            renderHighlightActionRows()
          ) : (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onDefine}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-accent px-3 py-2 text-[13px] font-semibold text-accent-foreground ring-1 ring-inset ring-accent/30 shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_6px_20px_-4px_rgba(0,0,0,0.45)] transition-all duration-150 hover:bg-accent/90 active:scale-[0.97]"
              >
                <span aria-hidden="true">✦</span> Define
              </button>
              <button
                type="button"
                onClick={handleHighlightClick}
                disabled={highlighting}
                className="flex items-center justify-center gap-1 rounded-xl border border-accent/30 bg-accent/10 px-2.5 py-2 text-[13px] font-medium text-accent transition-colors hover:bg-accent/20 active:scale-[0.97] disabled:opacity-70"
              >
                <span aria-hidden="true">▍</span> {highlighting ? "Highlighted ✓" : "Highlight"}
              </button>
              <button
                type="button"
                onClick={() => onCopy(phrase)}
                className="flex items-center justify-center rounded-xl border border-border bg-foreground/5 px-2.5 py-2 text-[13px] font-medium text-foreground transition-colors hover:bg-foreground/10 active:scale-[0.97]"
              >
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
          ))}

        {stage.kind === "loading" && (
          <div className="flex flex-col gap-2 py-1.5">
            <div className="flex items-center gap-2.5">
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 0.8, repeat: Infinity, ease: "linear" }}
                className="h-4 w-4 rounded-full border-2 border-border border-t-accent"
              />
              <p className="text-[13px] text-muted-foreground">Thinking...</p>
              <button
                type="button"
                onClick={onCancel}
                className="ml-auto rounded-lg px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground active:scale-[0.97]"
              >
                Cancel
              </button>
            </div>
            {slow && (
              <motion.p
                initial={{ opacity: 0, y: 3 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.18 }}
                className="text-xs leading-relaxed text-muted-foreground/80"
              >
                Taking longer than usual - falling back to a dictionary definition in a moment.
              </motion.p>
            )}
          </div>
        )}

        {stage.kind === "error" && (
          <div className="flex flex-col gap-2">
            <p className="text-[13px] text-muted-foreground">{stage.message}</p>
            <button
              type="button"
              onClick={onDefine}
              className="self-start rounded-lg border border-border bg-foreground/5 px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-foreground/10"
            >
              Retry
            </button>
          </div>
        )}

        {stage.kind === "limit-reached" && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18 }}
            className="flex flex-col items-center gap-3 py-1 text-center"
          >
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-b from-accent/25 to-accent/10 ring-1 ring-inset ring-accent/40 shadow-[0_0_24px_-4px_hsl(var(--accent)/0.5)]">
              <span className="text-2xl" aria-hidden="true">
                🔒
              </span>
            </div>
            <div>
              <p className="text-[14px] font-semibold text-foreground">You&rsquo;ve used your 20 free AI lookups</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Upgrade to Pro for infinite definitions - never break your reading flow again.
              </p>
            </div>
            <Link
              href="/pricing"
              className="mt-1 inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-accent px-4 py-2.5 text-[13px] font-semibold text-accent-foreground ring-1 ring-inset ring-accent/30 shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_8px_28px_-6px_rgba(0,0,0,0.5)] transition-all duration-200 hover:bg-accent/90 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_10px_36px_-4px_rgba(0,0,0,0.6)] active:scale-[0.97]"
            >
              <span aria-hidden="true">✦</span> Upgrade to Pro
            </Link>
          </motion.div>
        )}

        {stage.kind === "result" && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18 }}
            className="flex flex-col gap-3"
          >
            <p className="text-[13.5px] leading-relaxed text-foreground">{stage.data.definition}</p>
            <div className="flex flex-col gap-1.5 border-t border-border pt-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-accent/80">Examples</p>
              {stage.data.examples.map((example, i) => (
                <p key={i} className="text-xs leading-relaxed text-muted-foreground">
                  <span className="text-muted-foreground/70">{i + 1}.</span> {example}
                </p>
              ))}
            </div>
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => onCopy(stage.kind === "result" ? stage.data.definition : "")}
                className="text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                {copied ? "Copied ✓" : "Copy definition"}
              </button>
              {isHighlighted && (
                <button
                  type="button"
                  onClick={saveDefinitionAsNote}
                  disabled={savingNote}
                  className="text-[11px] font-medium text-accent transition-colors hover:text-accent/80 disabled:opacity-60"
                >
                  {savingNote ? "Saving..." : "📝 Save as Note"}
                </button>
              )}
            </div>
          </motion.div>
        )}

        {stage.kind === "note-view" && (
          <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18 }} className="flex flex-col gap-3">
            <div className="rounded-xl border border-accent/20 bg-accent/[0.06] p-3">
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-accent/70">Your Note</p>
              <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-foreground">{stage.note}</p>
            </div>
            {renderHighlightActionRows()}
          </motion.div>
        )}

        {stage.kind === "note-edit" && (
          <div className="flex flex-col gap-2.5">
            <textarea
              autoFocus
              value={noteDraft}
              onChange={(e) => setNoteDraft(e.target.value)}
              placeholder="Type your thoughts, or save a definition you want to remember..."
              maxLength={NOTE_MAX_LENGTH}
              rows={4}
              className="w-full resize-none rounded-xl border border-border bg-foreground/[0.03] p-3 text-[13px] leading-relaxed text-foreground placeholder-muted-foreground outline-none transition-colors focus:border-accent/40"
            />
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={saveNoteDraft}
                disabled={savingNote}
                className="flex flex-1 items-center justify-center rounded-xl bg-accent px-3 py-2 text-[13px] font-semibold text-accent-foreground ring-1 ring-inset ring-accent/30 shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_6px_20px_-4px_rgba(0,0,0,0.45)] transition-all duration-150 hover:bg-accent/90 active:scale-[0.97] disabled:opacity-70"
              >
                {savingNote ? "Saving..." : "Save"}
              </button>
              <button
                type="button"
                onClick={cancelNoteEdit}
                className="flex items-center justify-center rounded-xl border border-border bg-foreground/5 px-3.5 py-2 text-[13px] font-medium text-foreground transition-colors hover:bg-foreground/10 active:scale-[0.97]"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

/** Desktop chrome: a small glassmorphic card anchored right next to the
 * selection - there's no OS text-selection menu to collide with on desktop,
 * so the existing floating popover stays exactly as it was. */
function FloatingCard({
  phrase,
  anchor,
  onClose,
  onHighlight,
  onRemoveHighlight,
  onSaveNote,
  note,
  isHighlighted,
  ...stageProps
}: {
  phrase: string;
  anchor: SelectionAnchor;
  onClose: () => void;
  onHighlight: () => void | Promise<void>;
  onRemoveHighlight: () => void | Promise<void>;
  onSaveNote: (note: string) => void | Promise<void>;
  note: string | undefined;
  isHighlighted: boolean;
} & Pick<
  ReturnType<typeof useDefinitionStage>,
  "stage" | "setStage" | "copied" | "slow" | "handleDefine" | "handleCancel" | "handleCopy"
>) {
  const cardRef = useRef<HTMLDivElement>(null);

  // Centered-then-clamped `left`, computed directly in px (not via CSS
  // translateX(-50%)): motion.div composes its own `transform` string from
  // the scale/y motion values below and overwrites any transform set via
  // plain `style`, so a manual translateX would silently never apply.
  const left = Math.min(
    Math.max(anchor.x - CARD_WIDTH / 2, VIEWPORT_MARGIN),
    (typeof window !== "undefined" ? window.innerWidth : CARD_WIDTH) - CARD_WIDTH - VIEWPORT_MARGIN,
  );

  // Always position via a measured, clamped `top` in px rather than CSS
  // `bottom` - anchoring "above" placement with `bottom` lets the card grow
  // UPWARD off the top of the screen as the AI result expands it. useLayoutEffect
  // re-measures and re-clamps before paint whenever the card's content (stage) changes.
  const [top, setTop] = useState(() => Math.max(anchor.y + 12, VIEWPORT_MARGIN));

  useLayoutEffect(() => {
    const height = cardRef.current?.getBoundingClientRect().height ?? 0;
    const viewportHeight = window.innerHeight;
    const candidate = anchor.placement === "below" ? anchor.y + 12 : anchor.y - 12 - height;
    setTop(Math.min(Math.max(candidate, VIEWPORT_MARGIN), viewportHeight - height - VIEWPORT_MARGIN));
  }, [anchor, stageProps.stage]);

  return (
    <AnimatePresence>
      <motion.div
        ref={cardRef}
        role="dialog"
        aria-label={`Definition of ${phrase}`}
        className={`fixed z-40 overflow-hidden rounded-2xl bg-surface/80 text-left backdrop-blur-xl transition-[top] duration-150 ease-out ${
          stageProps.stage.kind === "limit-reached"
            ? "border border-accent/30 shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_0_40px_-6px_hsl(var(--accent)/0.35),0_20px_60px_-12px_rgba(0,0,0,0.8)]"
            : "border border-border shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_20px_60px_-12px_rgba(0,0,0,0.8)]"
        }`}
        style={{ width: CARD_WIDTH, left, top, transformOrigin: anchor.placement === "below" ? "top center" : "bottom center" }}
        initial={{ opacity: 0, scale: 0.92, y: anchor.placement === "below" ? -6 : 6 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.92, y: anchor.placement === "below" ? -6 : 6 }}
        transition={{ type: "spring", stiffness: 420, damping: 32 }}
      >
        <DefinitionContent
          phrase={phrase}
          onDefine={stageProps.handleDefine}
          onCancel={stageProps.handleCancel}
          onCopy={stageProps.handleCopy}
          slow={stageProps.slow}
          onClose={onClose}
          onHighlight={onHighlight}
          onRemoveHighlight={onRemoveHighlight}
          onSaveNote={onSaveNote}
          note={note}
          isHighlighted={isHighlighted}
          stage={stageProps.stage}
          setStage={stageProps.setStage}
          copied={stageProps.copied}
          maxBodyHeight="45vh"
        />
      </motion.div>
    </AnimatePresence>
  );
}

/** Touch chrome: a bottom sheet, not a floating card anchored to the
 * selection. Two reasons this is the right call specifically on mobile: (1)
 * it's nowhere near the text the student is reading, so even in the rare
 * case the OS menu flashes before selection.ts's collapse trick wins the
 * race, they don't visually collide; (2) it matches the platform convention
 * for exactly this interaction - Apple's own Look Up and Kindle's dictionary
 * both present as a bottom panel, never a tooltip over your sentence. */
function BottomSheet({
  phrase,
  onClose,
  onHighlight,
  onRemoveHighlight,
  onSaveNote,
  note,
  isHighlighted,
  ...stageProps
}: {
  phrase: string;
  onClose: () => void;
  onHighlight: () => void | Promise<void>;
  onRemoveHighlight: () => void | Promise<void>;
  onSaveNote: (note: string) => void | Promise<void>;
  note: string | undefined;
  isHighlighted: boolean;
} & Pick<
  ReturnType<typeof useDefinitionStage>,
  "stage" | "setStage" | "copied" | "slow" | "handleDefine" | "handleCancel" | "handleCopy"
>) {
  // The tap that OPENS this sheet is followed, a beat later, by the
  // browser's synthetic compatibility "click" (mobile browsers replay
  // touchstart+touchend as mousedown/mouseup/click for legacy mouse-only
  // code). That trailing click lands at the same screen point the tap
  // occurred - which, the instant this sheet mounts, is now covered by this
  // very dismiss scrim - so without this guard, opening the sheet
  // self-dismisses it within the same gesture. A short mount grace period
  // ignores dismiss clicks that arrive suspiciously fast, while a genuine
  // later tap-to-dismiss works normally.
  const readyRef = useRef(false);
  useEffect(() => {
    const timer = setTimeout(() => {
      readyRef.current = true;
    }, 300);
    return () => clearTimeout(timer);
  }, []);

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-40 flex items-end justify-center"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }}
      >
        <button
          type="button"
          aria-label="Dismiss"
          onClick={() => {
            if (readyRef.current) onClose();
          }}
          className="absolute inset-0 bg-black/40"
        />

        <motion.div
          role="dialog"
          aria-label={`Definition of ${phrase}`}
          className={`relative w-full max-w-lg overflow-hidden rounded-t-3xl bg-surface/95 text-left backdrop-blur-xl ${
            stageProps.stage.kind === "limit-reached"
              ? "border-t border-accent/30 shadow-[0_-4px_40px_-6px_hsl(var(--accent)/0.35),0_-20px_60px_-12px_rgba(0,0,0,0.85)]"
              : "border-t border-border shadow-[0_-20px_60px_-12px_rgba(0,0,0,0.85)]"
          }`}
          style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
          initial={{ y: "100%" }}
          animate={{ y: 0 }}
          exit={{ y: "100%" }}
          transition={{ type: "spring", stiffness: 380, damping: 34 }}
        >
          <div className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-foreground/15" aria-hidden="true" />
          <DefinitionContent
            phrase={phrase}
            onDefine={stageProps.handleDefine}
            onCancel={stageProps.handleCancel}
            onCopy={stageProps.handleCopy}
            slow={stageProps.slow}
            onClose={onClose}
            onHighlight={onHighlight}
            onRemoveHighlight={onRemoveHighlight}
            onSaveNote={onSaveNote}
            note={note}
            isHighlighted={isHighlighted}
            stage={stageProps.stage}
            setStage={stageProps.setStage}
            copied={stageProps.copied}
            maxBodyHeight="60vh"
          />
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

export default function DefinitionPopover({
  phrase,
  context,
  anchor,
  onClose,
  onHighlight,
  onRemoveHighlight,
  onSaveNote,
  note,
  isHighlighted = false,
}: {
  phrase: string;
  context: string;
  anchor: SelectionAnchor;
  onClose: () => void;
  onHighlight: () => void | Promise<void>;
  /** Present + isHighlighted=true when this popover was opened by tapping an
   * EXISTING highlight (see each ReaderView's handleHighlightTap) rather than
   * a fresh selection - swaps the "Highlight" action for "Remove" and enables
   * the note UI (notes attach to highlights, not to plain selections). */
  onRemoveHighlight?: () => void | Promise<void>;
  onSaveNote?: (note: string) => void | Promise<void>;
  /** The highlight's currently-persisted note, if any - opens the popover
   * straight to note-view instead of actions, so re-reading a saved note
   * never calls /api/define (and never spends a lookup). */
  note?: string;
  isHighlighted?: boolean;
}) {
  const isTouch = useIsTouchDevice();
  const { stage, setStage, copied, slow, handleDefine, handleCancel, handleCopy } = useDefinitionStage(
    phrase,
    context,
    note,
  );
  const noopRemove = () => {};
  const noopSaveNote = () => {};

  if (isTouch) {
    return (
      <BottomSheet
        phrase={phrase}
        onClose={onClose}
        onHighlight={onHighlight}
        onRemoveHighlight={onRemoveHighlight ?? noopRemove}
        onSaveNote={onSaveNote ?? noopSaveNote}
        note={note}
        isHighlighted={isHighlighted}
        stage={stage}
        setStage={setStage}
        copied={copied}
        slow={slow}
        handleDefine={handleDefine}
        handleCancel={handleCancel}
        handleCopy={handleCopy}
      />
    );
  }

  return (
    <FloatingCard
      phrase={phrase}
      anchor={anchor}
      onClose={onClose}
      onHighlight={onHighlight}
      onRemoveHighlight={onRemoveHighlight ?? noopRemove}
      onSaveNote={onSaveNote ?? noopSaveNote}
      note={note}
      isHighlighted={isHighlighted}
      stage={stage}
      setStage={setStage}
      copied={copied}
      slow={slow}
      handleDefine={handleDefine}
      handleCancel={handleCancel}
      handleCopy={handleCopy}
    />
  );
}
