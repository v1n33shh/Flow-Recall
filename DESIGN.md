# DESIGN.md — FlowRecall

This project runs **two visual worlds on purpose**, split by surface rather than by taste.
Both are pure black; neither inverts under `:root[data-theme="light"]`.

| World | Where | Source of truth |
|---|---|---|
| **The Slab Stack** | the home page — `/` on the website **and** inside the APK | inline in `src/app/page.tsx` |
| **Spatial Glass** | `/library`, the tab bar, the upload sheet | `src/lib/spatial.ts` |

Neither world's values flow through `globals.css`'s semantic layer, which is documented as
"Pure Monochrome … NO color anywhere" and still governs the reader, account, study and
ingest surfaces.

**`/` is one page on both platforms, and that is the decision the whole rewrite exists to
make.** For six commits the home page branched into marketing-on-web and a dashboard-in-app,
and the result was an installed app with nothing on its first screen that said what
FlowRecall is. `page.tsx` now renders the same introduction everywhere; `useIsNative()` is
consulted **only** for spacing and for switching off two web-tuned decorations. Because it
defaults to `false`, SSR and the static export both emit the full page and SEO is untouched.

---

## The Slab Stack (the home page)

**Mode:** Introduce. A visitor — on the site or on their own phone — learns what this is.

A deck of enormous rounded slabs dealt down a pitch-black page. Seven of them, each pulling
up into the one before it so the page reads as layered cards rather than as stacked
sections.

### The slab recipe
`bg-white/[0.02]` · `border border-white/10` · `rounded-[32px]`, `sm:rounded-[40px]` ·
`shadow-[0_-40px_80px_-40px_rgba(0,0,0,0.95)]` · `-mt-8 sm:-mt-14` · `z` climbing 10 → 70.

**The overlap is margin, z-index and one shadow — no JavaScript.** The shadow points
*upward* (negative y), so it darkens the slab beneath at exactly the seam where they meet,
which is what turns two translucent panes into a legible layer order. There is no scroll
listener on this page at all.

**32px of radius on a phone, 40px from `sm` up.** 40px of corner on a 360dp-wide slab eats
into the first and last line of every paragraph inside it — a rounding decision the copy
would have paid for.

### No `backdrop-filter` on the slabs
The brief's recipe stops at a fill and a hairline, and it is right to. A `backdrop-filter`
is re-evaluated as the page scrolls, and seven full-viewport blurred panes is the most
reliable way to turn a smooth scroll into a slideshow on the cheap Android panels this
ships to. Blur survives on two elements only — the hero pill and the section eyebrow, a few
hundred pixels each.

### The ground
`Backlight()` is `fixed`, not absolute, so the light stays put while the slabs travel past
it: the stack reads as lit from a fixed source in the room rather than carrying its own glow
around. Two radial gradients, painted once, **never animated**, plus `FilmGrain`.

**The grain is not decoration here.** A gradient falling from 4% white to nothing across a
viewport spans roughly one 8-bit step, and without a dither it bands into visible rings on
exactly those panels.

Hero-only, web-only: a masked 4rem ruled grid and three blurred achromatic orbs. Both are
off on native — tuned for web's tall hero, they compress into a visibly gridded patch and an
isolated grey blob in native's short content-fit box. Confirmed on device.

### Type
Geist for everything structural. `clamp(2.75rem, 10.5vw, 7.5rem)` on the headline, so
display type tracks the viewport continuously instead of landing wrong between breakpoints.

**Instrument Serif, italic, carries the argument in two places** — the headline's second
clause (`Stop re-reading.` in `white/40`, `Start recalling.` in serif) and the whole
brain-fact slab. The headline argues by contrast, and the type now carries that contrast
instead of leaving it to the words.

That font is wired as `--font-instrument-serif` in `layout.tsx` and mapped to the semantic
`--font-editorial` in `globals.css`. **Naming both the same made the mapping
self-referential** — `--font-editorial: var(--font-editorial)` — so the token resolved to
nothing and every serif span silently rendered in Geist.

Paragraphs sit at `text-white/50` so headings keep the contrast; `<Hi>` lifts two or three
words per paragraph to pure white. It is a `<span>`, not `<strong>`: a typographic emphasis,
not a semantic one, and a screen reader announcing "PDF" with stress adds nothing.

**Pacifico is down to one call site** — the footer wordmark (`page.tsx:932`). It is the
least Linear-like element in a system that names Linear as its target, and it is brand
identity, so it stays the owner's call rather than a styling one.

### The stack, in order
Hero (z10, no overlap) · the brain fact (z20) · the retention curve (z30) · the feature grid
(z40) · how it works (z50) · FAQ (z60) · final CTA (z70) · footer, outside the stack.

