/** "Spatial Glass" — the design layer for the app shell: the home screen, the library, and
 * the tab bar that carries both. Replaces the Neo Kinpaku world (src/lib/kinpaku.ts).
 *
 * One material, one ground, no accent. Pure black, and every surface on it is the same
 * pane of frosted glass at one of two thicknesses. There is no brand colour in this world
 * at all - not a gold, not a neon, not a tint. What separates a control from a card is how
 * much light its glass holds, and nothing else.
 *
 * ---------------------------------------------------------------------------
 * NO CSS CUSTOM PROPERTIES. THIS IS THE IMPORTANT PART OF THIS FILE.
 * ---------------------------------------------------------------------------
 * The two worlds before this one were built on scoped `--au-*` / `--nk-*` variables spread
 * onto each screen's root, and that design had a failure mode that shipped twice: the tab
 * bar and the upload sheet are SIBLINGS of <main> in layout.tsx, not children, so they
 * never inherited the palette. A variable that is not in scope makes `oklch(var(--x))` an
 * INVALID colour rather than a wrong one - so the gold FAB computed to `rgba(0,0,0,0)`, an
 * invisible button, and every hairline fell back to `currentColor` and painted solid white.
 * It is the worst class of styling bug: silent, and invisible to a screenshot precisely
 * because the element it eats is the one you are looking for.
 *
 * So this world is literal Tailwind utilities and nothing else. `bg-white/5` cannot fail to
 * resolve, cannot depend on an ancestor, and cannot be scoped wrong. Every constant below
 * is a plain class string that means the same thing in any tree position. That is a smaller
 * idea than a token system and a strictly more robust one at this size - there are two
 * fills, two borders and three text values in the entire shell.
 *
 * ---------------------------------------------------------------------------
 * GLASS NEEDS SOMETHING BEHIND IT
 * ---------------------------------------------------------------------------
 * Stated because it is the one real tension in the brief: `backdrop-blur` blurs what is
 * behind the pane, and over pure #000 there is nothing to blur - the blur is a no-op and
 * the "glass" is just a flat 5% white fill. It still reads correctly, because the fill and
 * the lit edge do the work; but the blur only earns its cost where something is actually
 * behind it (the sheet over the library grid, the tab bar over scrolling content). That is
 * why GlowField keeps one whisper-faint achromatic sheen - it gives the panes on the home
 * screen something to refract. Delete that one div and this all still works, flatter.
 *
 * ---------------------------------------------------------------------------
 * CHROMA LIVES BELOW THE VISIBILITY THRESHOLD AND IS LIFTED BY THE GLASS
 * ---------------------------------------------------------------------------
 * The sentence at the top - "there is no brand colour in this world at all" - is now one
 * qualification short of true, and the qualification is the whole idea, so it is worth
 * stating precisely rather than quietly relaxing.
 *
 * DESIGN.md:107 records that a saturated ground was tried and rejected: at the low alpha a
 * glow needs, chroma carries where luminance does not, so a saturated wash tints the whole
 * upper page where the same value in white stays a glow. That finding is not overturned
 * here. It is the constraint this layer is built around.
 *
 * The mesh (CHROMA below, painted by GlowField) sits at 1.8-3.5% alpha on pure black.
 *
 * THOSE ALPHAS WERE SET FROM A SCREENSHOT, NOT FROM ARITHMETIC, AND THE FIRST PASS WAS
 * WRONG BY ABOUT 3x. It shipped at 5.5-10%, reasoned on paper to land "one 8-bit step off
 * the ground". Measured off an actual 390x844 capture, the violet lobe read rgb(14,10,22)
 * and the cyan lobe rgb(3,15,17) on BARE CANVAS, with no pane over either - a channel
 * spread of 11 and 13. That is not a step, that is a visible teal cast down the right edge
 * and a violet one behind the header: precisely the wash DESIGN.md:107 rejected, rebuilt
 * by hand. At a third of the alpha the same lobes measure a spread of about 4, which is
 * inside the dither and reads as black.
 *
 * SO THE RULE, AND IT IS A MEASUREMENT RULE: bare-canvas channel spread (max minus min
 * channel, sampled away from any pane) must stay at or under ~4. Above that the hue is a
 * tint and this whole layer has failed at the one thing it is for. Re-measure after any
 * change here; the arithmetic is not trustworthy at these values and has already proved
 * it once.
 *
 * `backdrop-saturate` is what makes it something, and only where a pane is. A saturate
 * filter scales chroma around luma, so it multiplies a colour that is already there and
 * cannot invent one that is not: over the achromatic parts of the ground it is an exact
 * no-op, and over the mesh it lifts the chroma while leaving brightness alone.
 *
 * 2.2 AND NOT MORE, AND THE CEILING IS SET BY CONTENT RATHER THAN BY THE MESH. A pane does
 * not only ever sit over the ground - the selection bar and the tab bar sit over cover art,
 * which has real colour in it already. The mesh would happily take 3x; a book jacket would
 * go lurid at it. 2.2 is the most that can be spent without the filter announcing itself
 * on the one backdrop that is not ours to restyle.
 * So the violet/cyan/coral is legible INSIDE a frosted pane and invisible beside it -
 * "sits behind the pitch-black canvas, bleeds through frosted glass only", implemented
 * rather than approximated.
 *
 * It also, finally, gives the blur something to do. The paragraph above concedes that
 * `backdrop-blur` over flat #000 is a no-op and the glass is really just a 5% white fill.
 * With a mesh behind it the filter is working on real content, which is the difference
 * between a material and a rectangle.
 *
 * ONE CONSTANT REVERSES IT. Set every alpha in CHROMA to 0 and this world is achromatic
 * again with no call site touched - `backdrop-saturate` over a grey backdrop changes
 * nothing. That is deliberate: the hue is the newest and least proven idea in a system
 * whose whole argument is restraint, so it is built to be withdrawn in one edit.
 */

