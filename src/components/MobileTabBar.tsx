"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import UploadSheet from "@/components/UploadSheet";
import { FOCUS, GLASS_CONTROL, PRESS, TAP, TRANSITION } from "@/lib/spatial";
import { vibrateTap } from "@/lib/haptics";

/** The app's primary navigation: three destinations and one action.
 *
 * WHY FIVE. This bar has been six (Home, Library, Ingest, Reader, Mindmap, Account) and
 * then three (Home, Library, Account), then four. It is five now, and the changes are worth
 * because none of them was a style call:
 *
 *   Ingest and Reader came BACK. They were dropped when the product narrowed to a reader,
 *   on the argument that Ingest belonged to the flashcard pipeline and that Reader was only
 *   ever reached from somewhere else. Both are first-class destinations again.
 *
 *   Mindmap stays out. It is a view over a DECK's concepts and the shell does not surface
 *   decks; the route still exists and still works, it is simply not offered here.
 *
 *   ACCOUNT IS BACK AS A TAB, and the avatar that stood in for it in ReaderHome's header
 *   was deleted in the same change. Navbar returns null on native, so while this bar was at
 *   four tabs the Account route had no entry point at all inside the APK, and that header
 *   control existed only to keep it reachable. With the tab restored it became a second
 *   door to one room, which is worse than either door alone.
 *
 * ONE HONEST WART, stated rather than discovered later: tapping Reader navigates to a route
 * this bar hides itself on, so the bar vanishes on arrival. That is deliberate (the reader
 * is full-bleed and draws its own back control) but it does mean the Reader tab is the one
 * tab you cannot tab away from. It was the same before this bar ever narrowed.
 *
 * THIS FILE MOUNTS NO ANIMATION RUNTIME. It used to import motion/react for two things: a
 * `layoutId` pill that slid between tabs on a spring, and a per-tap ripple. Both were JS
 * driving frames for feedback the compositor can give away - the pill is now a CSS
 * background transition on the active link, and the ripple is gone (a Material tell on a
 * bar that is trying not to look like anything else). The only motion left in the shell is
 * the upload sheet's drag. See the performance note at the head of src/lib/spatial.ts.
 *
 * THE FAB SITS AT THE PILL'S RIGHT END, ABOVE IT, AND IT USED TO BE CENTRED.
 *
 * It has never straddled the pill, and that part has not changed: an early build docked it
 * the classic way and the emulator killed it in one screenshot - at three tabs the centre of
 * the bar IS a tab, so the FAB landed squarely on Library's icon and left only its label
 * showing. At five tabs the centre is a tab again. Clearing the pill entirely is the only
 * arrangement where every tab keeps its whole 44px hit area at every tab count.
 *
 * WHAT CHANGED IS LEFT-TO-RIGHT, AND THE REASON IS THE 76dp IT WAS COSTING EVERY SCREEN.
 * `pt-[4.75rem]` on the nav is the FAB's `h-16` plus a 12px gap, and while the FAB was
 * centred that whole band had to be reserved as empty space - because content scrolling
 * beneath a centred control is blocked in the MIDDLE of every row that passes it. Measured
 * on a 1080x2400 device, the page ended at y=1473: 61% of the display, and 267 of the
 * missing pixels were this band.
 *
 * Reserving it was tried away once with the FAB still centred, and the FAB immediately came
 * to rest on top of the "10m" session-length chip. At the right end it clips where rows END
 * instead of where they read, which is why every Material app puts it in a corner and lets
 * content pass under. The spacer now reserves the pill alone (--tabbar-pill).
 *
 * THE RESIDUAL, STATED RATHER THAN DISCOVERED LATER: a floating FAB still passes over
 * content mid-scroll. At the right edge that is the end of a line of prose or the last chip
 * in a row, and the FAB's own `backdrop-blur-2xl` frosts whatever is behind it rather than
 * hiding it. If a screen ever puts something load-bearing hard against the right margin at
 * the bottom, this is the thing that will cover it.
 *
 * The nav is `pointer-events-none` with `auto` on the pill and the FAB, which is now
 * load-bearing rather than tidy: that 76dp band sits over live content, and a fixed,
 * full-width, invisible strip that ate every tap in it would be a dead ribbon across the
 * page.
 */

type Tab = {
  href: string;
  label: string;
  Icon: (props: { className?: string }) => React.ReactElement;
};

function HomeIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="M3 10.75 12 4l9 6.75" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5.5 9.5V19a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V9.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// Stacked spines seen end-on - a mixed stack of EPUBs, PDFs and pasted notes, not a single
// open volume.
function LibraryIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <rect x="3.75" y="9.75" width="16.5" height="10.5" rx="2.25" stroke="currentColor" strokeWidth="1.8" />
      <path d="M6.25 6.75h11.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M8.25 3.75h7.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

// An upward arrow out of a tray: material going IN. Distinct at 21px from the FAB's plus,
// which is the same intent at a different scale - the tab is where you manage what you have
// brought in, the FAB is the one-tap way to bring in more.
function IngestIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="M12 15V4" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
      <path d="m8 7.5 4-4 4 4" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4.5 14v4.5a1 1 0 0 0 1 1h13a1 1 0 0 0 1-1V14" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// An open book. It can be a book again now that Library is stacked spines rather than a
// single volume - the two read as different objects at 21px, which is the whole job of a
// tab glyph.
function ReaderIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="M12 6.5c-1.6-1.2-3.7-1.8-5.8-1.8-.7 0-1.2.5-1.2 1.2v11.6c0 .7.5 1.2 1.2 1.2 2.1 0 4.2.6 5.8 1.8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12 6.5c1.6-1.2 3.7-1.8 5.8-1.8.7 0 1.2.5 1.2 1.2v11.6c0 .7-.5 1.2-1.2 1.2-2.1 0-4.2.6-5.8 1.8V6.5Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function AccountIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <circle cx="12" cy="8.5" r="3.25" stroke="currentColor" strokeWidth="1.9" />
      <path d="M4.5 19.5c1.4-3.4 4.3-5.2 7.5-5.2s6.1 1.8 7.5 5.2" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  );
}

function PlusIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

const TABS: Tab[] = [
  { href: "/", label: "Home", Icon: HomeIcon },
  { href: "/library", label: "Library", Icon: LibraryIcon },
  { href: "/ingest", label: "Ingest", Icon: IngestIcon },
  { href: "/reader", label: "Reader", Icon: ReaderIcon },
  { href: "/account", label: "Account", Icon: AccountIcon },
];

// FIVE TABS FIT BECAUSE NOTHING HERE CARRIES A MINIMUM WIDTH. Each TabLink is
// `flex-1 basis-0`, so five equal shares of a 390dp screen give ~72px apiece and the
// longest label ("Account", 7 characters at 10px) needs about 46. The six-tab version this
// bar once had used fixed 76px-min-width pills, needed ~410px, and shoved its outer tabs
// off every real phone - which is how "Account" came to look dead in the first place.

function TabLink({ href, label, Icon, active }: Tab & { active: boolean }) {
  return (
    <Link
      href={href}
      onClick={vibrateTap}
      aria-current={active ? "page" : undefined}
      className={`relative flex min-h-[44px] flex-1 basis-0 flex-col items-center justify-center gap-1 rounded-full px-1 py-2 ${TAP} ${FOCUS} ${
        active ? "bg-white/10" : "bg-transparent"
      }`}
    >
      <Icon className={`h-[21px] w-[21px] ${TRANSITION} ${active ? "text-white" : "text-white/40"}`} />
      <span
        className={`truncate text-[10px] font-medium leading-none ${TRANSITION} ${
          active ? "text-white" : "text-white/40"
        }`}
      >
        {label}
      </span>
    </Link>
  );
}

