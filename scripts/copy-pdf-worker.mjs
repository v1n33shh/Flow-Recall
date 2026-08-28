import { cpSync } from "node:fs";
import { fileURLToPath } from "node:url";

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