/** THE MESH. Three saturated stops and one achromatic sheen, as exact values.
 *
 * Read the CHROMA section of the file header before changing any alpha here - these
 * numbers are chosen to sit UNDER the threshold where a hue reads as a tint, because the
 * pane's `backdrop-saturate` is what is meant to make them visible, not the ground.
 *
 * THE HUES. Deep violet, cyan, coral - a triad rather than a single brand hue, because a
 * single one reads as a tint the moment it is detectable at all, where three that never
 * meet read as depth. They are placed far apart and never overlap at more than a few
 * percent: the violet anchors the top-left where the white sheen already is, the cyan sits
 * off the right edge at eye level, the coral is low and mostly below the fold.
 *
 * THE ALPHAS ARE NOT UNIFORM, AND THAT IS PERCEPTUAL RATHER THAN ARBITRARY. Cyan is the
 * brightest of the three at equal alpha (its luma coefficient is dominated by G) and coral
 * the next, so equal alphas would put a cyan bar across the right of every screen. They
 * are tuned to equal apparent weight instead: violet .035, cyan .022, coral .018 - and
 * the ratios between them matter more than the absolute values, which are set by the
 * measurement rule in the file header.
 *
 * NEVER ANIMATED, AND THIS IS THE EXPENSIVE RULE. An animated backdrop invalidates every
 * `backdrop-filter` above it on every frame - so a moving background does not cost its own
 * paint, it costs the blur of every pane on the screen. That lesson cost this shell a full
 * revision (DESIGN.md). One `background-image`, painted once.
 *
 * IT NEEDS THE DITHER. A gradient falling from 10% to nothing across a viewport spans
 * about one 8-bit step, and a step that small bands into visible rings on the cheap
 * Android panels this ships to. FilmGrain is what breaks it up; the two ship together.
 */
export const CHROMA = {
  /** Deep violet, top-left, behind the header. The largest and the only one that overlaps
   * the achromatic sheen - they are both anchored off the same corner, so the lit edge of
   * a pane up there catches a little of each. */
  violet: "rgba(124, 58, 237, 0.035)",
  /** Cyan, off the right edge at roughly eye level. Held tighter than the violet so it
   * reads as a source rather than a fill. */
  cyan: "rgba(34, 211, 238, 0.022)",
  /** Coral, low and centred, mostly below the fold on a phone - it exists so that a long
   * scroll changes temperature rather than repeating one frame forever. */
  coral: "rgba(251, 113, 133, 0.018)",
  /** The original achromatic sheen, unchanged and still doing the same job: a suggestion
   * that the room has a light in it off the top-left. The mesh is layered UNDER this, not
   * instead of it - drop all three hues and what is left is exactly the world before. */
  sheen: "rgba(255, 255, 255, 0.035)",
} as const;

/** The mesh as one `background-image`, composed here so GlowField and anything else that
 * ever needs the same ground cannot drift apart in the retuning.
 *
 * Order is paint order, back to front: the three hues, then the white sheen on top, which
 * is why the sheen still reads as the light source rather than as a fourth colour. */
export const MESH_BACKGROUND_IMAGE = [
  `radial-gradient(72% 52% at 14% 4%, ${CHROMA.violet} 0%, transparent 68%)`,
  `radial-gradient(56% 44% at 96% 34%, ${CHROMA.cyan} 0%, transparent 66%)`,
  `radial-gradient(68% 46% at 46% 104%, ${CHROMA.coral} 0%, transparent 64%)`,
  `radial-gradient(120% 85% at 0% 0%, ${CHROMA.sheen} 0%, rgba(255,255,255,0.014) 26%, rgba(255,255,255,0.004) 42%, transparent 60%)`,
].join(", ");

