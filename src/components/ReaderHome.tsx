"use client";

import { useRouter } from "next/navigation";
import BookCover from "@/components/BookCover";
import ContinueReading from "@/components/ContinueReading";
import DailyInsight from "@/components/DailyInsight";
import GlowField from "@/components/GlowField";
import PowerMove from "@/components/PowerMove";
import LogoMark from "@/components/LogoMark";
import { EYEBROW, FOCUS, GLASS_STATIC, TAP, TEXT_BODY, TEXT_FAINT, WORDMARK } from "@/lib/spatial";
import { useBooks } from "@/lib/readerStorage";
import { vibrateTap } from "@/lib/haptics";
import type { BookMeta } from "@/lib/types";

/** The app's home screen: something true, then the document you were in the middle of.
 *
 * ---------------------------------------------------------------------------
 * WHAT SITS AT THE TOP, AND WHY IT IS NOT A SLOGAN
 * ---------------------------------------------------------------------------
 * The previous revision opened with the product's claim - "Study like it counts. Because
 * it does." - set enormous in a hairline display face. It looked expensive and it was
 * advertising: a sentence a student read on day one and then scrolled past every day
 * after, because a claim does not become more true the four-hundredth time you are shown
 * it.
 *
 * The Daily Insight widget is the same slot spent on something that changes. It is one
 * checkable fact about memory, rotated per visit out of the twenty-four this repo already
 * maintains in src/lib/brainFacts.ts - which means the first thing on screen is worth
 * reading twice a week instead of once ever, and it is the product's actual subject rather
 * than its pitch.
 *
 * ---------------------------------------------------------------------------
 * ONE MATERIAL
 * ---------------------------------------------------------------------------
 * There is no accent colour anywhere in this shell. Every surface is the same frosted pane
 * at one of two thicknesses (src/lib/spatial.ts), and hierarchy is how much light a pane
 * holds: 5% for things that hold content, 10% for things you press. On a screen with no
 * hue to spend, that ratio is the only signal available, so it is kept unambiguous.
 *
 * THE WORDMARK IS GEIST, NOT PACIFICO. The cursive script survives on the marketing page
 * and in the desktop Navbar, where a signature mark is doing a different job for a
 * different audience. Inside the app it was the one element arguing a personality the rest
 * of the screen had spent its whole budget not having.
 *
 * ZERO MOTION COMPONENTS. Entrances are the `.au-rise` CSS keyframe in globals.css, taps
 * are `active:scale`. The only file in the shell that imports motion/react is UploadSheet,
 * for its drag gesture.
 *
 * EVERYTHING BELOW THE WIDGET IS REAL. `useBooks()` reads IndexedDB through readerStorage,
 * whose `listBooks()` sorts by `lastOpenedAt ?? addedAt` descending - so `books[0]` is
 * literally the most recently opened document and every percentage is the fraction the
 * reader wrote on the last page turn.
 */

/** The rail under the card: the next few documents, most recent first. A rail rather than a
 * grid, capped at four - a grid here would be the Library tab rendered twice. */
function RecentRail({ books, onOpen }: { books: BookMeta[]; onOpen: (id: string) => void }) {
  return (
    <section
      aria-label="Recently opened"
      className="au-rise mt-8"
      style={{ animationDelay: "240ms" }}
    >
      <h2 className={`px-1 ${EYEBROW}`}>Also open</h2>
      {/* -mx-5 + px-5 lets the rail bleed to the screen edge while its first card still
          lines up with the card above it - a rail that stops at the page gutter reads as a
          clipped grid rather than as something that continues. */}
      <div className="no-scrollbar -mx-5 mt-3 flex gap-3 overflow-x-auto overscroll-x-contain px-5 pb-1">
        {books.map((book) => {
          const percent = Math.round(book.progress * 100);
          return (
            <button
              key={book.id}
              type="button"
              onClick={() => {
                vibrateTap();
                onOpen(book.id);
              }}
              className={`w-[104px] shrink-0 text-left ${TAP} ${FOCUS}`}
            >
              <div className={`relative aspect-[2/3] w-full overflow-hidden rounded-xl ${GLASS_STATIC}`}>
                <BookCover book={book} />
                {book.progress > 0 && (
                  <div className="absolute inset-x-0 bottom-0 h-[3px] bg-black/50">
                    <div className="h-full bg-white" style={{ width: `${percent}%` }} />
                  </div>
                )}
              </div>
              <p className={`mt-2 line-clamp-2 text-[12px] leading-tight ${TEXT_BODY}`}>
                {book.title}
              </p>
            </button>
          );
        })}
      </div>
    </section>
  );
}

