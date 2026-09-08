"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type Book from "epubjs/types/book";
import type Rendition from "epubjs/types/rendition";
import type Contents from "epubjs/types/contents";
import type { NavItem } from "epubjs/types/navigation";
import {
  addHighlight,
  deleteHighlight,
  getBookFile,
  getBookMeta,
  listHighlights,
  updateHighlightNote,
  updateReadingPosition,
} from "@/lib/readerStorage";
import type { HighlightRecord } from "@/lib/types";
import {
  anchorFromRect,
  attachLongPressToDefine,
  getBlockContext,
  isCoarsePointer,
  LONG_PRESS_COMMIT_MS,
  type PendingSelection,
  type SelectionAnchor,
} from "./selection";
import DefinitionPopover from "./DefinitionPopover";
import ReaderChrome, { ReaderErrorState } from "./ReaderChrome";
import DisplaySettingsMenu from "./DisplaySettingsMenu";
import SelectionHighlight from "./SelectionHighlight";
import {
  FONT_FAMILY_CSS,
  FONT_PERCENT_MAX,
  FONT_PERCENT_MIN,
  FONT_PERCENT_STEP,
  READER_FONTS_HREF,
  getReaderPreferences,
  setReaderPreferences,
  type EpubScrollMode,
  type FontFamilyId,
} from "@/lib/readerPreferences";

const READER_FONTS_LINK_ID = "flowrecall-reader-fonts";
const READER_SELECT_GUARD_STYLE_ID = "flowrecall-reader-select-guard";

/** epub.js's content iframes are separate documents that don't inherit the
 * parent page's stylesheets - Display Settings' "Modern Sans"/"Legible"
 * font-family values only actually render if this same Google Fonts
 * stylesheet is present in THIS document's own <head> too (see
 * readerPreferences.ts's READER_FONTS_HREF doc comment). Guarded by id since
 * each chapter/page re-render fires "rendered" again for the same document. */
function ensureReaderFontsLoaded(doc: Document) {
  if (doc.getElementById(READER_FONTS_LINK_ID)) return;
  const link = doc.createElement("link");
  link.id = READER_FONTS_LINK_ID;
  link.rel = "stylesheet";
  link.href = READER_FONTS_HREF;
  doc.head.appendChild(link);
}

/** Disables native text selection and its callout menu inside the chapter
 * iframe on touch devices - each chapter renders into its own sandboxed
 * document that doesn't inherit globals.css's .native-app rules, so this has
 * to be injected directly. Without it, Android's "Copy | Look Up | Share"
 * action bar would still be free to form the instant a real Selection does -
 * long-press-to-define resolves the word straight from the pointer's
 * coordinates instead (see attachLongPressToDefine), so no Selection ever
 * needs to exist on touch. Guarded by id since "rendered" refires per
 * chapter/page against what may be the same document (e.g. a font-size change). */
function ensureNoNativeSelection(doc: Document) {
  if (doc.getElementById(READER_SELECT_GUARD_STYLE_ID)) return;
  const style = doc.createElement("style");
  style.id = READER_SELECT_GUARD_STYLE_ID;
  style.textContent = `
    * {
      -webkit-user-select: none;
      user-select: none;
      -webkit-touch-callout: none;
    }
  `;
  doc.head.appendChild(style);
}

/** Tap-to-turn zones, attached INSIDE a chapter's iframe document.
 *
 * The .reader-page-turn overlays at the bottom of this file are the desktop
 * affordance; globals.css drops them under (pointer: coarse) because, sitting
 * on top of the iframe, they swallowed long-press-to-define across the outer
 * 15% of every page - a touch landing on one never reached the iframe
 * document, so selection.ts never saw the press at all. This puts the same
 * zones back in the only place that can't block anything: the document that
 * actually receives the touch.
 *
 * Splits tap from long-press on selection.ts's own LONG_PRESS_COMMIT_MS, so a
 * press resolves to exactly one of the two - never both, never neither. */
