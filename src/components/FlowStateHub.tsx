"use client";

import { useEffect, useRef, useState, startTransition } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import {
  motion,
  useMotionValue,
  useSpring,
  useReducedMotion,
} from "motion/react";
import { apiUrl, API_FETCH_CREDENTIALS } from "@/lib/apiUrl";
import { readSessionInputs } from "@/lib/recallStorage";
import { buildSession } from "@/lib/sessionBuilder";
import { setStudySession, useSavedDecks } from "@/lib/storage";
import { vibrateTap } from "@/lib/haptics";
import { useIsNative } from "@/lib/useIsNative";
import {
  LIQUID_VARS,
  GLASS,
  GLIDE,
  PRESS,
  MAGNET,
  MAGNET_RADIUS,
} from "@/lib/liquidGlass";

/** FlowStateHub — the mobile Home/Action screen.
 *
 * Provenance for every colour, radius and easing value is in src/lib/liquidGlass.ts
 * (Auros, monopo saigon, and Air on styles.refero.design). This file is composition,
 * motion and data.
 *
 * WHAT IS ON SCREEN, and nothing else: the streak, as a numeral and seven marks; the
 * number of cards due; one button. No headline, no subhead, no explanatory paragraph.
 * That is the brief, and it also happens to be monopo's stated rule — "let display type
 * own the viewport, never crowd it with subheads or CTAs".
 *
 * ON `framer-motion`. The brief asks for it by name; the import above is `motion/react`,
 * which IS framer-motion. Framer handed the library to the `motion` package at v11→v12
 * and this repo is on motion@12 — same authors, same API (`motion.div`, `useSpring`,
 * `useMotionValue`), same physics. Adding `framer-motion` to package.json alongside it
 * would ship a second copy of the same animation runtime and split the context that
 * `useReducedMotion` reads from. So: framer-motion's API, under the name this repo
 * already depends on.
 *
 * THE PERFORMANCE CONTRACT IS INTACT, which matters because the brief asks for a lot of
 * motion. StreakCounter.tsx's contract - restated in eleven files - is that animation
 * drives `transform` and `opacity` and nothing else. Every moving thing here obeys it:
 *   - The orbs are pre-painted radial gradients that TRANSLATE and SCALE. Nothing
 *     animates `background-position`, `filter`, or `box-shadow`, which is the usual way
 *     an "animated mesh gradient" gets built and the reason those are usually janky.
 *   - The magnet drives `x`/`y` through springs.
 *   - The press drives `scale`.
 *   - The breathing ring drives `scale` and `opacity`.
 * No `animation-timeline` anywhere: that is Chromium 115+, and the Android WebView floor
 * for this app is 111, where those keyframes can strand an element at opacity:0.
 *
 * REDUCED MOTION is honoured by stopping the drift entirely and rendering the final
 * state, never by running the same distance faster - the house idiom in all nine existing
 * useReducedMotion call sites, stated outright in BrainFactTicker.tsx.
 */

type StreakDay = { label: string; date: string; studied: boolean; isToday: boolean; future: boolean };
type StreakResponse = { currentStreak: number; days: StreakDay[] };

// ---------------------------------------------------------------------------
// ATMOSPHERE
// ---------------------------------------------------------------------------

/** One bioluminescent orb.
 *
 * Built as a radial-gradient div rather than an SVG filter or a canvas: a gradient is
 * painted once and then only its transform changes, which keeps the whole animation on
 * the compositor. `blur-[80px]` is a static filter - it is applied once at paint, never
 * animated, so it costs nothing per frame.
 *
 * `mix-blend-screen` is what makes two overlapping orbs read as LIGHT rather than as two
 * stacked translucent circles: overlapping light adds toward white, which is how
 * bioluminescence actually behaves underwater.
 */
function Orb({
  hue,
  className,
  drift,
  duration,
  reduceMotion,
}: {
  hue: string;
  className: string;
  drift: { x: number[]; y: number[]; scale: number[] };
  duration: number;
  reduceMotion: boolean;
}) {
  return (
    <motion.div
      aria-hidden="true"
      className={`pointer-events-none absolute rounded-full mix-blend-screen blur-[80px] ${className}`}
      style={{
        background: `radial-gradient(circle at 50% 50%, hsl(var(${hue}) / 0.55), transparent 70%)`,
      }}
      animate={reduceMotion ? undefined : { x: drift.x, y: drift.y, scale: drift.scale }}
      transition={
        reduceMotion
          ? undefined
          : { duration, repeat: Infinity, repeatType: "mirror", ease: "easeInOut" }
      }
    />
  );
}

