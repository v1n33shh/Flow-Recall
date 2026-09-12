# Surface brief — FlowRecall app shell (native home, tab bar, library)

Routes: `/` (native branch), `/library`, and the chrome in `MobileTabBar`.
Mode: **Operate.** The visitor opens the app to get back into a document.

## Direction contract

**THESIS.** This shell owns *one* idea: the book you are in the middle of, and the
single tap back into it. It refuses the category default for a reading app's home —
a shelf grid as the landing surface, with the thing you were actually reading buried
in row one as just another cover. The shelf is a destination here, not the greeting.

**OWN-WORLD.** Pure black ground (#000), never near-black. All chrome is achromatic:
white at 4–12% for fills, white at 10% for hairlines, white at 50–100% for type. The
only colour in the product is the aurora — three blurred gradient curtains, indigo /
cyan / violet, `mix-blend-screen`, that live strictly *behind* glass and never touch a
control, a border or a glyph. Surfaces are `backdrop-blur-3xl` over `bg-white/5` with
`border-white/10`. Radii are large and soft (28px panels, full pills). No shadows as
elevation: depth is the aurora showing through frosted glass. Recognisable with all
content removed by exactly that: black, a slow coloured haze, and floating frost.

**STORY.** The visitor understands within one second that they are 74% through a
specific book; believes the app is a calm instrument rather than a study drill; and
taps Resume. Secondary: they add a document. Nothing else is offered.

**FIRST VIEWPORT.** Aurora behind everything. A short true status line at the top
(book count, not a slogan). Below it, the Continue Reading card at roughly 40% of the
screen height: real cover thumbnail left, title + author right, a full-width hairline
progress track with the real percentage, and the magnetic "Resume Flow" pill as the
card's widest element. Under it, a compact "Recently opened" rail of the next books.
The primary action sits inside the card, thumb-high. The FAB sits centred above the
three-tab pill, the only other action on screen.

**FORM.** Continue-card-led dashboard, first on the ordered list (shelf-grid-led and
now-playing-bar-led were the alternatives; both bury the resume action). No
concept-seed roll was run — the user pinned palette, material, motion library and
component set in the brief, so the world was not open to a tournament.

**FINISH.** unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
