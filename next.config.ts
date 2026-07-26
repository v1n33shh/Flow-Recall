import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
