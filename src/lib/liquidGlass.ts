/** "Liquid Glass & Ethereal Cyberpunk" — the design layer for FlowStateHub.
 *
 * WHERE THIS COMES FROM. Three published references on styles.refero.design, read in
 * full rather than inferred from thumbnails:
 *
 *   Auros — "Abyssal terminal with bioluminescent data orbs"
 *     https://styles.refero.design/style/21cfe0c1-778d-4613-9f47-a5718eb929b3
 *     A surface stack that reads as depth-of-water rather than shadow-on-paper, colour
 *     rationed to atmospheric gradients, pale phosphor reserved for large statistics,
 *     display type at ONE medium weight, no shadows anywhere.
 *
 *   monopo saigon — "Liquid iridescence behind editorial silence"
 *     https://styles.refero.design/style/3e52dd36-6ab1-48c6-bc40-47ef6d33abc2
 *     A monochrome interface floating on a river of liquid light; radius vocabulary of
 *     exactly two values (0 and full pill); motion on cubic-bezier(0.19, 1, 0.22, 1)
 *     over 0.8–1.25s so elements glide rather than snap; never bold at display sizes.
 *
 *   Air — "midnight sky through glass sculpture"
 *     https://styles.refero.design/style/d3289fe7-a85e-42d8-96b7-eb7faa62a104
 *     One desaturated steel blue as the only chromatic text colour; "cards float on the
 *     dark canvas by virtue of being lighter, not by casting shadows".
 *
 * THE RULE ALL THREE CONVERGE ON, independently, and the one this screen is built around:
 * COLOUR IS MEDIA, NEVER INTERFACE. monopo: "never introduce a chromatic UI colour — the
 * iridescent gradient is media only". Auros: "colour is rationed — achromatic whites and
 * silvers carry almost all content, the chromatic palette is reserved for atmospheric
 * gradients". Air: one blue, atmosphere only. So every orb below is background; every
 * control on top of them is white, silver, or a 10%-alpha hairline. That is also exactly
 * what the brief asked for, which is a good sign rather than a coincidence.
 *
 * THE SECOND RULE ALL THREE SHARE: NO BOX-SHADOW. Depth is surface lift plus hairline.
 * The glow on this screen is light from the orbs BEHIND the glass, never a shadow cast by
 * the glass — which is also why it survives the repo's performance contract.
 *
 * SCOPED, like every other palette in this app. These are `--lg-*` custom properties
 * spread onto the hub's root, not globals.css's semantic tokens — that layer is
 * documented as "Pure Monochrome ... NO color anywhere" and must not be dragged into a
 * cyberpunk palette by a screen that opts in. Nothing outside FlowStateHub can see these.
 */

import type { CSSProperties } from "react";

/** The scoped palette, as raw HSL channels so `hsl(var(--x) / 0.4)` composes. */
export const LIQUID_VARS = {
  // --- The abyss. Auros's surface stack, re-hued from its teal to the brief's blue.
  "--lg-abyss": "230 40% 2%", //    #04050b  the canvas everything floats on
  "--lg-deep": "230 32% 5%", //     #0a0c14  recessed wells
  "--lg-lift": "230 24% 9%", //     #12141c  the raised glass surface's opaque fallback

  // --- Type. Auros's rule, quoted: pure white for headings only, silver for everything
  //     else. Never white body copy on a dark canvas.
  "--lg-platinum": "0 0% 100%", //  #ffffff  headings, the streak numeral
  "--lg-silver": "215 14% 76%", //  #bbc2cd  secondary text, labels, inactive marks
  "--lg-slate": "220 10% 45%", //   #686d78  tertiary / spent states

  // --- THE ATMOSPHERE. The only chromatic values in the file, and they appear exclusively
  //     inside orbs and washes that sit BEHIND glass — never as a fill, border or text
  //     colour on a control. Bioluminescent blue through violet, per the brief; the
  //     structure (a two-stop liquid sweep) is Auros's signature gesture re-hued.
  "--lg-biolume": "205 100% 55%", //#1a9fff  cold bioluminescent blue
  "--lg-violet": "265 90% 62%", //  #8b4bf5  deep ultraviolet
  "--lg-phosphor": "280 100% 92%", //#f6d9ff Auros's Lavender Phosphor — LARGE FIGURES ONLY
} as CSSProperties;

/** monopo's easing, to the digit: cubic-bezier(0.19, 1, 0.22, 1) — an expo-out curve that
 * covers most of its distance immediately and then settles for a long time. It is what
 * makes their motion read as heavy and liquid rather than eager, and it is the single
 * most copyable thing about that site. Durations live at the call site, 0.8–1.25s. */
export const GLIDE = [0.19, 1, 0.22, 1] as const;

/** Press physics. Low stiffness + high damping = a heavy object that does not ring.
 * The brief asked for "heavy and incredibly responsive", which are in tension: stiffness
 * buys responsiveness, damping buys weight. 260/30 is the point where a tap registers
 * instantly but the release still settles rather than snapping back. */
export const PRESS = { type: "spring" as const, stiffness: 260, damping: 30, mass: 1.1 } as const;

/** Magnet physics, deliberately softer and heavier than PRESS. The button should LAG the
 * pointer — that lag is the whole illusion of mass. Stiffer than ~150 and it tracks the
 * finger exactly, which reads as a bug rather than as magnetism. */
export const MAGNET = { type: "spring" as const, stiffness: 120, damping: 18, mass: 1.4 } as const;

/** How far the button is allowed to leave its layout position, in px. Small on purpose:
 * past ~14px the glass visibly separates from its own hairline and the effect stops
 * reading as attraction and starts reading as a dropped element. */
export const MAGNET_RADIUS = 12;

/** Glass. `backdrop-blur-3xl` per the brief.
 *
 * PERFORMANCE NOTE, because this is the one place the brief and this repo's measured
 * constraints genuinely collide. Every other glass surface in this codebase gates
 * backdrop-blur behind `md:` (see page.tsx's CARD and thirteen other call sites) because
 * it janks scroll on the cheap Android hardware this app ships to through Capacitor. Two
 * things make it defensible here and one thing still needs measuring:
 *   - This screen does not scroll. It is a fixed, single-viewport hub, so the specific
 *     failure those call sites were guarding against cannot occur.
 *   - The orbs behind the glass animate, which means the backdrop is dirty every frame
 *     and the blur re-resolves every frame. That is the real cost, and it is why the orb
 *     transforms below run on 26–38s cycles: even at a degraded frame rate the motion
 *     still reads as intentional drift rather than as stutter.
 *   - It should still be profiled on the slowest target device. If it proves too costly,
 *     change `backdrop-blur-3xl` to `backdrop-blur-md` HERE and every glass surface on
 *     the screen follows; the design survives it, because the depth is really coming from
 *     the surface lift and the hairline, exactly as all three references say it should.
 */
export const GLASS = [
  "bg-[hsl(var(--lg-platinum)/0.04)] backdrop-blur-3xl",
  "border border-white/10",
  // No box-shadow. All three references forbid elevation outright; the light on this
  // screen comes from the orbs behind the glass, not from anything the glass casts.
  // The inset hairline is a highlight, not a shadow - it is how a real pane catches light.
  "shadow-[inset_0_1px_0_hsl(var(--lg-platinum)/0.08)]",
].join(" ");

