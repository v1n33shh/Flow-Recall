import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Pacifico } from "next/font/google";
import { SessionProvider } from "next-auth/react";
import Navbar from "@/components/Navbar";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Retro cursive display font for the logo and landing headings.
const pacifico = Pacifico({
  weight: "400",
  variable: "--font-pacifico",
  subsets: ["latin"],
});

// Absolute origin every social/SEO URL is resolved against. Override per
// environment with NEXT_PUBLIC_SITE_URL (e.g. your production domain); the
// fallback keeps builds and local dev working without extra config.
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://flowrecall.app";

const title = "FlowRecall | The Ultimate Active Recall Engine";
const description =
  "FlowRecall turns any PDF or block of text into hundreds of bite-sized recall challenges, served in an infinite feed you actually want to open. Powered by Groq - free, no credit card, blazing fast on any device.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  // `default` is the premium title; `template` suffixes any child page that
  // sets its own title (e.g. "Pricing" -> "Pricing | FlowRecall").
  title: {
    default: "FlowRecall | AI Flashcards & Active Recall App",
    template: "%s | FlowRecall",
  },
  description: "Upload any PDF and instantly convert it into a gamified active recall study feed. The ultimate AI study app for college and medical students.",
  applicationName: "FlowRecall",
  keywords: [
    "active recall app",
    "AI flashcards generator",
    "study faster",
    "PDF to flashcards",
    "spaced repetition",
    "Anki alternative",
    "exam prep",
  ],
  authors: [{ name: "FlowRecall" }],
  creator: "FlowRecall",
  publisher: "FlowRecall",
  // Let search engines fully index the marketing surface.
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  // Open Graph drives the rich preview card on iMessage, WhatsApp, Slack,
  // Discord, LinkedIn, Facebook - i.e. whenever the link gets texted.
  openGraph: {
    type: "website",
    siteName: "FlowRecall",
    title,
    description,
    url: siteUrl,
    locale: "en_US",
    images: [
      {
        url: "/og.png", // resolved against metadataBase -> absolute URL
        width: 1200,
        height: 630,
        alt: "FlowRecall - active recall, disguised as an infinite scroll.",
      },
    ],
  },
  // Twitter/X card. `summary_large_image` gives the full-bleed banner preview.
  twitter: {
    card: "summary_large_image",
    title,
    description,
    creator: "@flowrecall",
    images: ["/og.png"],
  },
  category: "education",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#0A0A0A",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${pacifico.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-matte text-zinc-300 font-sans">
        <SessionProvider>
          <Navbar />
          <div className="flex flex-1 flex-col">{children}</div>
        </SessionProvider>
      </body>
    </html>
  );
}
