import type { NextConfig } from "next";
import { version } from "./package.json";

// The Vercel deployment (`next build`) and the Capacitor Android shell
// (`BUILD_TARGET=capacitor next build`) come from the same source but need
// incompatible config: `output: 'export'` can't coexist with `headers()` or
// the default (server-side) image loader - see
// node_modules/next/dist/docs/01-app/02-guides/static-exports.md, "Unsupported
// Features". The exported shell has no Next.js server behind it at all; the
// live API routes/DB/AI keys stay on Vercel and are called cross-origin via
// NEXT_PUBLIC_API_URL (see src/lib/apiUrl.ts).
const isCapacitorBuild = process.env.BUILD_TARGET === "capacitor";

// Inlined at build time so the native Account screen's version footer always
// matches whatever was actually shipped, without hand-editing it per release.
const env = { NEXT_PUBLIC_APP_VERSION: version };

const nextConfig: NextConfig = isCapacitorBuild
  ? {
      output: "export",
      // No image optimization server exists on-device; ship avatars as-is.
      images: { unoptimized: true },
      env,
    }
  : {
      env,
      async headers() {
        return [
          {
            source: '/(.*)',
            headers: [
              {
                key: 'X-Content-Type-Options',
                value: 'nosniff',
              },
              {
                key: 'X-Frame-Options',
                value: 'DENY',
              },
              {
                key: 'Referrer-Policy',
                value: 'strict-origin-when-cross-origin',
              },
              {
                // img-src/font-src/frame-src gained `blob:` for the EPUB reader:
                // epub.js rewrites images/embedded fonts inside a book to blob:
                // object URLs, and renders each chapter into a blob: iframe.
                // style-src/font-src also gained the two Google Fonts hosts for
                // the reader's Display Settings menu ("Modern Sans"/"Legible") -
                // that stylesheet has to be a real <link> (not next/font) so it
                // can be re-injected as-is into epub.js's own sandboxed content
                // iframes, which don't inherit next/font's self-hosted @font-face
                // rules from the parent document.
                key: 'Content-Security-Policy',
                value: "default-src 'self'; script-src 'self' 'unsafe-eval' 'unsafe-inline' https://js.stripe.com https://checkout.razorpay.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: blob: https://lh3.googleusercontent.com https://avatars.githubusercontent.com; font-src 'self' data: blob: https://fonts.gstatic.com; connect-src 'self' https://api.stripe.com https://api.razorpay.com; frame-src 'self' blob: https://js.stripe.com https://api.razorpay.com;",
              },
            ],
          },
        ];
      },
      images: {
        remotePatterns: [
          {
            protocol: 'https',
            hostname: 'lh3.googleusercontent.com',
            pathname: '**',
          },
          {
            protocol: 'https',
            hostname: 'avatars.githubusercontent.com',
            pathname: '**',
          },
        ],
      },
    };

export default nextConfig;
