// Cinematic film grain - a fixed noise texture over the whole viewport, giving the black a
// physical, filmic surface instead of a flat void. A static background-image, no
// filter/blur animation, so it costs one paint on any device and is never gated to desktop.
//
// 0.02, AND THIS VALUE HAS NOW BEEN SET THREE TIMES, SO HERE IS THE WHOLE ARGUMENT.
//
//   0.20  asked for, twice. Shipped once and looked at on a device: over a translucent
//         tab bar that is blurring whatever is behind it, 20% fractal noise does not read
//         as film, it reads as a dirty screen. That is the finding that settled it, and it
//         is not one the arithmetic below would ever have produced.
//   0.08  the compromise before that, argued from contrast alone.
//   0.02  here. Enough to dither a gradient, not enough to see as texture.
//
// THE POINT OF THE GRAIN WAS NEVER TEXTURE. It is a dither. A radial gradient falling from
// 7% white to nothing across a viewport spans roughly one 8-bit step, and without noise it
// bands into visible rings on exactly the cheap Android panels this app ships to. Breaking
// up that step needs a couple of percent, not twenty; everything above ~0.05 is decoration,
// and decoration laid over the entire product including its chrome.
//
// THE TEXT RAMP KEEPS THE STEP THE 20% BUILD BOUGHT IT. Body copy went white/50 -> /60 and
// the display clause /40 -> /45 to stay legible against the lighter ground 20% noise
// creates. At 0.02 the ground is back to near-black, where /60 measures 7.4:1 instead of
// the 6.08:1 it managed under the heavy grain. Nothing needs reverting: the page is simply
// more readable than it was before either change.
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
      className="pointer-events-none fixed inset-0 z-0 opacity-[0.02]"
      style={{ backgroundImage: NOISE_BACKGROUND }}
    />
  );
}
