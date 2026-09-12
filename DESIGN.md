# DESIGN.md — FlowRecall

This project runs **two visual worlds on purpose**, split by surface rather than by taste.
Both are pure black; neither inverts under `:root[data-theme="light"]`.

| World | Where | Source of truth |
|---|---|---|
| **The Bento Grid** | the home page — `/` on the website **and** inside the APK | inline in `src/app/page.tsx` |
| **Spatial Glass** | `/library`, the tab bar, the upload sheet | `src/lib/spatial.ts` |

Neither world's values flow through `globals.css`'s semantic layer, which is documented as
"Pure Monochrome … NO color anywhere" and still governs the reader, account, study and
ingest surfaces.

**`/` is one page on both platforms, and that is the decision the whole rewrite exists to
make.** For six commits the home page branched into marketing-on-web and a dashboard-in-app,
and the result was an installed app with nothing on its first screen that said what
FlowRecall is. `page.tsx` now renders the same introduction everywhere; `useIsNative()` is
consulted for **two spacing values and nothing else** — the hero's vertical centring and the
grid's top padding. Because it defaults to `false`, SSR and the static export both emit the
full page and SEO is untouched.

---

## The Bento Grid (the home page)

**Mode:** Introduce. A visitor — on the site or on their own phone — learns what this is.

One twelve-column grid on OLED black. Not a scroll of sections: every piece of content is a
cell, and its span is a judgement about how much it is worth.

**The rows are uneven on purpose:** `7/5 · 12 · 8/4 · 5/7 · 7/5 · 5/7 · 12`. The hero and
the recall loop are equals at the top. The chart is twice the width of its own commentary,
because the chart is the argument and the prose is a caption. The page opens and closes on a
full-bleed twelve — the pull-quote and the close — so it is bracketed rather than merely
ended.

**Twelve cells, and not one word fewer than the fifteen before them.** A brief asked to prune
the copy; the copy was measured first. Every body paragraph on this page put together is
**189 words**, and the longest single one is 23 — three earlier passes had already done the
cutting, and 345 of the page's other words are FAQ answers collapsed behind `<details>`.
What made it feel cluttered was the furniture: six product cards, each a bordered pane with a
mono label, a heading, one line of prose and a small drawn mock, stacking into six identical
full-width boxes on a phone. Five of those mocks restated their own captions — a tick list
reading "Got right / Left out / Had wrong" under a sentence containing "what you left out and
what you had wrong" — and four of the cards were a list pretending to be a gallery. The mocks
are down to two and the four cards are one hairline index. Every word survived.

Reading order is unchanged from the version before it: hero, the fact, the curve, the product,
the four steps, FAQ, close. **Every word of the copy is unchanged too.** The page has now been
rewritten three times for structure and never once for content.

The gap is the only spacing between cells — no section padding, no vertical rhythm to keep in
sync, and nothing that depends on a margin collapse behaving.

### One cell, two thicknesses of glass, and the split is measured
`relative overflow-hidden rounded-[28px] border border-white/10 sm:rounded-[32px]`, plus one
of:

| Recipe | Fill | Used for |
|---|---|---|
| `GLASS_SMALL` | `bg-white/[0.02]` · `backdrop-blur-3xl` | cells at a third of a viewport or less |
| `GLASS_LARGE` | `bg-white/[0.03]` · **no filter** | the hero, the loop, the fact, the curve, the FAQ, the close |

A `backdrop-filter` costs the area it covers, re-sampled whenever what is behind it moves —
which on a scrolling page is every frame. Seven full-width blurred panes is the most reliable
way to turn a smooth scroll into a slideshow on the cheap Android panels this ships to; that
was measured on this page's predecessor, which carried no filter at all. Small cells can
afford it, and they are where the material is most legible anyway: a small pane beside a large
one reads as frost because its edges are close enough together to see the gradient bend.

**3% fill against 2%** is the compensation — a blurred pane picks up light from what it is
blurring, so an unfiltered one needs slightly more of its own to read as the same material
sitting beside it. In place the two are indistinguishable, which is the test that matters.

There is something behind the panes to refract, which is the usual catch with glass on pure
black: the film grain and the backlight both sit at `-z-10` under the whole grid.

