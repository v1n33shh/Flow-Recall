import type { MetadataRoute } from "next";

// Required by `output: export` (Capacitor build) - see sitemap.ts. No effect
// on the web deployment.
export const dynamic = "force-static";

// Keep in sync with layout.tsx's metadataBase and sitemap.ts.
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.flowrecall.app";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // App/authenticated surfaces carry no SEO value and waste crawl budget:
      // the API layer, the full-bleed study feed, the revision sheet (which
      // renders nothing without a deck handoff in sessionStorage), and the
      // account area.
      disallow: ["/api/", "/study", "/revise", "/account"],
    },
    sitemap: `${siteUrl}/sitemap.xml`,
    host: siteUrl,
  };
}
