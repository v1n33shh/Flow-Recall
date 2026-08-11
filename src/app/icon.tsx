import { ImageResponse } from "next/og";

// Required by `output: export` (Capacitor build) - deterministic already, this
// just makes it explicit. No effect on the web deployment.
export const dynamic = "force-static";

// Browser tab favicon. Same dark tile + flat white "Flag Mark" as
// apple-icon.tsx and the Android launcher icon, so the brand mark reads
// identically everywhere rather than relying on a transparent shape that
// disappears against a same-toned browser chrome.

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

const LOGO_SVG = `<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 32 32'>
  <rect width='32' height='32' fill='#050505'/>
  <path d='M9,6 L24,6 L24,13 L14.5,13 L14.5,27 L11.75,21.5 L9,27 Z' fill='#FAFAFA'/>
</svg>`;

export default function Icon() {
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
        <img width={32} height={32} src={src} alt="FlowRecall" />
      </div>
    ),
    { ...size },
  );
}
