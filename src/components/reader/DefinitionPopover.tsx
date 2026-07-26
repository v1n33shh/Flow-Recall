"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { DefinitionResponse } from "@/lib/definitionSchema";
import type { SelectionAnchor } from "./selection";

// PERFORMANCE CONTRACT (matches StreakModal/StudyFeed): entrance/exit only
// ever animates transform + opacity. backdrop-blur is static.

type Stage =
  | { kind: "actions" }
  | { kind: "loading" }
  | { kind: "result"; data: DefinitionResponse }
  | { kind: "error"; message: string };

const CARD_WIDTH = 300;
const VIEWPORT_MARGIN = 12;

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
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-zinc-400 transition-colors hover:bg-white/10 hover:text-zinc-200 active:scale-90"
    >
      {children}
    </button>
  );
}

export default function DefinitionPopover({
  phrase,
  context,
  anchor,
  onClose,
}: {
  phrase: string;
  context: string;
  anchor: SelectionAnchor;
  onClose: () => void;
}) {
  const [stage, setStage] = useState<Stage>({ kind: "actions" });
  const [copied, setCopied] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  async function handleDefine() {
    setStage({ kind: "loading" });
    try {
      const res = await fetch("/api/define", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phrase, context }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data) {
        setStage({ kind: "error", message: data?.error ?? "Couldn't fetch a definition. Try again." });
        return;
      }
      setStage({ kind: "result", data });
    } catch {
      setStage({ kind: "error", message: "Couldn't reach FlowRecall. Check your connection." });
    }
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
  // UPWARD off the top of the screen as the AI result expands it (caught by
  // an automated selection test: the close button became unreachable the
  // instant a definition came back). useLayoutEffect re-measures and
  // re-clamps before paint whenever the card's content (stage) changes.
  const [top, setTop] = useState(() => Math.max(anchor.y + 12, VIEWPORT_MARGIN));

  useLayoutEffect(() => {
    const height = cardRef.current?.getBoundingClientRect().height ?? 0;
    const viewportHeight = window.innerHeight;
    const candidate = anchor.placement === "below" ? anchor.y + 12 : anchor.y - 12 - height;
    setTop(Math.min(Math.max(candidate, VIEWPORT_MARGIN), viewportHeight - height - VIEWPORT_MARGIN));
  }, [anchor, stage]);

  return (
    <AnimatePresence>
      <motion.div
        ref={cardRef}
        role="dialog"
        aria-label={`Definition of ${phrase}`}
        className="fixed z-40 overflow-hidden rounded-2xl border border-white/10 bg-surface/80 text-left shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_20px_60px_-12px_rgba(0,0,0,0.8)] backdrop-blur-xl transition-[top] duration-150 ease-out"
        style={{ width: CARD_WIDTH, left, top, transformOrigin: anchor.placement === "below" ? "top center" : "bottom center" }}
        initial={{ opacity: 0, scale: 0.92, y: anchor.placement === "below" ? -6 : 6 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.92, y: anchor.placement === "below" ? -6 : 6 }}
        transition={{ type: "spring", stiffness: 420, damping: 32 }}
      >
        <div className="flex items-center justify-between gap-2 border-b border-white/10 px-3.5 py-2.5">
          <p className="truncate text-[13px] font-semibold text-zinc-100">&ldquo;{phrase}&rdquo;</p>
          <GlassIconButton label="Close" onClick={onClose}>
            <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
            </svg>
          </GlassIconButton>
        </div>

        <div className="max-h-[45vh] overflow-y-auto no-scrollbar px-3.5 py-3">
          {stage.kind === "actions" && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleDefine}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-gradient-to-b from-blue-500 to-blue-600 px-3 py-2 text-[13px] font-semibold text-white ring-1 ring-inset ring-blue-400/40 shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_6px_20px_-4px_rgba(37,99,235,0.6)] transition-all duration-150 hover:from-blue-400 hover:to-blue-500 active:scale-[0.97]"
              >
                <span aria-hidden="true">✦</span> Define
              </button>
              <button
                type="button"
                onClick={() => handleCopy(phrase)}
                className="flex items-center justify-center rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-[13px] font-medium text-zinc-300 transition-colors hover:bg-white/10 active:scale-[0.97]"
              >
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
          )}

          {stage.kind === "loading" && (
            <div className="flex items-center gap-2.5 py-1.5">
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 0.8, repeat: Infinity, ease: "linear" }}
                className="h-4 w-4 rounded-full border-2 border-white/15 border-t-accent"
              />
              <p className="text-[13px] text-zinc-400">Thinking...</p>
            </div>
          )}

          {stage.kind === "error" && (
            <div className="flex flex-col gap-2">
              <p className="text-[13px] text-zinc-400">{stage.message}</p>
              <button
                type="button"
                onClick={handleDefine}
                className="self-start rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:bg-white/10"
              >
                Retry
              </button>
            </div>
          )}

          {stage.kind === "result" && (
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.18 }}
              className="flex flex-col gap-3"
            >
              <p className="text-[13.5px] leading-relaxed text-zinc-200">{stage.data.definition}</p>
              <div className="flex flex-col gap-1.5 border-t border-white/10 pt-2.5">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-accent/80">Examples</p>
                {stage.data.examples.map((example, i) => (
                  <p key={i} className="text-xs leading-relaxed text-zinc-400">
                    <span className="text-zinc-600">{i + 1}.</span> {example}
                  </p>
                ))}
              </div>
              <button
                type="button"
                onClick={() => handleCopy(stage.kind === "result" ? stage.data.definition : "")}
                className="self-start text-[11px] font-medium text-zinc-500 transition-colors hover:text-zinc-300"
              >
                {copied ? "Copied ✓" : "Copy definition"}
              </button>
            </motion.div>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