/** The metadata pill: a file type, a count, a status. Not a control - nothing here is
 * tappable, and it must not look like it is.
 *
 * TRACKING IS POSITIVE HERE AND THE BRIEF SAYS TIGHT, SO: tight tracking is a DISPLAY
 * instruction and it is honoured where display type lives (headings run at -0.03em, the
 * wordmark at -0.02em). Ten-pixel uppercase is the one place in typography where negative
 * tracking is simply wrong - caps have no ascender/descender rhythm to separate them, so
 * they collide and the word turns into a shape. +0.12em is what keeps it a word.
 *
 * NO BLUR, BUT YES SATURATE, AND THE SPLIT IS NOT A COMPROMISE - THE TWO FILTERS BEHAVE
 * DIFFERENTLY AT THIS SIZE. A blur has a RADIUS: 64px of it inside a 24px-tall pill samples
 * almost entirely from outside the pill, so it is paid for and not seen. Saturate has no
 * radius at all - it is per-pixel - so it works exactly as well on a pill as on a full-
 * bleed panel, and costs a fraction of the blur.
 *
 * This was briefly written the other way, with the blur argument used to justify no
 * backdrop-filter at all. That was wrong, and wrong in a way that showed up on screen: the
 * library's chrome is pills and a segmented control, so with no saturate anywhere on it
 * there was nothing on that entire screen lifting the mesh - leaving the hue doing only the
 * thing it must never do, tinting the bare canvas.
 *
 * The fill matches GLASS_STATIC rather than GLASS_PANEL for the usual reason: it is the
 * lighter 6% so it still reads as the same material without the blur behind it. */
export const META_PILL = [
  "inline-flex items-center gap-1.5 rounded-full",
  "border border-white/10 bg-white/[0.06] backdrop-saturate-[2.2]",
  "px-2.5 py-1",
  "text-[10px] font-medium uppercase tracking-[0.12em] text-white/60",
].join(" ");

/** The spatial pane. Cards, widgets, panels - anything that holds content.
 *
 * `backdrop-blur-3xl` is 64px, and it is affordable here only because the background under
 * it never moves: a blur over a static backdrop is computed once and cached, where a blur
 * over an animated one is recomputed every frame. That lesson cost this shell a whole
 * revision; see DESIGN.md.
 */
export const GLASS_PANEL = [
  "bg-white/5 backdrop-blur-3xl backdrop-saturate-[2.2]",
  "border border-white/10",
  // An inset top highlight, not a drop shadow. A pane catches light along its top edge; it
  // does not cast anything onto a room that has no floor.
  "shadow-[inset_0_1px_0_rgba(255,255,255,0.09)]",
].join(" ");

/** The thicker pane, for controls: the FAB, the primary button, the tab bar.
 *
 * Twice the fill and twice the edge of GLASS_PANEL. That ratio is the entire hierarchy in
 * this world - a control is not a different colour from a card, it is the same glass
 * holding more light. On a surface with no accent, that is the only signal available, so it
 * has to be unambiguous: 10/20 against 5/10 reads instantly, 7/12 would not.
 */
export const GLASS_CONTROL = [
  "bg-white/10 backdrop-blur-2xl backdrop-saturate-[2.2]",
  "border border-white/20",
  "shadow-[inset_0_1px_0_rgba(255,255,255,0.16)]",
].join(" ");

/** The same pane at a lighter blur, for a secondary widget sitting beside a primary one.
 *
 * Identical fill and edge to GLASS_PANEL - `bg-white/5`, `border-white/10` - so the two
 * read as one material; only the blur radius differs (12px against 64px). Over a ground
 * this dark the difference is very nearly invisible, which is exactly why it is worth
 * taking: the cheaper filter is free to use on a second pane that is not carrying the
 * screen's primary content.
 *
 * If the two ever visibly diverge, collapse this back into GLASS_PANEL rather than tuning
 * it. Two blur radii is the most this system should ever carry, and one is better.
 */
export const GLASS_PANEL_SOFT = [
  "bg-white/5 backdrop-blur-md backdrop-saturate-[2.2]",
  "border border-white/10",
  "shadow-[inset_0_1px_0_rgba(255,255,255,0.09)]",
].join(" ");

/** Panes on surfaces that SCROLL - the library grid. No backdrop-filter: scrolling
 * invalidates a cached blur on every frame just as reliably as an animated background does,
 * and this page is a grid of up to thirty covers. The fill is raised to compensate, so the
 * material still reads as the same glass. */
export const GLASS_STATIC = [
  "bg-white/[0.06]",
  "border border-white/10",
  "shadow-[inset_0_1px_0_rgba(255,255,255,0.09)]",
].join(" ");

