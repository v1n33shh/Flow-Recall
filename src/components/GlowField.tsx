import FilmGrain from "@/components/FilmGrain";
import { MESH_BACKGROUND_IMAGE } from "@/lib/spatial";

/** The shell's ground: pure OLED black, a mesh that is almost not there, and grain.
 *
 * PURE BLACK, AND IT IS `bg-black` RATHER THAN A NEAR-BLACK TOKEN. On the OLED panels this
 * ships to, #000 switches pixels off - the panes appear to float in unlit space rather than
 * sit on a dark grey card, and it draws no power doing it.
 *
 * THE HUE IS BACK, AND NOT IN THE WAY IT WAS BEFORE. This layer has been, in order: an
 * animated three-curtain aurora (indigo/cyan/violet), a static icy-blue glow, a gold sheen,
 * and then nothing but white at 3.5%. Each of the first three was removed for the same
 * reason, recorded at DESIGN.md:107 - at the alpha a glow needs, chroma carries where
 * luminance does not, so the colour stopped being a light source and became a tint over the
 * whole upper page.
 *
 * What is different now is not the taste, it is where the colour is allowed to become
 * visible. The mesh below peaks around rgb(12,6,24) composited - about one 8-bit step off
 * black, which is to say invisible as a wash, by construction. The panes above it carry
 * `backdrop-saturate-[2.2]` (see spatial.ts), and a saturate filter scales chroma around
 * luma: it cannot invent a colour that is not there, and it roughly doubles one that is. So
 * the violet/cyan/coral resolves INSIDE a frosted pane and nowhere else. The failure mode
 * the three earlier versions hit - colour on the canvas - is not reachable from here,
 * because the canvas value is below threshold whether the panes exist or not.
 *
 * WHY IT IS NOT SIMPLY NOTHING. `backdrop-blur` blurs what is behind the pane, and over a
 * flat #000 there is nothing to blur - every "glass" surface would resolve to a flat 5%
 * white fill, which is a rectangle, not a material. Before the mesh this div held one white
 * sheen doing that job alone; the sheen is still here, still on top, and the mesh is what
 * gives the 64px filter something with structure to work on.
 *
 * NEVER ANIMATED. The previous world learned the hard way that a MOVING backdrop
 * invalidates every backdrop-filter above it on every frame, so a moving background does
 * not cost its own paint, it costs everyone else's blur. One background-image, painted once.
 *
 * Delete the first div and the screen still works. It just goes matte, and the glass stops
 * being glass.
 *
 * NOT a client component: no "use client", no hooks, no JS, nothing in the bundle.
 *
 * FilmGrain stays as a dither rather than a texture - a gradient falling from 10% to
 * nothing across half a screen spans about one 8-bit step and bands in visible rings
 * without it. Also a static background-image, so it reintroduces nothing.
 */
export default function GlowField() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 bg-black">
      <div className="absolute inset-0" style={{ backgroundImage: MESH_BACKGROUND_IMAGE }} />
      <FilmGrain />
    </div>
  );
}
