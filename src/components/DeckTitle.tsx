"use client";

import { useRef, useState } from "react";
import type { Deck } from "@/lib/types";
import { MAX_DECK_TITLE, normaliseDeckTitle } from "@/lib/deckTitle";
import { renameDeck } from "@/lib/storage";
import { vibrateTap } from "@/lib/haptics";

/** Call a deck what you actually call it.
 *
 * A generated title is the model's guess at what a PDF was about, and it is often
 * "Microsoft Word - lecture4_final(2)". Until now that guess was permanent, which put
 * this in the same category as an uncorrectable card - see ConceptEditor's note on
 * why an app that generates your material and then refuses to let you fix it is
 * asking for more trust than it has earned.
 *
 * Renaming is cheap and reversible, so there is no confirm and no Save button: Enter
 * or a tap elsewhere commits, Escape discards. What it cannot do is blank a title -
 * `normaliseDeckTitle` returns null for an empty edit and that is read as "keep the
 * old one", because a nameless row is a state no screen in this app can render
 * usefully.
 *
 * The pencil is CSS-only rather than driven by `useIsTouchDevice`: that hook seeds
 * its state from `matchMedia` in a useState initialiser, which is a hydration
 * mismatch waiting to happen on a page that already gates on hydration once. A
 * pointer media query does the same job with no JavaScript at all - always visible
 * where there is no hover to reveal it, revealed on hover or keyboard focus where
 * there is. */
export default function DeckTitle({ deck }: { deck: Deck }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(deck.title);
  // Escape has to be able to beat the blur that follows it. Without this flag the
  // input's own onBlur fires as focus leaves and commits the draft the student just
  // asked to throw away.
  const cancelled = useRef(false);

  function open() {
    setDraft(deck.title);
    cancelled.current = false;
    setEditing(true);
  }

  function commit() {
    setEditing(false);
    if (cancelled.current) return;
    const title = normaliseDeckTitle(draft);
    // Null is an empty edit, and an unchanged title is not worth a write - either
    // would stamp `updatedAt` and send a no-op deck up on the next sync.
    if (title === null || title === deck.title) return;
    vibrateTap();
    renameDeck(deck.id, title);
  }

  // Split once per render so the pencil can be pinned to the final word - see the
  // nowrap span below. A title is never empty (normaliseDeckTitle refuses to store
  // one), so there is always a last word to pin it to.
  const words = deck.title.split(" ");
  const lastWord = words.pop() ?? deck.title;
  const head = words.join(" ");

  if (editing) {
    return (
      <input
        // Autofocus is right here and nowhere else on this screen: the input only
        // exists because the student just asked for it.
        autoFocus
        value={draft}
        maxLength={MAX_DECK_TITLE}
        aria-label="Deck title"
        onChange={(event) => setDraft(event.target.value)}
        onFocus={(event) => event.currentTarget.select()}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            event.currentTarget.blur();
          } else if (event.key === "Escape") {
            event.preventDefault();
            cancelled.current = true;
            event.currentTarget.blur();
          }
        }}
        className="w-full rounded-lg border border-accent/50 bg-background/60 px-2 py-1 text-lg font-semibold text-foreground outline-none"
      />
    );
  }

  return (
    <h3>
      <button
        type="button"
        onClick={open}
        title="Rename deck"
        className="block w-full rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
      >
        {/* Two lines, not one truncated one. Measured on the device: a card's title
            was being clipped at scrollWidth 234 against clientWidth 208, so
            "Pharmacology: autono…" and "Krebs Cycle — Lecture…" lost the part that
            told them apart. A clamp costs height only for the titles that need it.

            The pencil is INSIDE the clamped box, trailing the last word, rather than
            pushed to the far right of the row. Measured on the device after the
            delete × moved onto this row: right-aligned, the two ended up adjacent
            and identically weighted, which puts a destructive control a thumb-width
            from a harmless one. Trailing the text, it reads as part of the title and
            keeps the × alone in the corner. */}
        <span className="line-clamp-2 break-words text-lg font-semibold leading-snug text-foreground">
          {head && `${head} `}
          {/* The last word and the pencil are one unwrappable unit. Without this the
              icon is a widow: measured on the device, "Pharmacology: autonomics"
              wrapped to two lines and left the pencil sitting alone on a third,
              under the title, looking like a stray control rather than part of it. */}
          <span className="whitespace-nowrap">
            {lastWord}
            <PencilIcon
              className="ml-1.5 inline-block h-3.5 w-3.5 align-middle text-muted-foreground transition-opacity md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100"
            />
          </span>
        </span>
        <span className="sr-only">Rename deck</span>
      </button>
    </h3>
  );
}

function PencilIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="m14.5 5.5 4 4M4.5 19.5l1-4.2 9.6-9.6a1.4 1.4 0 0 1 2 0l1.2 1.2a1.4 1.4 0 0 1 0 2l-9.6 9.6-4.2 1Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
