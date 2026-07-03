import { copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

copyFileSync(
  `${root}/node_modules/pdfjs-dist/build/pdf.worker.min.mjs`,
  `${root}/public/pdf.worker.min.mjs`,
);