**Two things survived "cut the wall of text" deliberately:**
- **The FAQ in full.** `FAQPAGE_JSONLD` declares seven Q&A pairs, and Google requires the
  answer text to be *present on the page* for the rich result. A schema block whose answers
  are absent is what earns a manual action.
- **The retention curve.** The page's only evidence, and it is *computed* from `fsrs.ts` by
  the same FSRS-6 scheduler that will schedule whoever reads it — not drawn.

`<Effect>` names the mechanism above each feature headline, mono and tiny so it reads as a
citation rather than a second headline. That is the editorial move of the grid: every surface
in this app exists because of a specific, checkable finding about memory, and saying which
one converts a feature list into an argument.

### The brain fact slab
One checkable fact, rotated **per visit** (not on a timer — text that changes while you read
it is a bug wearing a feature's clothes) from the 24 lines in `src/lib/brainFacts.ts`. That
file's standing rule governs the content: every claim is checkable and **none is attributed
to anybody**, because a misattributed quotation is worse than no quotation.

The cursor is shared with the library header, so a student who opens both screens meets two
different facts and meets all 24 before meeting any twice.

It is the one slab set in serif, with no eyebrow, no attribution and no explanation beneath
it — a paragraph here would defeat the point of the rewrite.

### Motion
`motion/react`, with one spring reused for every entrance: `SNAP`, stiffness **700** /
damping **18**. That ratio overshoots and rings, and the constant's own comment says so
outright — *"snap aggressively into place instead of gently fading in."* **A calmer 200/26
was built and measured in an earlier revision and is not what ships here**; if the entrances
ever read as twitchy rather than crisp, that is the number to revisit, and it is one constant
at `page.tsx:42`.

Scroll reveals use a separate, much softer 120/20 via `reveal()`.

**Not used, on technical grounds:** no scroll-driven CSS (`animation-timeline` is Chromium
115+) and no React `<ViewTransition>` (needs Chromium 125+). The Android floor is **WebView
111**, set deliberately in `capacitor.config.ts`. Below 115 an `animation-timeline` keyframe
runs immediately, which can strand an element at `opacity: 0` — a silently blank section on
exactly the cheap phones that floor exists to protect.

### `aw-page`
The slabs are hard-coded white-on-black, but `RetentionCurve` and `TodaySession` draw
themselves from `--foreground` / `--accent`. Without that class pinning the dark token values
for the subtree, a visitor in light mode gets a near-black chart line on a black slab.

---

## Spatial Glass (the library, the tab bar, the sheet)

**Mode:** Operate. The visitor is here to get back into a document.

One material, one ground, **no accent colour at all**. Pure `#000`, and every surface on it
is the same frosted pane at one of two thicknesses. What separates a control from a card is
how much light its glass holds — nothing else.

| Recipe | Fill / edge | Used for |
|---|---|---|
| `GLASS_PANEL` | `bg-white/5` · `backdrop-blur-3xl` · `border-white/10` | cards, widgets, the sheet |
| `GLASS_CONTROL` | `bg-white/10` · `backdrop-blur-2xl` · `border-white/20` | FAB, primary actions |
| `GLASS_STATIC` | `bg-white/[0.06]` · no filter · `border-white/10` | **scrolling** surfaces (the library grid) |
| `GLASS_PANEL_SOFT` | `bg-white/5` · `backdrop-blur-md` · `border-white/10` | a secondary widget beside a primary one |

10/20 against 5/10 is the entire hierarchy, and it has to be unambiguous because there is no
accent to spend: 7/12 would not read.

Text is `white` / `white/70` / `white/60` / `white/40` — measured on pure black at 21:1,
10.2:1 and 7.4:1, so the ramp stops well clear of AA rather than at it. `/60` is the floor
for real prose; `/40` is for chrome a reader never has to decode. The only opaque fill in
the world is the library's delete button, deliberately *not* glass: a destructive
confirmation should not look like one more surface to tap through.

### No CSS custom properties — this is the important rule
Two earlier worlds used scoped `--au-*` / `--nk-*` variables spread onto each screen's root,
and that design shipped the same bug twice: `MobileTabBar` and `UploadSheet` are **siblings
of `<main>`** in `layout.tsx`, so they never inherited the palette. A variable that is not in
scope makes `oklch(var(--x))` an **invalid** colour rather than a wrong one — so the FAB
computed to `rgba(0,0,0,0)`, an invisible button, and hairlines fell back to `currentColor`
and painted solid white rings. It is the worst class of styling bug: silent, and invisible to
a screenshot precisely because the element it eats is the one you are looking for.

`spatial.ts` is literal Tailwind utility strings and nothing else. `bg-white/5` cannot fail
to resolve, cannot depend on an ancestor, and cannot be scoped wrong. At this size — two
fills, two borders, four text values — that is smaller than a token system and strictly more
robust.

### Glass needs something behind it
`backdrop-blur` blurs what is behind the pane, and over flat `#000` there is nothing to blur.
`GlowField` therefore keeps one whisper-faint **achromatic** sheen (white at 3.5% peak, dead
by 60%, anchored off the top-left) so the panes have something to refract. One
`background-image`, painted once, never animated. Delete that div and the screen still
works — flatter, and the glass stops being glass.

**The background never moves.** An animated backdrop invalidates every `backdrop-filter`
above it on every frame, so a moving background does not cost its own paint — it costs
everyone else's blur. That lesson cost this shell a full revision.

### Type
Geist throughout. `WORDMARK` is `font-semibold` at `-0.02em`, **not** Pacifico: inside the
app that script was the one element arguing a personality the rest of the screen had spent
its budget not having.

### Motion
**`motion/react` is reserved for gestures.** Exactly one file in this world imports it —
`UploadSheet`, for drag-to-dismiss, which tracks a finger in real time and has no CSS
equivalent. Everything else is CSS: `TRANSITION` (`transition-all duration-300 ease-out`),
`PRESS` / `TAP` active scales, and `.au-rise` in `globals.css` for one-shot entrances.
Reduced motion removes `.au-rise` outright. The sheet enters on `GLIDE`, expo-out, so it
covers most of its distance immediately and then settles — which is what makes a sheet read
as heavy.

**Performance contract** (inherited, restated in eleven files): animation drives `transform`
and `opacity` only.

---

## Navigation

**Five tabs — Home, Library, Ingest, Reader, Account — plus one action, the upload FAB.**
Mindmap stays out: it is a view over decks, which the shell does not surface as a
destination.

This bar has been six tabs, then three, then four. **Account has to be in it.** `Navbar`
returns `null` on native, so the Account tab is the *only* route to sign-in, sync,
appearance, sign-out and account deletion inside the APK — at four tabs that route had no
entry point at all. An avatar in a screen header was built as the alternative and is not
wired (see below), so the tab is what ships.

**The FAB clears the pill entirely rather than straddling it.** With an odd tab count the
centre of the bar *is* a tab, and a docked FAB lands on it — during the four-tab revision it
sat squarely on Library's icon and left only the label showing. `--tabbar-h` is published
from a `ResizeObserver` over the real nav height, so every consumer reserves exact space with
no magic constant.

Labels are sized against the longest one: "Account", 7 characters at 10px, needs about 46px.
The six-tab version ran out of room and clipped it on every real phone — which is how that
tab came to look dead in the first place.

`/study`, `/revise`, `/map` and the FSRS engine all still exist and still work — they are
simply not offered in the bar. Deliberate and reversible.

---

## Built, and not reachable

Stated because unreachable code that looks finished is the most expensive kind to inherit.

- **`ReaderHome.tsx`** — a continue-reading-led native home: real cover thumbnail, a
  hairline progress track, a magnetic "Resume Flow" pill, a recently-opened rail, and an
  account avatar in its header. Nothing imports it. Its widgets — `ContinueReading`,
  `DailyInsight`, `PowerMove` — are reachable only through it. Making it the native home
  swaps out the screen students currently land on, which is a product decision, and the
  decision went the other way: `/` is one introduction on both platforms.
- **`FlowStateHub.tsx`** (+ `lib/liquidGlass.ts`) — parked at **`/flow`**, its own route on
  purpose, for the same reason.

`GlowField` and `BookCover` are shared with `/library`, so they ship either way.

A third generation — an acid-lime "Midnight Gallery" landing page and a Linear-style hero
(`MidnightHero`, `MidnightFeatures`, `AmbientOrb`, `HeroPremium`, `Screenshot`,
`lib/midnightGallery`, `lib/motion`) — was deleted rather than kept, along with
`spatial.ts`'s `GLASS_EDITORIAL`, `HOVER_LIFT` and `SERIF`, which only that landing page
used. `public/screens/` survives it: three real product screenshots, 44 KB, shot on the
emulator against the **starter deck** so nothing personal is baked into a public asset. No
page requests them today, and re-shooting costs an emulator session.

**`PowerMove`'s bolt is an authored SVG, not `⚡`.** On Android, U+26A1 has emoji
presentation and the platform renders it from Noto Color Emoji as a saturated yellow-orange
glyph — the one bright colour on a screen whose rule is "no bright colours". Emoji also
render differently on every OEM skin. `.power-pulse` fades it 50% → 100% on a 2.6s
`alternate`; under ~4s it stops reading as *alive* and starts reading as a notification
badge. Reduced motion resolves it to its **bright** end, because 50% would read as disabled.

**Vertical budget is real on that screen.** `PageTransition`'s native branch is
`absolute inset-0 overflow-y-auto`, sized to the viewport minus the tab bar's reserve, so
content past it is *clipped*, not merely below the fold. Adding a fourth pane needs the same
measurement that trimmed the existing bodies to three and two lines.
