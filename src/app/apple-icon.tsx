import { ImageResponse } from "next/og";

// Required by `output: export` (Capacitor build) - this generator is fully
// deterministic already (no request data, no randomness), so this only makes
// that explicit. No effect on the web deployment.
export const dynamic = "force-static";

// iOS Home Screen icon. Apple touch icons must be PNG (iOS ignores SVG), so we
// rasterize the brand mark via ImageResponse. Full-bleed on purpose: iOS
// applies its own squircle mask, so baking in rounded corners would
// double-round. Pure Monochrome: matte obsidian background (#050505, same
// token as globals.css --background) + the flat white "Flag Mark," stays
// unified with LogoMark.tsx and the Android adaptive icon foreground.

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

// Full-bleed 32-unit tile (no corner radius / border — iOS masks it), scaled
// to 180px. Same path as LogoMark.tsx and assets/icon.png so every surface
// (web, iOS, Android) renders the identical mark.
const LOGO_SVG = `<svg xmlns='http://www.w3.org/2000/svg' width='180' height='180' viewBox='0 0 32 32'>
  <rect width='32' height='32' fill='#050505'/>
  <path d='M9,6 L24,6 L24,13 L14.5,13 L14.5,27 L11.75,21.5 L9,27 Z' fill='#FAFAFA'/>
</svg>`;

export default function AppleIcon() {
  const src = `data:image/svg+xml;utf8,${encodeURIComponent(LOGO_SVG)}`;
  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          width: "100%",
          height: "100%",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <img width={180} height={180} src={src} alt="FlowRecall" />
      </div>
    ),
    { ...size },
  );
}