function attachTapToTurn(
  doc: Document,
  frameEl: HTMLElement | null,
  onPrev: () => void,
  onNext: () => void,
): void {
  const TAP_ZONE_FRACTION = 0.15;
  const TAP_MAX_MOVE_PX = 10;

  let startX = 0;
  let startY = 0;
  let startedAt = 0;
  let tracking = false;

  function onTouchStart(e: Event) {
    const touches = (e as TouchEvent).touches;
    // A second finger is a pinch, not a page turn.
    if (touches.length !== 1) {
      tracking = false;
      return;
    }
    startX = touches[0].clientX;
    startY = touches[0].clientY;
    startedAt = Date.now();
    tracking = true;
  }

  function onTouchEnd(e: Event) {
    if (!tracking) return;
    tracking = false;

    const touch = (e as TouchEvent).changedTouches[0];
    if (!touch) return;
    if (Date.now() - startedAt >= LONG_PRESS_COMMIT_MS) return;
    if (Math.abs(touch.clientX - startX) > TAP_MAX_MOVE_PX) return;
    if (Math.abs(touch.clientY - startY) > TAP_MAX_MOVE_PX) return;

    // Touch coordinates inside an iframe are relative to that iframe's own
    // viewport, so its visible box is the right reference. Measured fresh per
    // tap rather than captured at attach time: a rotation in between would
    // otherwise put the zones at the wrong fraction of the screen.
    const bounds = frameEl?.getBoundingClientRect();
    const width = bounds?.width || doc.documentElement.clientWidth;
    const height = bounds?.height || doc.documentElement.clientHeight;
    if (width <= 0 || height <= 0) return;

    const relY = touch.clientY / height;
    // Same vertical band the desktop overlays cover (inset-y-[15%]), so both
    // input paths turn pages from the same places.
    if (relY < 0.15 || relY > 0.85) return;

    const relX = touch.clientX / width;
    if (relX <= TAP_ZONE_FRACTION) onPrev();
    else if (relX >= 1 - TAP_ZONE_FRACTION) onNext();
  }

  function onTouchCancel() {
    tracking = false;
  }

  doc.addEventListener("touchstart", onTouchStart, { passive: true });
  doc.addEventListener("touchend", onTouchEnd, { passive: true });
  doc.addEventListener("touchcancel", onTouchCancel, { passive: true });
}

type LoadState = "loading" | "ready" | "error";

// Rendered as an "underline" annotation (marks-pane draws an invisible
// fill:none hit-box rect plus a visible <line>), not "highlight" (a filled
// rect) - the bold Electric Azure underline the reader wants instead of a
// background block. marks-pane hardcodes the <line>'s stroke/stroke-width
// and ignores `styles` for that child element entirely, so the actual color
// comes from a CSS override in globals.css targeting our own ref-scoped
// selector; `mix-blend-mode: normal` here still matters though - it applies
// to the whole annotation group, overriding marks-pane's default "multiply"
// (designed for light backgrounds; on our near-black background it crushes
// toward black instead of showing Electric Azure).
const EPUB_HIGHLIGHT_STYLES = { "mix-blend-mode": "normal" };
const EPUB_HIGHLIGHT_CLASS = "flowrecall-highlight";

type PopoverState =
  | { kind: "selection"; data: PendingSelection }
  | { kind: "highlight"; record: HighlightRecord; anchor: SelectionAnchor };

function flattenToc(items: NavItem[]): NavItem[] {
  return items.flatMap((item) => [item, ...(item.subitems ? flattenToc(item.subitems) : [])]);
}

/** "Jump to any chapter" trigger + popover - the chapter list itself
 * (`toc`) was already being parsed and flattened just to label the current
 * chapter in the header; this is the first place it's actually rendered.
 * Visual recipe matches DisplaySettingsMenu's panel exactly (same corner
 * radius, border, blur, shadow) so it reads as part of the same toolbar
 * family, not a bolted-on dialog. */
