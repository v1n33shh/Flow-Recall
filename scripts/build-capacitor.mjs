import { existsSync, renameSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

// `output: 'export'` walks every route under src/app, including src/app/api -
// but those route handlers are genuinely dynamic (NextAuth, Stripe/Razorpay
// webhooks, Prisma reads) and can never be statically exported. They keep
// running live on Vercel; the Capacitor shell calls them cross-origin (see
// src/lib/apiUrl.ts). Since Next has no "exclude this subtree" build flag,
// the API routes are moved out of src/app for the duration of this build and
// always restored afterward, success or failure.
const root = fileURLToPath(new URL("..", import.meta.url));
const apiDir = `${root}/src/app/api`;
const apiBackup = `${root}/.capacitor-api-backup`;

if (existsSync(apiBackup)) {
  throw new Error(
    `${apiBackup} already exists - a previous build:apk run may have been interrupted before restoring src/app/api. Resolve manually before retrying.`,
  );
}

renameSync(apiDir, apiBackup);

function restore() {
  if (existsSync(apiBackup)) renameSync(apiBackup, apiDir);
}

process.on("SIGINT", () => {
  restore();
  process.exit(130);
});

// process.exit() does not run pending `finally` blocks, so restore() must be
// called explicitly on every exit path rather than relied on via try/finally.
let exitCode = 0;
try {
  // `npm run build` does this before `next build`; this script bypasses that
  // script (it needs BUILD_TARGET set), so it has to do the same itself - the
  // PDF extraction worker in /public is a build input, not a build output.
  const assets = spawnSync("node", ["scripts/copy-pdf-worker.mjs"], {
    stdio: "inherit",
    cwd: root,
  });
  if (assets.status !== 0) throw new Error("Failed to prepare PDF assets");

  const build = spawnSync("npx", ["next", "build"], {
    stdio: "inherit",
    env: { ...process.env, BUILD_TARGET: "capacitor" },
  });
  exitCode = build.status ?? 1;
} finally {
  restore();
}

if (exitCode !== 0) process.exit(exitCode);

const sync = spawnSync("npx", ["cap", "sync", "android"], { stdio: "inherit" });
process.exit(sync.status ?? 0);
