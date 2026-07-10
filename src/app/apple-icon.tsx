import { ImageResponse } from "next/og";

// iOS Home Screen icon. Apple touch icons must be PNG (iOS ignores SVG), so we
// rasterize the exact Navbar logo via ImageResponse. Full-bleed on purpose:
// iOS applies its own squircle mask, so baking in rounded corners would
// double-round. The dark zinc gradient + centered azure 'F' stay unified with
// icon.svg and the Navbar tile.

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

// Full-bleed 40-unit tile (no corner radius / border — iOS masks it), scaled to
// 180px. Single-quoted so it drops cleanly into a data URI. url(#grad-f) is
// percent-encoded below, so resvg rasterizes the gradient reliably.
const LOGO_SVG = `<svg xmlns='http://www.w3.org/2000/svg' width='180' height='180' viewBox='0 0 40 40' fill='none'>
  <defs>
    <linearGradient id='bg' x1='0' y1='0' x2='40' y2='40' gradientUnits='userSpaceOnUse'>
      <stop stop-color='#27272a'/>
      <stop offset='1' stop-color='#09090b'/>
    </linearGradient>
    <linearGradient id='sheen' x1='20' y1='0' x2='20' y2='15' gradientUnits='userSpaceOnUse'>
      <stop stop-color='#ffffff' stop-opacity='0.10'/>
      <stop offset='1' stop-color='#ffffff' stop-opacity='0'/>
    </linearGradient>
    <linearGradient id='grad-f' x1='8' y1='4' x2='18' y2='20' gradientUnits='userSpaceOnUse'>
      <stop stop-color='#3B82F6'/>
      <stop offset='1' stop-color='#93C5FD'/>
    </linearGradient>
  </defs>
  <rect width='40' height='40' fill='url(#bg)'/>
  <rect width='40' height='40' fill='url(#sheen)'/>
  <g transform='translate(8,8)' fill='none' stroke-width='3.5' stroke-linecap='round' stroke-linejoin='round'>
    <path d='M8 20V9a5 5 0 0 1 5-5h5' stroke='url(#grad-f)'/>
    <path d='M8 12h5' stroke='#F1F5F9'/>
  </g>
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
