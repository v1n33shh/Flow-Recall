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
 */

/** The spatial pane. Cards, widgets, panels - anything that holds content.
 *
 * `backdrop-blur-3xl` is 64px, and it is affordable here only because the background under
 * it never moves: a blur over a static backdrop is computed once and cached, where a blur
 * over an animated one is recomputed every frame. That lesson cost this shell a whole
 * revision; see DESIGN.md.
 */
export const GLASS_PANEL = [
  "bg-white/5 backdrop-blur-3xl",
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
  "bg-white/10 backdrop-blur-2xl",
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
  "bg-white/5 backdrop-blur-md",
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