/** The full atmospheric field. Three orbs on deliberately co-prime-ish cycles (26s, 31s,
 * 38s) so the composition never visibly loops - with equal durations the three would
 * realign every cycle and the eye would catch the repeat immediately. */
function Atmosphere({ reduceMotion }: { reduceMotion: boolean }) {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      <Orb
        hue="--lg-biolume"
        className="left-[-30%] top-[-15%] h-[28rem] w-[28rem]"
        drift={{ x: [0, 70, -30, 0], y: [0, 50, 90, 0], scale: [1, 1.15, 0.95, 1] }}
        duration={26}
        reduceMotion={reduceMotion}
      />
      <Orb
        hue="--lg-violet"
        className="right-[-25%] top-[18%] h-[26rem] w-[26rem]"
        drift={{ x: [0, -60, 20, 0], y: [0, 70, -40, 0], scale: [1, 0.9, 1.2, 1] }}
        duration={31}
        reduceMotion={reduceMotion}
      />
      <Orb
        hue="--lg-biolume"
        className="bottom-[-20%] left-[10%] h-[24rem] w-[24rem]"
        drift={{ x: [0, 50, -50, 0], y: [0, -60, 20, 0], scale: [1, 1.1, 0.92, 1] }}
        duration={38}
        reduceMotion={reduceMotion}
      />
      {/* A vignette that pulls the edges back to pure abyss. Without it the orbs run
          into the screen edge and the illusion collapses into "three blurred circles".
          Static, so it costs one paint. */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_75%_60%_at_50%_45%,transparent,hsl(var(--lg-abyss))_100%)]" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// STREAK WIDGET
// ---------------------------------------------------------------------------

/** The streak, as a numeral and seven marks. No label explaining what a streak is.
 *
 * Auros's rule applied literally: the phosphor pink is used for ONE large statistic and
 * nothing else on the screen. Weight 300 at 64px is monopo's "whisper" - their guidance
 * is never to push above 400 at display sizes, and a hairline numeral at this scale reads
 * far more expensive than a bold one. */