export default function MobileTabBar() {
  const pathname = usePathname();
  const router = useRouter();
  const navRef = useRef<HTMLElement>(null);
  const pillRef = useRef<HTMLDivElement>(null);
  const [adding, setAdding] = useState(false);

  // TWO MEASUREMENTS, BECAUSE "how tall is the bar" AND "how much must content clear"
  // ARE DIFFERENT QUESTIONS, AND CONFLATING THEM COST 40% OF THE SCREEN.
  //
  // --tabbar-h is the whole bar: FAB zone + gap + pill + safe area. DeckUndoBar sits on
  // top of it and two other screens pad against it, so its meaning is fixed and this
  // change does not touch it.
  //
  // TWO MEASUREMENTS, BECAUSE "how tall is the bar" AND "how much must content clear" stopped
  // being the same question when the FAB moved to the corner.
  //
  // --tabbar-h is the whole bar including the FAB's zone. DeckUndoBar positions off it and
  // two other screens pad against it, so its meaning is unchanged.
  //
  // --tabbar-pill is the pill alone, and it is what the spacer reserves.
  useEffect(() => {
    const nav = navRef.current;
    const pill = pillRef.current;
    if (!nav || !pill) return;
    const root = document.documentElement;
    const publish = () => {
      root.style.setProperty("--tabbar-h", `${nav.offsetHeight}px`);
      root.style.setProperty("--tabbar-pill", `${pill.offsetHeight}px`);
    };
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(nav);
    observer.observe(pill);
    return () => observer.disconnect();
  }, []);

  // The reader and the study feed are full-bleed and immersive - no chrome.
  if (pathname?.startsWith("/study") || pathname?.startsWith("/reader")) return null;

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname === href || (pathname?.startsWith(href + "/") ?? false);

  return (
    <>
      {/* In-flow spacer so scrollable content clears the floating bar. It shares this
          component's render conditions, so it vanishes on /reader, /study and at sm:+.

          IT RESERVES THE PILL, AND IT COUNTS THE SAFE AREA ONCE.

          Two bugs lived in one line. It used to read
          `var(--tabbar-h) + env(safe-area-inset-bottom) + 1rem`, and --tabbar-h is the
          nav's offsetHeight - which ALREADY contains the nav's own
          `paddingBottom: calc(env(safe-area-inset-bottom) + 1rem)`, so both were counted
          twice. And --tabbar-h includes the FAB's 4.75rem zone, which was held empty on
          every screen for a control that floats.

          Measured on a 1080x2400 device: page content stopped at y=1473 - 61% of the
          display. Reserving the pill alone takes it to y=1740. The FAB's zone was 267 of
          those pixels and the double count was the rest.

          RESERVING THE PILL ONLY IS SAFE **BECAUSE THE FAB MOVED TO THE CORNER**. It was
          tried once while the FAB was still centred and the FAB came to rest exactly on
          top of the "10m" session-length chip. A floating control that content passes
          beneath has to sit where rows end, not where they read. */}
      <div
        aria-hidden="true"
        className="sm:hidden"
        style={{ height: "calc(var(--tabbar-pill, 4rem) + env(safe-area-inset-bottom) + 1.5rem)" }}
      />

      <nav
        ref={navRef}
        aria-label="Primary"
        // `pointer-events-none` HERE AND `auto` ON THE PILL BELOW, AND IT IS LOAD-BEARING NOW.
        // `pt-[4.75rem]` makes this fixed element 76dp taller than the pill so the FAB's
        // zone is inside its box and gets measured. That band used to sit over reserved
        // empty space and swallowing taps in it cost nothing. Content scrolls under it
        // now, so a full-width invisible strip that ate every tap would be a real bug -
        // the page would have a dead ribbon across it just above the bar.
        className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex justify-center px-3 pt-[4.75rem] sm:hidden"
        // NO PALETTE SPREAD HERE ANY MORE, and that is the point of src/lib/spatial.ts.
        // This bar is a SIBLING of <main> in layout.tsx, so it never inherited the scoped
        // custom properties the screens declared - which made `oklch(var(--nk-gold))` an
        // INVALID colour rather than a wrong one, so the FAB computed to `rgba(0,0,0,0)`
        // and rendered as nothing at all. Literal Tailwind utilities cannot fail that way.
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 1rem)" }}
      >
        <div
          ref={pillRef}
          className="pointer-events-auto relative flex w-full max-w-[420px] items-center gap-0.5 rounded-full border border-white/10 bg-white/5 px-1.5 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.09)] backdrop-blur-2xl"
        >
          {TABS.map((tab) => (
            <TabLink key={tab.href} {...tab} active={isActive(tab.href)} />
          ))}

          {/* THE FAB, AS A FLOATING PANE. It has been a solid white disc, white glass, and
              gold; this is glass again, and what makes it work this time is that it is no
              longer alone. When the rest of the screen was flat black, a 10% pane was the
              only glass on it and read as a grey circle someone forgot to fill. Sitting
              above a bar, a card and a widget cut from the same two recipes, it reads as
              the nearest pane in a stack - which is the whole spatial idea, and is carried
              by its 10/20 fill-and-edge against their 5/10 rather than by a colour. */}
          <button
            type="button"
            onClick={() => {
              vibrateTap();
              setAdding(true);
            }}
            aria-label="Upload document"
            className={`pointer-events-auto absolute -top-[4.75rem] right-0 flex h-16 w-16 items-center justify-center rounded-full text-white shadow-[0_12px_36px_-8px_rgba(0,0,0,0.9)] ${GLASS_CONTROL} ${PRESS} ${FOCUS}`}
          >
            <PlusIcon className="h-7 w-7" />
          </button>
        </div>
      </nav>

      <UploadSheet
        open={adding}
        onClose={() => setAdding(false)}
        onImported={(book) => {
          setAdding(false);
          router.push(`/reader?book=${book.id}`);
        }}
      />
    </>
  );
}
