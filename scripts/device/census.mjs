import { chromium } from "playwright";
const browser = await chromium.connectOverCDP("http://localhost:9222");
const page = browser.contexts()[0].pages()[0];
console.log(JSON.stringify(await page.evaluate(async () => {
  const open = (name) => new Promise((res, rej) => {
    const r = indexedDB.open(name);
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  const all = (db, store) => new Promise((res, rej) => {
    if (!db.objectStoreNames.contains(store)) return res("(no such store)");
    const t = db.transaction(store, "readonly").objectStore(store).getAll();
    t.onsuccess = () => res(t.result); t.onerror = () => rej(t.error);
  });
  const db = await open("flowrecall-reader");
  const stores = Array.from(db.objectStoreNames);
  const out = { stores };
  for (const s of stores) {
    const rows = await all(db, s);
    if (!Array.isArray(rows)) { out[s] = rows; continue; }
    out[s] = rows.map((r) => {
      const c = { ...r };
      for (const k of Object.keys(c)) {
        const v = c[k];
        if (v instanceof ArrayBuffer) c[k] = `<ArrayBuffer ${v.byteLength}>`;
        else if (v instanceof Blob) c[k] = `<Blob ${v.size}>`;
        else if (typeof v === "string" && v.length > 120) c[k] = v.slice(0, 60) + `...(${v.length})`;
        else if (Array.isArray(v) && v.length > 6) c[k] = `<Array ${v.length}>`;
      }
      return c;
    });
  }
  return out;
}), null, 1));
await browser.close();
