import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Pacifico } from "next/font/google";
import { SessionProvider } from "next-auth/react";
import Navbar from "@/components/Navbar";
import MobileTabBar from "@/components/MobileTabBar";
import MobileAuthBridge from "@/components/MobileAuthBridge";
import SyncEngine from "@/components/SyncEngine";
import NativeAppClass from "@/components/NativeAppClass";
import PageTransition from "@/components/PageTransition";
import AppLoader from "@/components/AppLoader";
import { READER_FONTS_HREF } from "@/lib/readerPreferences";
import "./globals.css";

// Only set for the Capacitor build (see next.config.ts) - the exported shell
// has no `headers()` support, so the same CSP is inlined as a <meta> tag
// instead. connect-src is widened to the live API origin the shell talks to
// cross-origin (see src/lib/apiUrl.ts); the web deployment keeps its
// header-based CSP untouched.
const capacitorApiOrigin = process.env.NEXT_PUBLIC_API_URL ?? "";
const capacitorCsp = capacitorApiOrigin
  ? `default-src 'self'; script-src 'self' 'unsafe-eval' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: blob: https://lh3.googleusercontent.com https://avatars.githubusercontent.com; font-src 'self' data: blob: https://fonts.gstatic.com; connect-src 'self' ${capacitorApiOrigin}; frame-src 'self' blob:;`
  : null;

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
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.flowrecall.app";

// Social-share copy (OpenGraph + Twitter). Tuned for click-through when the
// link is dropped in Discord/WhatsApp/iMessage/X: a concrete hook, speed,
// an objection-killer, and one on-brand flame. Distinct from the SEO <title>.
const title = "FlowRecall — AI Flashcards, Disguised as Doomscrolling";
const description =
  "Drop in a lecture PDF and FlowRecall spins up hundreds of AI flashcards in seconds — then serves them as an addictive active-recall feed you actually want to open. Free, no credit card. 🔥";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  // `default` is the premium title; `template` suffixes any child page that
  // sets its own title (e.g. "Pricing" -> "Pricing | FlowRecall").
  title: {
    default: "FlowRecall | AI Flashcards & Active Recall App",
    template: "%s | FlowRecall",
  },
  verification: {
    google: "qYRwT2xoSO4AaBh5jekf8FycAYkbDaFisupynEu7t0Y",
  },
  description: "Upload any PDF and instantly convert it into a gamified active recall study feed. The ultimate AI study app for college and medical students.",
  applicationName: "FlowRecall",
  keywords: [
    "active recall app",
    "AI flashcards generator",
    "study faster",
    "PDF to flashcards",
    "retrieval practice",
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
  // Matches globals.css's --background (#050505) and the native Android
  // splash's windowSplashScreenBackground exactly - see AppLoader.tsx.
  themeColor: "#050505",
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
      <head>
        {capacitorCsp && <meta httpEquiv="Content-Security-Policy" content={capacitorCsp} />}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link rel="stylesheet" href={READER_FONTS_HREF} />
      </head>
      <body className="min-h-full flex flex-col bg-background text-foreground font-sans">
        <AppLoader />
        {/* refetchOnWindowFocus/refetchInterval=0 are next-auth's own defaults
            (see node_modules/next-auth/react.js) - spelled out explicitly so
            intent reads at the call site, but they don't change behavior on
            their own. The actual fix for cold-launch stale reads on native is
            MobileAuthBridge's forced getSession() (mount + Capacitor 'resume'). */}
        <SessionProvider
          basePath={`${capacitorApiOrigin}/api/auth`}
          refetchOnWindowFocus={true}
          refetchInterval={0}
        >
          <NativeAppClass />
          <MobileAuthBridge />
          <SyncEngine />
          <Navbar />
          <PageTransition>{children}</PageTransition>
          <MobileTabBar />
        </SessionProvider>
      </body>
    </html>
  );
}
