import type { MetadataRoute } from "next";

// Keep in sync with layout.tsx's metadataBase and sitemap.ts.
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://flowrecall.app";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // App/authenticated surfaces carry no SEO value and waste crawl budget:
      // the API layer, the full-bleed study feed, and the account area.
      disallow: ["/api/", "/study", "/account"],
    },
    sitemap: `${siteUrl}/sitemap.xml`,
    host: siteUrl,
  };
}