### The ground, and the six glows that are gone
`Backlight()` is `fixed`, not absolute, so the light stays put while the grid travels past it.
Two radial gradients, painted once, **never animated**, plus `FilmGrain`.

**It is now the only light on the page.** The version before it also carried a masked 4rem
ruled grid behind the hero, three blurred orbs, a 28rem wash behind the closing CTA, another
behind the FAQ, and a fourth inside the flagship product card — six full-viewport-class
blurred washes. A glow belongs on something you can press, not behind four different headings.

The grain is not decoration: a gradient falling from 7% white to nothing across a viewport
spans roughly one 8-bit step, and without a dither it bands into visible rings on exactly
those panels.

**The grain runs at `opacity-[0.02]`, and this value has been set three times.** 0.20 was
asked for twice and shipped once; on a device, over a translucent tab bar blurring what is
behind it, 20% fractal noise does not read as film, it reads as a dirty screen. No amount of
contrast arithmetic finds that — only looking at it does.

**Its job was never texture, it is a dither.** A radial gradient falling from 7% white to
nothing across a viewport spans roughly one 8-bit step, and without noise it bands into visible
rings on exactly the cheap Android panels this ships to. Breaking that step needs a couple of
percent; everything above ~0.05 is decoration laid over the whole product, chrome included.

**The text ramp keeps the step the heavy grain bought it.** Body went `/50 → /60` and the
display clause `/40 → /45` to survive the lighter ground 20% noise creates. At 0.02 the ground
is near-black again, where `/60` measures **7.4:1** rather than the 6.08:1 it managed under the
grain. Nothing was reverted: the page is simply more readable than before either change.

### The accent is luminance, not hue
White spill (`0 8px 36px -6px rgba(255,255,255,0.35)`), and it appears in exactly two places:
the primary CTA, and the **answer** beat of the recall loop. That is the accent spent where
the loop pays off.

An azure was considered and rejected on evidence rather than taste: at the low alpha a glow
needs, chroma carries where luminance does not, so a saturated wash tints the whole upper page
where the same value in white stays a glow. This page had already learned that once.

### The recall loop — question, think, answer
The flagship cell, five columns beside the hero, and the reason the grid is asymmetric.

It used to be a headline, a paragraph, and a drawn mock of two study formats stacked
underneath. The mock was doing the most important work on the page and reading as filler,
because nothing said what its three pieces were. They are three beats now, on a hairline
rhythm, in order, at the top of the page beside the headline.

**The labels under each beat are the mock's own words.** "True or false" and "Type it from
memory" are the formats' real names in the study feed, and "days later" was already the
divider between them — because the two formats are not the same night. The harder one is
scheduled for when the memory has had time to decay, which is the point of the chart two cells
down.

### The hero cluster
Four slabs in a nested twelve-column grid that spans the outer one, so the gap rhythm is
identical and the seams line up with every other cell:

```
┌───────────────────────────┬───────────────┐
│  headline + subhead  (7)  │               │
├─────────────┬─────────────┤   loop  (5)   │
│  CTAs  (4)  │  proof (3)  │   rows 1-2    │
└─────────────┴─────────────┴───────────────┘
```

It replaces one 678px cell holding six things with 240px of content in it — 219px of nothing
above the eyebrow and 219 below the subhead. **An element centred in empty space is what
reads as floating**, so the headline slab is `justify-between`: label pinned to the top edge,
the sentence sitting on the bottom one, the air between them deliberate. Same height, spent
on purpose.

**Placement is explicit on `lg` because DOM order and visual order disagree deliberately.**
Stacked on a phone the buttons must come directly under the headline — a primary action below
a tall product panel is one nobody reaches — so the DOM runs headline, CTAs, proof, loop. On
`lg` the loop belongs beside the headline, spanning both rows, which auto-flow cannot express
from that order. Without its `row-span-2` the loop auto-placed into row 1 only and left
columns 8–12 of row 2 as a hole in the grid.

**No entrance on the CTA or proof slabs.** Animating a whole pane meant the primary action did
not exist for the first second of the page, and a glass slab fading in reads as a layout jump.
The entrances belong to the text inside the headline slab; the slabs are present at first
paint.

