// Prepares the two things the PDF reader needs to exist as static assets
// before either `next dev` or `next build` runs:
//
//   1. pdf.js's own worker, plus its cmaps and standard fonts, copied out of
//      node_modules into /public.
//   2. src/workers/pdfExtract.worker.ts, bundled to /public as a plain ES
//      module (see below).
//
// Run from postinstall, `npm run dev`, `npm run build` and the Capacitor build.
import { cpSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildSync } from "esbuild";

const root = fileURLToPath(new URL("..", import.meta.url));

cpSync(
  `${root}/node_modules/pdfjs-dist/build/pdf.worker.min.mjs`,
  `${root}/public/pdf.worker.min.mjs`,
);

cpSync(
  `${root}/node_modules/pdfjs-dist/cmaps/`,
  `${root}/public/cmaps/`,
  { recursive: true }
);

cpSync(
  `${root}/node_modules/pdfjs-dist/standard_fonts/`,
  `${root}/public/standard_fonts/`,
  { recursive: true }
);

// The extraction worker is bundled here rather than by Next, because Turbopack
// does not treat `new Worker(new URL("./x.ts", import.meta.url))` as a worker
// entry point: it emits the file as a raw static asset, so the browser would be
// handed unparseable TypeScript and every book would silently fall back to
// extracting on the UI thread. Shipping it to /public alongside pdf.js's own
// worker keeps one source of truth (it imports src/lib/pdfTextExtract directly)
// and gives it a stable same-origin URL that works identically under
// `next build` and the Capacitor static export.
buildSync({
  entryPoints: [`${root}/src/workers/pdfExtract.worker.ts`],
  outfile: `${root}/public/pdfExtract.worker.js`,
  bundle: true,
  format: "esm",
  target: "es2020",
  platform: "browser",
  minify: true,
  legalComments: "none",
  define: { "process.env.NODE_ENV": '"production"' },
});