function ChaptersMenu({ toc, onSelect }: { toc: NavItem[]; onSelect: (href: string) => void }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(e: PointerEvent) {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  if (toc.length === 0) return null;

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-label="Chapters"
        onClick={() => setOpen((v) => !v)}
        className={`flex h-8 w-8 items-center justify-center rounded-full text-foreground transition-colors active:scale-90 ${
          open ? "bg-foreground/15" : "hover:bg-foreground/10"
        }`}
      >
        <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden="true">
          <path
            d="M4 6h16M4 12h16M4 18h10"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {open && (
        <div
          ref={panelRef}
          className="absolute right-0 top-[calc(100%+0.5rem)] z-50 max-h-80 w-72 overflow-y-auto rounded-2xl border border-border bg-surface/90 p-2 text-left shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_20px_60px_-12px_rgba(0,0,0,0.8)] backdrop-blur-xl"
        >
          {toc.map((item, i) => (
            <button
              key={`${item.href}:${i}`}
              type="button"
              onClick={() => {
                onSelect(item.href);
                setOpen(false);
              }}
              className="block w-full truncate rounded-xl px-3 py-2 text-left text-xs font-medium text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
            >
              {item.label.trim()}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Reads --reader-highlight's raw "H S% L%" components off the host
 * document at call time. Falls back to the token's known globals.css value
 * only if the custom property is ever missing (e.g. a detached iframe). */
function getReaderHighlightHsl(): string {
  const raw = getComputedStyle(document.documentElement).getPropertyValue("--reader-highlight").trim();
  return raw || "217 91% 60%";
}

function registerObsidianTheme(rendition: Rendition) {
  // Matches the app's "Pure Monochrome" tokens, but swaps to a serif reading
  // face - established typography practice for long-form body text, and
  // distinct enough from the UI chrome's Geist Sans that "reading mode"
  // reads as its own deliberate surface, not a bug. Always forced dark
  // (unconditional, doesn't follow the light/dark toggle) - epub.js renders
  // into its own sandboxed iframe document, which can't see our :root
  // custom properties, so the accent here is the literal dark-mode value
  // (brilliant white) rather than hsl(var(--accent)).
  rendition.themes.register("obsidian", {
    body: {
      background: "#050505 !important",
      color: "#e4e4e7 !important",
      "font-family": "Georgia, Cambria, 'Times New Roman', serif !important",
      "line-height": "1.75 !important",
    },
    p: { "margin-bottom": "1.1em !important" },
    a: { color: "#FFFFFF !important" },
    // epub.js's iframe can't see our :root custom properties, so this reads
    // --reader-highlight's raw "H S% L%" components at call time and rebuilds
    // them as a CSS Color 4 hsl() string - no second hardcoded literal to
    // drift out of sync with globals.css/SelectionHighlight.tsx.
    "::selection": { background: `hsl(${getReaderHighlightHsl()} / 0.35)` },
  });
  rendition.themes.select("obsidian");
}

export default function EpubReaderView({
  bookId,
  onExit,
  onScrollModeChange,
}: {
  bookId: string;
  onExit: () => void;
  /** Called after a new epub scroll-mode preference is persisted - epub.js's
   * flow can't be safely hot-swapped on a live rendition, so the parent
   * (ReaderOpenDispatcher) responds by bumping this component's `key`,
   * forcing a clean remount that re-reads the new preference at setup. The
   * CFI position survives the remount since it's already persisted to
   * IndexedDB independent of flow mode. */
  onScrollModeChange?: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const bookRef = useRef<Book | null>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const tocRef = useRef<NavItem[]>([]);
  // Read once per mount and never updated from within this instance - see
  // onScrollModeChange's doc comment above for why a change mid-session
  // forces a full remount (a fresh `key`) rather than updating this in place.
  const [scrollMode] = useState<EpubScrollMode>(() => getReaderPreferences().epubScrollMode);
  // Guards against a genuine race: loading saved highlights on mount and the
  // user creating a new one via handleHighlight are two independent async
  // paths that can BOTH resolve for the same record (e.g. the user
  // highlights something before the mount-time listHighlights() read
  // finishes) - epub.js's annotations API has no "already exists" check of
  // its own, so calling .underline() twice for the same record renders it twice.
  const appliedHighlightIds = useRef(new Set<string>());
  // The live record behind each drawn underline, keyed by id. epub.js keeps an
  // annotation's click handler for the whole life of that annotation, so a
  // handler closing over the record it was CREATED with keeps serving that
  // snapshot - and a note attached afterwards is invisible to every later tap
  // until the book is reopened (mount re-reads storage). The closure carries
  // only the id and reads the record from here.
  const highlightRecords = useRef(new Map<string, HighlightRecord>());
  // epub.js fires "rendered" again for a document it has already rendered
  // into (a font-size change, or returning to a section still loaded in the
  // iframe), and listeners added to a document outlive that re-render. Without
  // this guard the long-press handler stacks up, and one press then fires N
  // haptic buzzes and N setPopover calls.
  const wiredDocuments = useRef(new WeakSet<Document>());

  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [errorMessage, setErrorMessage] = useState("");
  const [progress, setProgress] = useState(0);
  const [chapterTitle, setChapterTitle] = useState("");
  // Global, cross-book preference (see readerPreferences.ts) - initialized
  // once from localStorage so the very first render already reflects
  // whatever the reader last chose, rather than flashing the old 112%/serif
  // default and then snapping to it.
  const [fontPercent, setFontPercent] = useState(() => getReaderPreferences().fontPercent);
  const [fontFamily, setFontFamily] = useState<FontFamilyId>(() => getReaderPreferences().fontFamily);
  const [toc, setToc] = useState<NavItem[]>([]);
  const [popover, setPopover] = useState<PopoverState | null>(null);

  const clearPopover = useCallback(() => setPopover(null), []);

  // Every page-turn trigger routes through these instead of calling
  // renditionRef directly - without dismissing the popover first, turning
  // the page leaves it floating at its old screen position, now overlaid on
  // unrelated new-page content, until the user happens to tap inside the
  // content area (the only place that was wired to dismiss it before).
  const goToPrevPage = useCallback(() => {
    clearPopover();
    renditionRef.current?.prev();
  }, [clearPopover]);

  const goToNextPage = useCallback(() => {
    clearPopover();
    renditionRef.current?.next();
  }, [clearPopover]);

  // Tapping an EXISTING highlight's own rendered mark - epub.js attaches this
  // directly to the mark's SVG element (click + touchstart), so it's a
  // completely separate path from "capture a new selection" below: no
  // window.getSelection() involved at all, hence no OS-menu risk to worry
  // about, and no geometric hit-testing needed either - the mark IS the hit target.
  function makeHighlightClickHandler(id: string) {
    return (event: Event) => {
      const record = highlightRecords.current.get(id);
      if (!record) return;
      const target = event.currentTarget as HTMLElement | null;
      const rect = target?.getBoundingClientRect();
      setPopover({
        kind: "highlight",
        record,
        anchor: rect ? anchorFromRect(rect) : { x: 0, y: 0, placement: "below" },
      });
    };
  }

  function applyUnderline(rendition: Rendition, record: HighlightRecord) {
    // Ahead of the already-drawn guard: re-applying a record that gained a
    // note is exactly how the map gets refreshed.
    highlightRecords.current.set(record.id, record);
    if (appliedHighlightIds.current.has(record.id)) return;
    appliedHighlightIds.current.add(record.id);
    rendition.annotations.underline(
      record.position,
      {},
      makeHighlightClickHandler(record.id),
      EPUB_HIGHLIGHT_CLASS,
      EPUB_HIGHLIGHT_STYLES,
    );
  }

  useEffect(() => {
    let cancelled = false;

    async function setup() {
      const [file, meta] = await Promise.all([getBookFile(bookId), getBookMeta(bookId)]);
      if (cancelled) return;
      if (!file || !containerRef.current) {
        setErrorMessage("This book is missing from your library - it may have been removed.");
        setLoadState("error");
        return;
      }

      try {
        const ePub = (await import("epubjs")).default;
        const buffer = await file.arrayBuffer();
        if (cancelled) return;

        const book = ePub(buffer);
        bookRef.current = book;

        const rendition = book.renderTo(containerRef.current, {
          width: "100%",
          height: "100%",
          flow: scrollMode === "scrolling" ? "scrolled-doc" : "paginated",
          spread: "none",
          allowScriptedContent: false,
        });
        renditionRef.current = rendition;

        registerObsidianTheme(rendition);
        rendition.themes.fontSize(`${fontPercent}%`);
        rendition.themes.font(FONT_FAMILY_CSS[fontFamily]);

        rendition.on("relocated", (location: { start: { cfi: string; percentage: number; href: string } }) => {
          setProgress(location.start.percentage);
          void updateReadingPosition(bookId, location.start.cfi, location.start.percentage);

          const match = tocRef.current.find((item) => item.href.split("#")[0] === location.start.href.split("#")[0]);
          if (match) setChapterTitle(match.label.trim());
        });

        rendition.on("selected", async (cfiRange: string, contents: Contents) => {
          // Trigger the definition popup instantly upon text selection,
          // rather than waiting for touchend.
          
          const domSelection = contents.window.getSelection();
          if (!domSelection || domSelection.rangeCount === 0 || domSelection.isCollapsed) return;

          const range = domSelection.getRangeAt(0);
          const rect = range.getBoundingClientRect();
          const frameEl = contents.window.frameElement as HTMLElement | null;
          const frameRect = frameEl?.getBoundingClientRect();

          const phrase = (await book.getRange(cfiRange)).toString().trim();
          if (!phrase) return;

          setPopover({
            kind: "selection",
            data: {
              phrase,
              context: getBlockContext(range),
              anchor: anchorFromRect(rect, frameRect?.left ?? 0, frameRect?.top ?? 0),
              // epub.js already computed this CFI range for us to reach this
              // handler at all - no need to re-derive it from the Range.
              rawPosition: cfiRange,
            },
          });
        });

        // A tap/click starting fresh anywhere in the chapter (that isn't
        // itself the start of a new selection) dismisses whatever popover is
        // already open - epub.js has no "unselected" event of its own.
        rendition.on("rendered", (_section: unknown, contents: Contents) => {
          ensureReaderFontsLoaded(contents.document);

          if (wiredDocuments.current.has(contents.document)) return;
          wiredDocuments.current.add(contents.document);

          contents.document.addEventListener("touchstart", clearPopover);
          // Desktop only - browsers replay a SYNTHETIC "mousedown" right
          // after a real mouseup/click (for legacy mouse-oriented code),
          // which would otherwise immediately wipe out a selection the
          // "selected" listener above just captured, a moment before it ever
          // renders. touchstart above already covers "clear on new touch
          // interaction" for the long-press path.
          if (!isCoarsePointer()) {
            contents.document.addEventListener("mousedown", clearPopover);
          }

          if (isCoarsePointer()) {
            ensureNoNativeSelection(contents.document);

            const frameEl = contents.window.frameElement as HTMLElement | null;
            const frameRect = frameEl?.getBoundingClientRect();

            // Paginated flow only - scrolled-doc has no page to turn, and
            // native scrolling owns the gesture there.
            if (scrollMode === "paginated") {
              attachTapToTurn(contents.document, frameEl, goToPrevPage, goToNextPage);
            }

            attachLongPressToDefine({
              target: contents.document,
              doc: contents.document,
              derivePosition: (range) => (contents as unknown as { contents: Contents }).contents.cfiFromRange(range),
              onLongPress: (data) => {
                import("@capacitor/haptics").then(({ Haptics, ImpactStyle }) => {
                  Haptics.impact({ style: ImpactStyle.Medium }).catch(() => {});
                });
                setPopover({ kind: "selection", data });
              },
              offsetLeft: frameRect?.left ?? 0,
              offsetTop: frameRect?.top ?? 0,
            });
          }
        });

        await rendition.display(meta?.lastPosition ?? undefined);
        await book.ready;
        if (cancelled) return;

        const navigation = await book.loaded.navigation;
        tocRef.current = flattenToc(navigation.toc);
        setToc(tocRef.current);
        const current = rendition.currentLocation() as unknown as { start: { href: string } } | undefined;
        if (current?.start?.href) {
          const match = tocRef.current.find((item) => item.href.split("#")[0] === current.start.href.split("#")[0]);
          if (match) setChapterTitle(match.label.trim());
        }

        setLoadState("ready");

        // rendition.annotations.underline() only paints for the CURRENT
        // rendition instance - it doesn't persist anything on its own, and
        // has to be re-applied once per fresh Book/Rendition (i.e. every
        // time the book is reopened). Once applied, epub.js's Annotations
        // manager keeps it visible as the user navigates within this session.
        listHighlights(bookId).then((records) => {
          if (cancelled) return;
          for (const record of records) applyUnderline(rendition, record);
        });

        // book.locations.percentageFromLocation() (which "relocated" reads
        // via location.start.percentage) is hard-coded to 0 until locations
        // have been generated at least once - generate them in the
        // background so the very first page isn't blocked on it, then
        // backfill the progress bar for wherever the reader already landed.
        book.locations.generate(1600).then(() => {
          if (cancelled) return;
          const location = rendition.currentLocation() as unknown as { start: { percentage: number } } | undefined;
          if (location) setProgress(location.start.percentage);
        });
      } catch (err) {
        console.error("Failed to open EPUB", err);
        if (!cancelled) {
          setErrorMessage("Couldn't open that book - the file may be corrupted.");
          setLoadState("error");
        }
      }
    }

    setup();

    return () => {
      cancelled = true;
      try {
        renditionRef.current?.destroy();
        bookRef.current?.destroy();
      } catch {
        // Best-effort teardown - nothing user-facing depends on it succeeding.
      }
      renditionRef.current = null;
      bookRef.current = null;
    };
    // Only ever re-run for a genuinely different book.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId, clearPopover]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "ArrowRight") goToNextPage();
      if (e.key === "ArrowLeft") goToPrevPage();
      if (e.key === "Escape") {
        if (popover) clearPopover();
        else onExit();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [popover, clearPopover, onExit, goToNextPage, goToPrevPage]);

  function adjustFont(next: number) {
    setFontPercent(next);
    renditionRef.current?.themes.fontSize(`${next}%`);
    setReaderPreferences({ fontPercent: next });
  }

  function adjustFontFamily(next: FontFamilyId) {
    setFontFamily(next);
    renditionRef.current?.themes.font(FONT_FAMILY_CSS[next]);
    setReaderPreferences({ fontFamily: next });
  }

  function adjustScrollMode(next: EpubScrollMode) {
    if (next === scrollMode) return;
    setReaderPreferences({ epubScrollMode: next });
    onScrollModeChange?.();
  }

  function goToChapter(href: string) {
    void renditionRef.current?.display(href);
  }

  async function handleHighlight() {
    if (popover?.kind !== "selection") return;
    const record = await addHighlight(bookId, popover.data.phrase, popover.data.rawPosition);
    if (renditionRef.current) applyUnderline(renditionRef.current, record);
  }

  async function handleRemoveHighlight() {
    if (popover?.kind !== "highlight") return;
    await deleteHighlight(popover.record.id);
    renditionRef.current?.annotations.remove(popover.record.position, "underline");
    appliedHighlightIds.current.delete(popover.record.id);
    highlightRecords.current.delete(popover.record.id);
  }

  /** A note is stored ON a highlight - that underline is the only way back to
   * it once the popover closes. So a note saved straight from a fresh
   * selection (the usual case: long-press, Define, Save as Note) creates the
   * highlight it hangs off, rather than having nowhere to be written and
   * silently going nowhere. */
  async function handleSaveNote(note: string) {
    let target = popover?.kind === "highlight" ? popover.record : undefined;
    if (!target) {
      if (popover?.kind !== "selection") return;
      target = await addHighlight(bookId, popover.data.phrase, popover.data.rawPosition);
      if (renditionRef.current) applyUnderline(renditionRef.current, target);
    }
    const updated = await updateHighlightNote(target.id, note);
    if (!updated) return;
    highlightRecords.current.set(updated.id, updated);
    // Keeps the CURRENTLY OPEN popover's record in sync (e.g. if it's
    // reopened for editing again in this same session) - epub.js's own
    // underline rendering is unaffected, since notes are pure metadata with
    // no visual representation on the page itself.
    if (popover?.kind === "highlight") {
      setPopover({ kind: "highlight", record: updated, anchor: popover.anchor });
    }
  }

  if (loadState === "error") {
    return <ReaderErrorState message={errorMessage} onExit={onExit} />;
  }

  // Keyed by the selection/highlight's own identity (not just "is a popover
  // open") so React remounts DefinitionPopover - and its internal stage
  // machine - on every new lookup instead of reusing the same instance.
  // Without this, tapping a second word while the first's /api/define
  // request is still in flight lets that stale response land under the new
  // word's header once it resolves.
  const popoverProps =
    popover?.kind === "selection"
      ? {
          key: `sel:${popover.data.rawPosition}`,
          phrase: popover.data.phrase,
          context: popover.data.context,
          anchor: popover.data.anchor,
          note: undefined,
        }
      : popover?.kind === "highlight"
        ? {
            key: `hl:${popover.record.id}`,
            phrase: popover.record.phrase,
            context: popover.record.phrase,
            anchor: popover.anchor,
            note: popover.record.note,
          }
        : null;

  return (
    <ReaderChrome
      onExit={onExit}
      title={chapterTitle}
      progress={progress}
      loading={loadState === "loading"}
      controls={
        <>
          {scrollMode === "paginated" && (
            <div className="flex items-center gap-0.5 rounded-full border border-border bg-foreground/5 p-0.5">
              <button
                type="button"
                aria-label="Previous page"
                onClick={goToPrevPage}
                className="flex h-7 w-7 items-center justify-center rounded-full text-foreground transition-colors hover:bg-foreground/10 active:scale-90"
              >
                <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5" aria-hidden="true">
                  <path d="M15 5l-7 7 7 7" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              <button
                type="button"
                aria-label="Next page"
                onClick={goToNextPage}
                className="flex h-7 w-7 items-center justify-center rounded-full text-foreground transition-colors hover:bg-foreground/10 active:scale-90"
              >
                <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5" aria-hidden="true">
                  <path d="M9 5l7 7-7 7" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </div>
          )}
          <ChaptersMenu toc={toc} onSelect={goToChapter} />
          <DisplaySettingsMenu
            typography={{
              fontPercent,
              onFontPercentChange: adjustFont,
              fontMin: FONT_PERCENT_MIN,
              fontMax: FONT_PERCENT_MAX,
              fontStep: FONT_PERCENT_STEP,
              fontFamily,
              onFontFamilyChange: adjustFontFamily,
            }}
            layout={{ mode: scrollMode, onModeChange: adjustScrollMode }}
          />
        </>
      }
    >
      {/* Click-to-turn bands for mouse-driven devices - narrow, and inset from
          the top and bottom so a stray click near either edge of the content
          pane can't accidentally flip a page. globals.css drops them entirely
          under (pointer: coarse): stacked on top of the chapter iframe they
          swallowed long-press-to-define across the outer 15% of every page,
          since a touch on an overlay never reaches the iframe document that
          selection.ts is listening to. Touch gets the same zones from
          attachTapToTurn instead, inside that document. Only meaningful in
          paginated flow - scrolled-doc has no "page" to turn. */}
      {scrollMode === "paginated" && (
        <>
          <button
            type="button"
            aria-label="Previous page"
            onClick={goToPrevPage}
            className="reader-page-turn absolute inset-y-[15%] left-0 z-10 w-[15%] cursor-w-resize"
          />
          <button
            type="button"
            aria-label="Next page"
            onClick={goToNextPage}
            className="reader-page-turn absolute inset-y-[15%] right-0 z-10 w-[15%] cursor-e-resize"
          />
        </>
      )}

      <div ref={containerRef} className="h-full w-full px-2" />

      {popover?.kind === "selection" && popover.data.rects && <SelectionHighlight rects={popover.data.rects} />}
      {popoverProps && (
        <DefinitionPopover
          key={popoverProps.key}
          phrase={popoverProps.phrase}
          context={popoverProps.context}
          anchor={popoverProps.anchor}
          note={popoverProps.note}
          onClose={clearPopover}
          onHighlight={handleHighlight}
          onRemoveHighlight={handleRemoveHighlight}
          onSaveNote={handleSaveNote}
          isHighlighted={popover?.kind === "highlight"}
        />
      )}
    </ReaderChrome>
  );
}