**The action slab has two faces, and the switch is CSS rather than state.** A stranger reading
an introduction needs both CTAs as pills. A signed-in student with something due tonight needs
exactly one thing — the door back into the session — and two white pills above it compete with
the only action that matters, so they demote to `text-white/40` links beneath the card.

Whether `TodaySession` renders depends on four things it resolves asynchronously and privately:
a user id, at least one deck, a plan the scheduler has finished building, and something
actually being due. The page cannot know any of that at render time, and guessing from
`decks.length` would demote the pills on a screen where the card then declines to appear —
leaving no primary action at all. `group-has-[#tonight-heading]` keys off the card that
actually rendered, so the two cannot disagree. Both branches ship in the markup; the hidden one
is `display:none`, so it is neither announced nor tabbable.

### The controls
`h-14` — 56px, the same figure on every breakpoint, fixed rather than derived from padding.
The pills before them were `px-6 py-3.5 text-base` and full-bleed on a phone: 52px of button
whose height moved with its font, so the two CTAs never quite agreed with each other or with
the tab bar's controls, and at 16px type on a 336px pill the shape read as a balloon. Both
CTAs stack full-width inside the action tile, so the pair is one block with one left edge.

### Type
Geist for everything structural, `tracking-[-0.04em]` on display.

**Newsreader italic, not Playfair, and that is legibility rather than taste.** Both were named
in a brief. Playfair is a Didone — its thick-to-thin contrast is the drama, and that drama is
what fails here, because this face is not only a display face in this app: `<Em>` sets the tail
of body lines at ~15px in white at 70% on near-black, where a Didone hairline thins below a
device pixel and drops out. Newsreader was drawn for screen text and its italic still has flow
at 3rem. It replaced Instrument Serif, which could also do both jobs; the swap was because the
brief asked for one of these two by name.

**Instrument Serif italic is a rule, not a sprinkle: it always carries the CLOSING clause of
a line, never a phrase in the middle of one.** `<Hi>` owns the middle of a sentence in white
medium sans; `<Em>` owns its end in serif italic at /70, so the two never compete for the same
words and the emphasis order cannot invert. The sentence changes voice as it finishes, the way
a pull-quote does — a serif that could appear anywhere would just be a second body font.

It carries nine moments: the headline's second clause, the whole brain-fact pull-quote, the
loop's "days later", "built" in the statement cell, "by tomorrow" in the close, and the tails
of the curve ("not drawn"), the mindmap, the teach-back ("Never a score."), the library and
"whatever is closest to slipping".

**The pull-quote is italic, and was not until the serif rule landed.** The fact cell had been
set in Instrument Serif *roman* since the serif was introduced — which is why it read as a
quiet heading rather than as a quotation, and why an earlier draft of this document described
it as italic when the code said otherwise. Its faded quote mark sits at `white/10`.

That font is wired as `--font-instrument-serif` in `layout.tsx` and mapped to the semantic
`--font-editorial` in `globals.css`. **Naming both the same made the mapping
self-referential** — `--font-editorial: var(--font-editorial)` — so the token resolved to
nothing and every serif span silently rendered in Geist.

**The headline is capped by the sentence, and every number was measured in the browser with
Geist actually loaded.** `clamp(2.4rem, 6vw, 5rem)`. "Stop re-reading." costs 7.1px of width
per px of type, so it needs 312px at 44px; the columns it occupies are 286px at 360dp and
462px at the lg breakpoint. At the 7.5rem the slab version used, it broke at its own hyphen
into "Stop re- / reading." — three lines where two were authored, with the break mid-word.

A first pass at that calculation used a probe that ran before the webfont landed and measured
17% light, which is exactly enough to look right on paper and wrap on a phone.

**Pacifico is down to one call site**, the footer wordmark. Brand identity, so it stays the
owner's call.

### Contrast, and why the muted end stops at /50
Body copy is `text-white/60`; `<Hi>` lifts two or three words per paragraph to pure white.
Labels that carry meaning — the `<Effect>` mechanism names, the loop's beat labels, the step
numerals — are `/60`.