/** Type. Three values, and the ramp stops well clear of AA rather than at it: measured on
 * pure black, white is 21:1, /70 is 10.2:1, /60 is 7.4:1. The floor for anything that is
 * real prose is /60; /40 is for chrome a reader never has to decode. */
export const TEXT_PRIMARY = "text-white";
export const TEXT_BODY = "text-white/70";
export const TEXT_MUTED = "text-white/60";
export const TEXT_FAINT = "text-white/40";

/** The eyebrow: a widget's label, set small, tracked wide and in caps so it reads as
 * furniture rather than as a heading competing with the content under it. */
export const EYEBROW = "text-[10px] font-medium uppercase tracking-[0.18em] text-white/40";

/** THE LOGO VOICE. Geist at 600 with tight tracking - the app's own UI sans, already
 * loaded, which is the point.
 *
 * The shell used to set the wordmark in Pacifico, a cursive script. It survives on the
 * marketing page and in the desktop Navbar, where a signature-like mark is doing a
 * different job for a different audience; inside the app it was the one element arguing a
 * personality the rest of the screen had spent its whole budget not having. Geist is the
 * "clean modern premium sans" the brief asks for and costs zero additional bytes, where
 * pulling in Inter would ship a second UI grotesk alongside the one already here.
 */
export const WORDMARK = "font-sans text-[17px] font-semibold tracking-[-0.02em] text-white";

/** THE SCREEN TITLE. One voice for "where you are", on every tab of the app.
 *
 * The shell had three treatments for one object: `text-[28px]` at -0.03em (Library),
 * `text-2xl` at `tracking-tight` (Ingest, Account), a `font-bold` variant on Account's
 * signed-out state, and no title at all on the Reader. Three sizes, three tracking
 * values, two weights, one screen with nothing - which is what made moving between tabs
 * feel like moving between apps.
 *
 * SERIF, BECAUSE THE TITLES ARE SINGLE WORDS. The website's headlines are two-voice - a
 * sans statement handing its clause to an italic serif ("Answer it / *before you're
 * told*"). "Library" has no clause to hand over, so the pattern cannot be copied
 * literally. What carries across instead is the FACE: chrome stays sans, screen identity
 * becomes Newsreader, and the app inherits the site's voice without pretending to a
 * structure its labels do not have.
 *
 * `font-normal italic` IS LOAD-BEARING, NOT STYLING. Newsreader is loaded italic at
 * weight 400 and nothing else (layout.tsx). An `<h1>` that inherits or sets 600 has no
 * real weight to reach for, so the browser SYNTHESISES one and smears the italic. The
 * fallback stack behind it (Georgia, Times) does have real weights, which is worse: the
 * bug then appears only once the webfont loads, i.e. never in the first paint you would
 * screenshot to check it.
 *
 * ---------------------------------------------------------------------------
 * IT CARRIES NO TEXT COLOUR, AND THAT IS THE IMPORTANT PART.
 * ---------------------------------------------------------------------------
 * Every other constant in this file hardcodes white, because the Spatial Glass world is
 * pure black and always will be. This one is used outside that world too: Account is the
 * single screen in the app that genuinely re-themes - it OWNS the Appearance setting
 * (getTheme/setTheme) and is built on the semantic tokens rather than on literals.
 *
 * Baking `text-white` in here would therefore paint the Account title white-on-near-white
 * in light mode - on the exact screen that offers the switch, which is the one place such
 * a bug is guaranteed to be found by a user rather than by us. So the call site supplies
 * the colour: `text-white` on the dark-only screens, `text-foreground` on the themed ones.
 *
 * That is a deliberate exception to this file's "literal Tailwind utilities and nothing
 * else" rule rather than a hole in it: the rule exists because a SCOPED custom property
 * (--au-*, --nk-*) fails to inherit to siblings of <main>. `--foreground` is defined on
 * :root, inherits everywhere, and is not what that rule was written about. */
export const SCREEN_TITLE =
  "font-editorial text-[30px] font-normal italic leading-none tracking-[-0.01em]";

/** Interaction, as CSS. No JS animation runs anywhere in this shell except the upload
 * sheet's drag gesture, which tracks a finger in real time and has no CSS equivalent. */
export const TRANSITION = "transition-all duration-300 ease-out";
export const PRESS = `${TRANSITION} active:scale-[0.97]`;
export const TAP = `${TRANSITION} active:scale-95`;

/** The easing the upload sheet enters and leaves on - expo-out, so it covers most of its
 * distance immediately then settles, which is what makes a sheet read as heavy. */
export const GLIDE = [0.19, 1, 0.22, 1] as const;

/** Focus ring. White, because this world has no accent to spend on one. */
export const FOCUS =
  "outline-none focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:ring-offset-2 focus-visible:ring-offset-black";
