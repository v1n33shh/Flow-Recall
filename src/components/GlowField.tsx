import FilmGrain from "@/components/FilmGrain";

/** The shell's ground: pure OLED black, one static achromatic sheen, and grain.
 *
 * PURE BLACK, AND IT IS `bg-black` RATHER THAN A NEAR-BLACK TOKEN. On the OLED panels this
 * ships to, #000 switches pixels off - the panes appear to float in unlit space rather than
 * sit on a dark grey card, and it draws no power doing it.
 *
 * NO HUE. This layer has been, in order: an animated three-curtain aurora (indigo/cyan/
 * violet), a static icy-blue glow, and a gold sheen. All three are gone. What is left is
 * white at 3.5% peak, which is not a colour so much as a suggestion that the room has a
 * light in it somewhere off the top-left.
 *
 * WHY IT IS NOT SIMPLY NOTHING. `backdrop-blur` blurs what is behind the pane, and over a
 * flat #000 there is nothing to blur - every "glass" surface on the home screen would
 * resolve to a flat 5% white fill, which is a rectangle, not a material. This sheen is what
 * the panes on this screen actually refract. It is one `background-image`, painted once,
 * never animated: the previous world learned the hard way that a MOVING backdrop
 * invalidates every backdrop-filter above it on every frame, so a moving background does
 * not cost its own paint, it costs everyone else's blur.
 *
 * Delete the first div and the screen still works. It just goes matte, and the glass stops
 * being glass.
 *
 * NOT a client component: no "use client", no hooks, no JS, nothing in the bundle.
 *
 * FilmGrain stays as a dither rather than a texture - a gradient falling from 3.5% to
 * nothing across half a screen spans about one 8-bit step and bands in visible rings
 * without it. Also a static background-image, so it reintroduces nothing.
 */
export default function GlowField() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 bg-black">
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            "radial-gradient(120% 85% at 0% 0%, rgba(255,255,255,0.035) 0%, rgba(255,255,255,0.014) 26%, rgba(255,255,255,0.004) 42%, transparent 60%)",
        }}
      />
      <FilmGrain />
    </div>
  );
}
