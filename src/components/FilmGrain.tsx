// Cinematic film grain - a fixed, whisper-faint noise texture over the whole
// viewport for a physical, filmic surface. A static background-image at 3%
// opacity, no filter/blur animation, so it costs nothing on any device and is
// never gated to desktop.
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
      className="pointer-events-none fixed inset-0 z-0 opacity-[0.03]"
      style={{ backgroundImage: NOISE_BACKGROUND }}
    />
  );
}
