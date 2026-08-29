import { existsSync, renameSync, rmSync, statSync } from "node:fs";
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
const outDir = `${root}/out`;
// The release APK lives in /public so the website can offer it as a direct
// download. /public is copied wholesale into the static export, and the export
// is what gets bundled into the APK - so left alone, every build packs the
// PREVIOUS APK inside the new one. It compounded unnoticed across four builds
// this way: 6MB, 12MB, 17MB, 23.7MB, each one carrying its ancestors.
const bundledApk = "flowrecall-release.apk";

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

  // next build does not clear the export directory, so chunks from earlier
  // builds survive in it and can still be referenced. Start from nothing.
  rmSync(outDir, { recursive: true, force: true });

  const build = spawnSync("npx", ["next", "build"], {
    stdio: "inherit",
    env: { ...process.env, BUILD_TARGET: "capacitor" },
  });
  exitCode = build.status ?? 1;
} finally {
  restore();
}

if (exitCode !== 0) process.exit(exitCode);

// Drop the previous release APK before cap sync copies the export into the
// Android project. The web deploy still serves it from /public; only the phone
// has no use for a copy of the app inside the app.
const exportedApk = `${outDir}/${bundledApk}`;
if (existsSync(exportedApk)) {
  const megabytes = (statSync(exportedApk).size / 1024 / 1024).toFixed(1);
  rmSync(exportedApk);
  console.log(`Excluded ${bundledApk} (${megabytes} MB) from the Android bundle`);
}

const sync = spawnSync("npx", ["cap", "sync", "android"], { stdio: "inherit" });
process.exit(sync.status ?? 0);