White at 40% over black composites to `#666`, which is **3.7:1** and under the 4.5:1 floor for
body text. `/50` is `#808080` and 5.3:1; `/60` is 7.4:1. The two lighter values are a hair
apart on screen and only one of them is readable. `/40` survives only on `aria-hidden`
decoration, where there is nothing to read.

### What was cut, and why none of it was copy
Three labels that named their own section — "The forgetting curve", "Why FlowRecall", "How it
works" — sat above headings that already said the same thing. A caption on a caption; the
heading carries its own weight.

The six 44px icon chips went with them. Every product cell carried two labels for one idea:
the mono `<Effect>` eyebrow naming the mechanism, and a glyph saying it wordlessly. The
eyebrow is the informative one, and the statement cell's copy promises exactly that — "the
mechanism each surface is built on is named on the card". The chips were also the only element
on the page that did not re-theme.

`<Effect>` itself stays for that reason: it is the claim, not decoration on it.

### Motion — one authored moment, and no JavaScript
**`motion/react` is not imported by this route at all.** It drove one spring entrance per
section — nine of them, identical, which is a default rather than a design — plus a
scroll-reveal on every block.

What ships is `.fr-rise`: four staggered entrances in the hero, 90ms apart, a CSS keyframe on
`cubic-bezier(0.16, 1, 0.3, 1)`. Everything below the fold is simply present when you arrive.
No spring integrator on the main thread of a mid-range phone, and no element anywhere on the
page whose visibility depends on JS having run.

The delay is passed per element as `--fr-d`, so the stagger lives at the call site next to the
element it delays rather than as four nth-child rules that break the moment the markup order
changes.

**`.fr-lift` gates its hover scale behind `(hover: hover) and (pointer: fine)`**, and that gate
is load-bearing here rather than tidy: Android WebView can latch `:hover` on a tap, which would
leave a cell scaled up until the next tap lands elsewhere — and on a `GLASS_SMALL` cell that
scale re-samples a 64px filter for every frame it runs.

Reduced motion removes both outright rather than running them faster, and `.fr-rise` resolves
to its **visible** end.

**No `animation-timeline` anywhere.** Scroll-driven CSS is Chromium 115+; the Android floor is
WebView 111, set deliberately in `capacitor.config.ts`. Below 115 the keyframe runs
immediately, which can strand an element at `opacity: 0` — a blank hero on exactly the cheap
phones that floor exists to protect.

**Performance contract** (inherited, restated in eleven files): animation drives `transform`
and `opacity` only.

### Two cells that had to be measured against each other
Grid stretches every cell to its row's tallest member, which is what makes a bento read as a
bento and also what puts a hole in it when two neighbours disagree about height.

"Showing up" and the four steps share the last product row. As a four-row list the steps cell
was roughly 300px taller, and its neighbour had to spend that on nothing — a headline and
seven small squares floating in the middle of a void. The steps fold into **two by two**, and
the streak calendar became a **full-width band on the floor of its cell**, its squares
`flex-1` so they grow into a week you can read at a glance. Same height, spent on purpose.

### `aw-page`
The cells are hard-coded white-on-black, but `RetentionCurve` and `TodaySession` draw
themselves from `--foreground` / `--accent`. Without that class pinning the dark token values
for the subtree, a visitor in light mode gets a near-black chart line on a black cell.

It also carries the surfaces the page did not draw: `::selection`, the focus outline, and a
themed scrollbar. On a pure-black page the platform default scrollbar — a light trough with a
grey thumb — is the loudest thing in the viewport.

---

## Spatial Glass (the library, the tab bar, the sheet)

**Mode:** Operate. The visitor is here to get back into a document.

One material, one ground, **no accent colour at all**. Pure `#000`, and every surface on it
is the same frosted pane at one of two thicknesses. What separates a control from a card is
how much light its glass holds — nothing else.

