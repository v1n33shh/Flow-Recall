import type { MetadataRoute } from "next";

// Keep in sync with layout.tsx's metadataBase. Override per environment with
// NEXT_PUBLIC_SITE_URL (e.g. your production domain).
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://flowrecall.app";

// Evaluated once when this cached route is first built, so every URL reports a
// single stable lastmod instead of a per-request "just now" that crawlers learn
// to distrust. Only the public, indexable surface belongs here — the study feed
// and account area are user-private and are disallowed in robots.ts.
const lastModified = new Date();

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: siteUrl,
      lastModified,
      changeFrequency: "weekly",
      priority: 1, // Home — primary landing target ("AI flashcards")
    },
    {
      url: `${siteUrl}/ingest`,
      lastModified,
      changeFrequency: "monthly",
      priority: 0.9, // The core tool — highest-intent for "PDF to flashcards"
    },
    {
      url: `${siteUrl}/pricing`,
      lastModified,
      changeFrequency: "monthly",
      priority: 0.8,
    },
    {
      url: `${siteUrl}/register`,
      lastModified,
      changeFrequency: "yearly",
      priority: 0.5,
    },
    {
      url: `${siteUrl}/login`,
      lastModified,
      changeFrequency: "yearly",
      priority: 0.3, // Thin auth page — low crawl priority
    },
  ];
}
