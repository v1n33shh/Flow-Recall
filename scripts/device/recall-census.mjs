import { chromium } from "playwright";

// Dump the recall engine's IndexedDB stores from the device: units, per-(unit x
// path) memory, and the append-only review log. The reader's equivalent is
// census.mjs; this is the one to run before and after any engine change, and
// especially before clearing test data, so "what did the scheduler actually
// write" is a measurement rather than a belief.
//
// Usage: node scripts/device/recall-census.mjs [--full]
//   --full  print whole records instead of the summarised view.

const browser = await chromium.connectOverCDP("http://localhost:9222");
const page = browser.contexts()[0].pages()[0];
const full = process.argv.includes("--full");

const out = await page.evaluate(async (full) => {
  const open = (name) =>
    new Promise((res, rej) => {
      const r = indexedDB.open(name);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  const all = (db, store) =>
    new Promise((res, rej) => {
      if (!db.objectStoreNames.contains(store)) return res([]);
      const t = db.transaction(store, "readonly").objectStore(store).getAll();
      t.onsuccess = () => res(t.result);
      t.onerror = () => rej(t.error);
    });

  const names = (await indexedDB.databases()).map((d) => d.name);
  if (!names.includes("flowrecall-recall")) return { present: false, databases: names };

  const db = await open("flowrecall-recall");
  const units = await all(db, "units");
  const memory = await all(db, "memory");
  const reviews = await all(db, "reviews");
  reviews.sort((a, b) => a.reviewedAt - b.reviewedAt);

  if (full) return { present: true, units, memory, reviews };

  const round = (n, p = 4) => (typeof n === "number" ? Number(n.toFixed(p)) : n);
  return {
    present: true,
    stores: [...db.objectStoreNames],
    counts: { units: units.length, memory: memory.length, reviews: reviews.length },
    migrated: localStorage.getItem("flowrecall:recall-migrated"),
    units: units.map((u) => ({ id: u.id, label: u.label, importance: u.importance })),
    // `confidence` is spread onto a review only when the student answered the
    // question, so "(absent)" here is the correct reading for every other row -
    // it must stay distinguishable from an answered "guessed".
    reviews: reviews.map((r) => ({
      unit: r.unitId.slice(-12),
      path: r.path,
      grade: r.grade,
      correct: r.correct,
      credited: r.credited,
      latencyMs: r.latencyMs,
      confidence: "confidence" in r ? r.confidence : "(absent)",
      sBefore: round(r.stabilityBefore),
      sAfter: round(r.stabilityAfter),
      at: new Date(r.reviewedAt).toISOString(),
    })),
    memory: memory.map((m) => ({
      unit: m.unitId.slice(-12),
      path: m.path,
      stability: round(m.stability),
      difficulty: round(m.difficulty, 3),
      reps: m.reps,
      lapses: m.lapses,
      desiredRetention: m.desiredRetention,
      due: new Date(m.dueAt).toISOString(),
    })),
  };
}, full);

console.log(JSON.stringify(out, null, 1));
await browser.close();