There is now exactly one qualification to "no colour", and it is stated in full under
[The mesh](#the-mesh-chroma-below-threshold-lifted-by-the-glass) below: a violet/cyan/coral
mesh sits on the ground at 1.8–3.5% alpha, which is **below the threshold where a hue reads
as a tint**, and the panes lift it with `backdrop-saturate` so it resolves *inside* glass and
nowhere else. The accent is still luminance. The chroma is a property of the material, not
of the palette — no token, no call site, and no control is coloured by it.

| Recipe | Fill / edge | Used for |
|---|---|---|
| `GLASS_PANEL` | `bg-white/5` · `backdrop-blur-3xl` · `saturate-[2.2]` · `border-white/10` | cards, widgets, the sheet |
| `GLASS_CONTROL` | `bg-white/10` · `backdrop-blur-2xl` · `saturate-[2.2]` · `border-white/20` | FAB, primary actions |
| `GLASS_STATIC` | `bg-white/[0.06]` · no filter · `border-white/10` | **scrolling** surfaces (the library grid) |
| `GLASS_PANEL_SOFT` | `bg-white/5` · `backdrop-blur-md` · `saturate-[2.2]` · `border-white/10` | a secondary widget beside a primary one |
| `META_PILL` | `bg-white/[0.06]` · `saturate-[2.2]`, **no blur** · `border-white/10` | non-tappable counts and tags |

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

### The mesh — chroma below threshold, lifted by the glass
Three radial stops on the ground, painted once by `GlowField` and never animated:
**violet `rgba(124,58,237,.035)`** top-left, **cyan `rgba(34,211,238,.022)`** off the right
edge, **coral `rgba(251,113,133,.018)`** low and mostly below the fold, with the original
white `.035` sheen layered on top. They are exported as `CHROMA` in `spatial.ts`.

**The alphas are set from a screenshot, and the first pass was wrong by about 3×.** It
shipped at 5.5–10%, reasoned on paper to land "one 8-bit step off the ground". Measured off
an actual 390×844 capture the violet lobe read `rgb(14,10,22)` and the cyan lobe
`rgb(3,15,17)` on **bare canvas**, with no pane over either — a channel spread of 11 and 13.
That is not a step, that is a visible teal cast down the right edge: the exact wash
[The accent is luminance, not hue](#the-accent-is-luminance-not-hue) rejected, rebuilt by
hand. At a third of the alpha the same lobes measure a spread of about 4.

> **The rule is a measurement.** Bare-canvas channel spread (max minus min channel, sampled
> away from any pane) must stay at or under **~4**. Above that the hue is a tint and this
> layer has failed at the only thing it is for. Re-measure after any change — the arithmetic
> is not trustworthy at these values and has already proved it once.

**`backdrop-saturate` is what makes it visible, and only where a pane is.** A saturate filter
scales chroma around luma: it multiplies a colour that is already there and cannot invent one
that is not, so over the achromatic parts of the ground it is an exact no-op. Measured, a
pane over the violet lobe reads `rgb(29,26,32)` — spread **5.7** — against bare ground beside
it at `rgb(8,7,11)`. Violet inside the glass, black next to it.

**2.2 and not more, and the ceiling is set by content rather than by the mesh.** A pane does
not only sit over the ground — the selection bar and the tab bar sit over cover art, which
has real colour already. The mesh would take 3×; a book jacket would go lurid at it.

**Saturate has no radius, which is why pills get it and blur.** 64px of blur inside a 24px
pill samples almost entirely from outside the pill — paid for and not seen. Saturate is
per-pixel and works identically at any size, so `META_PILL` and the library's sort control
carry saturate with no blur. Written the other way first, and it showed: the library's chrome
is pills and a segmented control, so with no saturate anywhere on that screen the hue was
doing *only* the thing it must never do.

**One constant reverses all of it.** Set every alpha in `CHROMA` to 0 and the world is
achromatic again with no call site touched — saturate over a grey backdrop changes nothing.
The hue is the newest and least proven idea in a system whose whole argument is restraint, so
it is built to be withdrawn in one edit.

### Glass needs something behind it
`backdrop-blur` blurs what is behind the pane, and over flat `#000` there is nothing to blur.
`GlowField` therefore keeps one whisper-faint **achromatic** sheen (white at 3.5% peak, dead
by 60%, anchored off the top-left) so the panes have something to refract — and, since the
mesh above, three sub-threshold chroma stops layered *under* that sheen, which is what gives
a 64px filter something with structure to work on rather than a flat fill to recompute. One
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