function StreakWidget({ data, reduceMotion }: { data: StreakResponse | null; reduceMotion: boolean }) {
  return (
    <motion.div
      initial={reduceMotion ? false : { opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 1, ease: GLIDE, delay: 0.1 }}
      className={`${GLASS} w-full rounded-[28px] px-6 py-5`}
    >
      <div className="flex items-end justify-between">
        <div className="flex items-baseline gap-2.5">
          {/* tabular-nums so 8 → 9 → 10 does not shift the seven marks beside it. */}
          <span className="font-sans text-[4rem] font-light leading-[0.8] tracking-[-0.04em] tabular-nums text-[hsl(var(--lg-phosphor))]">
            {data?.currentStreak ?? 0}
          </span>
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[hsl(var(--lg-slate))]">
            day
            <br />
            streak
          </span>
        </div>

        {/* Seven marks, Monday-first, straight off /api/streak. A filled mark is a day
            studied; today is ringed whether or not it is filled yet; future days are
            barely there. No legend - the shape explains itself. */}
        <div className="flex items-center gap-2">
          {(data?.days ?? Array.from({ length: 7 }, () => null)).map((day, i) => (
            <span key={day?.date ?? i} className="relative flex h-6 w-2.5 items-center justify-center">
              <span
                className={`h-2.5 w-2.5 rounded-full transition-colors duration-500 ${
                  day?.studied
                    ? "bg-[hsl(var(--lg-phosphor))]"
                    : day?.future
                      ? "bg-[hsl(var(--lg-platinum)/0.08)]"
                      : "bg-[hsl(var(--lg-platinum)/0.18)]"
                }`}
              />
              {day?.isToday ? (
                <span className="absolute inset-x-[-3px] inset-y-[5px] rounded-full border border-[hsl(var(--lg-phosphor)/0.55)]" />
              ) : null}
            </span>
          ))}
        </div>
      </div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// THE BUTTON
// ---------------------------------------------------------------------------

/** "Enter Flow State" — magnetic, heavy, spring-driven.
 *
 * THE MAGNET. `onPointerMove` measures the pointer's offset from the button's centre,
 * scales it down and clamps it to MAGNET_RADIUS, and writes it to two motion values that
 * springs read. Because the spring lags the pointer, the button appears to be PULLED
 * rather than dragged - remove the spring and the identical maths reads as a bug.
 *
 * TOUCH. There is no hover on a phone, so on touch the magnet engages on contact and for
 * the length of the drag: press and slide your thumb and the button leans toward it.
 * `onPointerCancel` matters as much as `onPointerUp` - Android fires cancel, not up, when
 * a scroll or a system gesture steals the pointer, and without it the button stays stuck
 * off-centre.
 *
 * `touch-action: none` stops the browser claiming the gesture mid-press; the screen does
 * not scroll, so nothing is lost by it.
 */
function EnterFlowButton({
  onEnter,
  disabled,
  reduceMotion,
}: {
  onEnter: () => void;
  disabled: boolean;
  reduceMotion: boolean;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const x = useSpring(mx, MAGNET);
  const y = useSpring(my, MAGNET);

  function pull(e: React.PointerEvent) {
    if (reduceMotion || disabled) return;
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    // Offset from centre, halved so the button travels less than the finger, then
    // clamped so it can never leave its own hairline.
    const dx = (e.clientX - (r.left + r.width / 2)) * 0.5;
    const dy = (e.clientY - (r.top + r.height / 2)) * 0.5;
    const dist = Math.hypot(dx, dy) || 1;
    const capped = Math.min(dist, MAGNET_RADIUS) / dist;
    mx.set(dx * capped);
    my.set(dy * capped);
  }

  function release() {
    mx.set(0);
    my.set(0);
  }

  return (
    <motion.button
      ref={ref}
      type="button"
      disabled={disabled}
      onPointerMove={pull}
      onPointerLeave={release}
      onPointerUp={release}
      onPointerCancel={release}
      onClick={onEnter}
      style={{ x, y, touchAction: "none" }}
      whileTap={reduceMotion || disabled ? undefined : { scale: 0.96 }}
      transition={PRESS}
      initial={reduceMotion ? false : { opacity: 0, scale: 0.94 }}
      animate={{ opacity: disabled ? 0.45 : 1, scale: 1 }}
      className="group relative flex h-[4.5rem] w-full items-center justify-center rounded-full disabled:cursor-not-allowed"
    >
      {/* THE PANE. Separate from the button element so the breathing ring underneath can
          scale without scaling the label with it. */}
      <span className={`absolute inset-0 rounded-full ${GLASS}`} />

      {/* THE BREATHING RING. One hairline that slowly expands and fades - the screen's
          pulse, and the thing that makes the hub feel alive while idle. transform+opacity
          only. Suppressed under reduced motion and while disabled, because a pulsing
          invitation to start a session you cannot start is just noise. */}
      {!reduceMotion && !disabled ? (
        <motion.span
          aria-hidden="true"
          className="absolute inset-0 rounded-full border border-[hsl(var(--lg-biolume)/0.5)]"
          animate={{ scale: [1, 1.06, 1], opacity: [0.5, 0, 0.5] }}
          transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut" }}
        />
      ) : null}

      {/* The light the button sits in: a bioluminescent wash bound to the pill, brightened
          on press. It is a background, not a box-shadow - which is what keeps it on the
          right side of both the performance contract and all three references' ban on
          elevation. */}
      <span
        aria-hidden="true"
        className="absolute inset-0 rounded-full opacity-70 transition-opacity duration-700 group-active:opacity-100"
        style={{
          background:
            "radial-gradient(120% 140% at 50% 120%, hsl(var(--lg-biolume) / 0.35), transparent 70%)",
        }}
      />

      <span className="relative font-sans text-[15px] font-normal uppercase tracking-[0.28em] text-[hsl(var(--lg-platinum))]">
        Enter flow state
      </span>
    </motion.button>
  );
}

// ---------------------------------------------------------------------------
// THE HUB
// ---------------------------------------------------------------------------

export default function FlowStateHub() {
  const router = useRouter();
  const { data: session } = useSession();
  const reduceMotion = useReducedMotion() ?? false;
  const isNative = useIsNative();
  const decks = useSavedDecks();
  const userId = session?.user?.id;

  const [streak, setStreak] = useState<StreakResponse | null>(null);
  const [dueCount, setDueCount] = useState<number | null>(null);
  const [starting, setStarting] = useState(false);

  // Streak. setState lands in a promise callback rather than the effect body on purpose:
  // `react-hooks/set-state-in-effect` is an ERROR in this repo, and this is the same
  // shape StreakModal.tsx already uses against the same endpoint.
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    fetch(apiUrl(`/api/streak?tzOffset=${new Date().getTimezoneOffset()}`), {
      credentials: API_FETCH_CREDENTIALS,
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (!cancelled && json) setStreak(json as StreakResponse);
      })
      .catch(() => {
        /* The widget renders 0 and seven empty marks. A dead streak endpoint is not
           worth an error state on the screen whose whole job is to start a session. */
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  // What is actually due, through the same scheduler TodaySession uses - so the number on
  // this screen and the number on the introduction can never disagree. The listener is
  // why it stays honest after a session finishes without a remount.
  useEffect(() => {
    if (!userId || decks.length === 0) return;
    let alive = true;
    const read = () => {
      void readSessionInputs(userId, decks)
        .then((inputs) => {
          if (!alive) return;
          setDueCount(buildSession({ ...inputs, budgetMinutes: 20 }).items.length);
        })
        .catch(() => {});
    };
    read();
    window.addEventListener("recall-engine-update", read);
    return () => {
      alive = false;
      window.removeEventListener("recall-engine-update", read);
    };
  }, [userId, decks]);

  const nothingDue = dueCount === 0;

  function handleEnter() {
    if (starting || !userId || decks.length === 0) return;
    vibrateTap();
    setStarting(true);
    void readSessionInputs(userId, decks)
      .then((inputs) => {
        const plan = buildSession({ ...inputs, budgetMinutes: 20 });
        if (plan.items.length === 0) {
          setStarting(false);
          return;
        }
        setStudySession(plan.items);
        startTransition(() => router.push("/study"));
      })
      .catch(() => setStarting(false));
  }

  return (
    <section
      aria-label="Start a session"
      style={LIQUID_VARS}
      // FILLS ITS SLOT, rather than forcing 100dvh. Measured, not guessed: on web this
      // section starts 54px down (the static top Navbar sits above it), so a 100dvh box
      // overflowed the viewport by exactly that much and pushed the button past the fold.
      // `flex-1` + `min-h-0` inside the parent's `flex flex-1 flex-col` gives it whatever
      // height is actually available, on any host.
      //
      // THE BOTTOM GAP IS NATIVE-DEPENDENT, and getting it backwards is a documented trap
      // in this repo (see BrainFactSection in src/app/page.tsx). On native, PageTransition's
      // scroll container is ALREADY sized to exclude the tab-bar zone - MobileTabBar's
      // in-flow spacer carves --tabbar-h out of the flex-1 slot - so adding tab-bar padding
      // here would double-count it and push the button under the bar. On web the same bar
      // is `position: fixed` and overlays the content instead, so the padding is required.
      className={`relative isolate flex min-h-0 w-full flex-1 flex-col justify-between overflow-hidden bg-[hsl(var(--lg-abyss))] px-6 pt-[max(2rem,env(safe-area-inset-top))] ${
        isNative
          ? "pb-[max(2rem,env(safe-area-inset-bottom))]"
          : "pb-[calc(var(--tabbar-h,0px)+1.5rem)]"
      }`}
    >
      <Atmosphere reduceMotion={reduceMotion} />

      {/* TOP: the streak. Nothing above it - no logo, no greeting, no date. */}
      <div className="relative">
        <StreakWidget data={streak} reduceMotion={reduceMotion} />
      </div>

      {/* CENTRE: the count, as a numeral. This is the whole of the screen's copy.
          monopo's display rule, applied at mobile scale: weight 300, tight tracking,
          line-height under 1, and absolutely nothing crowding it. */}
      <motion.div
        initial={reduceMotion ? false : { opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 1.25, ease: GLIDE, delay: 0.2 }}
        className="relative flex flex-1 flex-col items-center justify-center"
      >
        {/* The em-dash placeholder is deliberately slate rather than platinum. At 7.5rem a
            white em-dash is a 60px-wide solid bar and reads as a rendering glitch, not as
            "not known yet" - which is the actual state while the scheduler is still
            reading, or when nobody is signed in. */}
        <span
          className={`font-sans text-[7.5rem] font-light leading-[0.85] tracking-[-0.05em] tabular-nums ${
            dueCount === null ? "text-[hsl(var(--lg-slate))]" : "text-[hsl(var(--lg-platinum))]"
          }`}
        >
          {dueCount ?? "—"}
        </span>
        <span className="mt-4 font-mono text-[10px] uppercase tracking-[0.3em] text-[hsl(var(--lg-silver))]">
          {dueCount === null ? "reading" : nothingDue ? "all clear" : "cards ready"}
        </span>
      </motion.div>

      {/* BOTTOM: one action. */}
      <motion.div
        initial={reduceMotion ? false : { opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 1, ease: GLIDE, delay: 0.3 }}
        className="relative"
      >
        <EnterFlowButton
          onEnter={handleEnter}
          disabled={starting || nothingDue || dueCount === null}
          reduceMotion={reduceMotion}
        />
      </motion.div>
    </section>
  );
}