export default function ReaderHome() {
  const router = useRouter();
  const { books, loading } = useBooks();

  const current = books[0] ?? null;
  const rest = books.slice(1, 5);
  const inProgress = books.filter((b) => b.progress > 0 && b.progress < 1).length;

  function openBook(id: string) {
    router.push(`/reader?book=${id}`);
  }

  return (
    <main
      // `isolate` keeps GlowField's -z-10 layer inside this screen's own stacking context,
      // so it can never paint behind the tab bar or over another route mid-transition.
      className="relative isolate flex min-h-0 w-full flex-1 flex-col bg-black px-5 pt-[max(1.25rem,env(safe-area-inset-top))]"
    >
      <GlowField />

      {/* AN ACCOUNT AVATAR USED TO SIT AT THE RIGHT OF THIS HEADER. It is gone because
          MobileTabBar carries an Account tab again - it only ever existed to keep that route
          reachable while the bar was down to four tabs, and two doors to one room is worse
          than either. */}
      <header className="au-rise flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className="flex h-7 w-7 items-center justify-center overflow-hidden rounded-[28%] border border-white/10 bg-white/10 text-white">
            <LogoMark sheen className="h-[64%] w-[64%]" />
          </span>
          <span className={WORDMARK}>FlowRecall</span>
        </div>
        <div className="flex items-center gap-3">
          {!loading && books.length > 0 && (
            <p className={`font-mono text-[11px] tabular-nums ${TEXT_FAINT}`}>
              {books.length} {books.length === 1 ? "document" : "documents"}
              {inProgress > 0 && ` · ${inProgress} open`}
            </p>
          )}
        </div>
      </header>

      {/* ------------------------- THE DAILY INSIGHT ------------------------ */}
      <div className="au-rise mt-8" style={{ animationDelay: "60ms" }}>
        <DailyInsight />
      </div>

      {/* --------------------------- THE INSTRUMENT ------------------------ */}
      {/* 24px between every pane, 32px from the header to the first one. A uniform gap
          would read as a list; the larger step at the top is what separates chrome from
          content and lets the three panes below it group as one stack. */}
      <div className="au-rise mt-6" style={{ animationDelay: "120ms" }}>
        {loading ? (
          // Reserved shape rather than a spinner: IndexedDB resolves in milliseconds, and a
          // spinner would flash and be gone - the classic way to make a fast screen look
          // busy. Holding the card's real height also means nothing jumps when data lands.
          <div className="h-[268px] rounded-[28px] border border-white/10 bg-white/[0.03]" />
        ) : (
          <ContinueReading book={current} onResume={openBook} />
        )}
      </div>

      {/* --------------------------- THE POWER MOVE ------------------------ */}
      {/* BELOW THE CONTINUE CARD, NOT ABOVE IT, AND THAT ORDER IS MEASURED. The brief
          offered "below the Neuroscience fact or near the empty state"; putting it directly
          under the fact stacks two education widgets ahead of the instrument and pushes
          Resume off the fold on a 390x844 phone - header 44 + insight 130 + power move 130
          + card 268 overruns it before the tab bar's reserve is counted. Here it is still
          below the fact, it is still immediately beside the empty state when the library is
          empty (which is the state it exists for), and the primary action stays reachable
          without a scroll.

          `href` is the caller's decision, not the widget's: into the open document if there
          is one, otherwise to the reader's shelf and dropzone - where "try it" is honestly
          an invitation to add something, since the gesture needs a document to try. */}
      <div className="au-rise mt-6" style={{ animationDelay: "180ms" }}>
        <PowerMove href={current ? `/reader?book=${current.id}` : "/reader"} />
      </div>

      {rest.length > 0 && <RecentRail books={rest} onOpen={openBook} />}

      {/* Bottom breathing room. MobileTabBar publishes its real measured height as
          --tabbar-h and renders its own in-flow spacer, so this is only the gap between the
          last card and that spacer, not a second reservation for the bar. */}
      <div aria-hidden="true" className="h-8" />
    </main>
  );
}
