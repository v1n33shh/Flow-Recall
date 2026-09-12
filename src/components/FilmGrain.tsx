// Cinematic film grain - a fixed noise texture over the whole viewport, giving the black a
// physical, filmic surface instead of a flat void. A static background-image, no
// filter/blur animation, so it costs one paint on any device and is never gated to desktop.
//
// 0.08, NOT 0.20, AND THE NUMBER IS THE WHOLE DECISION. The brief asked for "opacity-20 or
// similar". Twenty percent fractal noise over 14px body copy is not film grain, it is
// snow: it drops effective contrast on `text-white/60` by roughly a stop and turns small
// type mushy on exactly the cheap Android panels this app ships to. Real cinematic grain
// lives around 3-8%, and this sits at the top of that range - three times what it was, and
// clearly visible against the black, which is what the brief actually wanted.
//
// TO PUSH IT FURTHER: this one value. Nothing else reads it.
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
      className="pointer-events-none fixed inset-0 z-0 opacity-[0.08]"
      style={{ backgroundImage: NOISE_BACKGROUND }}
    />
  );
}
