import type { Config } from "tailwindcss";

// Tailwind v4 is CSS-configured; this legacy config is loaded via the
// `@config` directive in src/app/globals.css so the custom brand colors below
// generate utilities (bg-matte, text-gold, bg-graphite, ...).
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // "Black Card" luxury palette: matte black, gold, graphite card surface.
        gold: "#D4AF37",
        matte: "#0A0A0A",
        graphite: "#1A1A1A",
      },
    },
  },
};

export default config;
