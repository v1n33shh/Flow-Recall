// Cinematic film grain - a fixed noise texture over the whole viewport, giving the black a
// physical, filmic surface instead of a flat void. A static background-image, no
// filter/blur animation, so it costs one paint on any device and is never gated to desktop.
//
// 0.20, AND THE NUMBER COST THE TEXT RAMP A STEP TO GET THERE.
//
// This value has been argued twice. The first time it went to 0.08 with the note that 20%
// fractal noise "drops effective contrast on text-white/60 by roughly a stop" - true, and
// the wrong conclusion, because the fix is not a quieter grain, it is a body colour that
// accounts for the ground the grain creates.
//
// The arithmetic, since it decides the value: fractal noise averages ~50% luminance, so at
// alpha 0.20 over #000 the ground composites to a mean of about #1a1a1a rather than pure
// black. Body copy at white/50 (#808080) reads 4.39:1 against that - under the 4.5:1 floor.
// At white/60 (#999999) it is 6.08:1, which is BETTER than the 5.32:1 the old /50 managed on
// flat black. So the page took the full grain the brief asked for and got more readable
// doing it, which is the only version of this trade worth making.
//
// The display clause "Stop re-reading." moved /40 -> /45 for the same reason: 3.02:1 against
// the grained ground is inside the 3:1 large-text floor by nothing at all, and 3.69:1 is not.
//
// TO PUSH IT FURTHER: this one value, and then re-measure the ramp in src/app/page.tsx.
// Nothing else reads it, and nothing else compensates for it.
//
// Extracted from src/app/page.tsx when /library gained the same treatment: the
// inline fractal-noise SVG below is a ~330-character data URI, and two copies of
// it would drift the moment either page's grain was retuned.
//
// Kept as a data URI applied via inline style rather than a Tailwind arbitrary
// class so the SVG's quotes and percent-signs don't have to survive class-name
// parsing.
const NOISE_BACKGROUND =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

export default function FilmGrain() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-0 opacity-20"
      style={{ backgroundImage: NOISE_BACKGROUND }}
    />
  );
}
