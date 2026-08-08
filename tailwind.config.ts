import type { Config } from "tailwindcss";

// Tailwind v4 is CSS-configured; this legacy config is loaded via the
// `@config` directive in src/app/globals.css. The "Pure Monochrome" design
// tokens (background, surface, border, muted-foreground, foreground, accent,
// accent-foreground) live in globals.css under `@theme inline`, so there is
// nothing brand-specific to declare here anymore.
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
};

export default config;
