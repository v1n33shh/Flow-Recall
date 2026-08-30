import { chromium } from "playwright";
const target = process.argv[2];           // JSON string to store, or omit to read
const browser = await chromium.connectOverCDP("http://localhost:9222");
const page = browser.contexts()[0].pages()[0];
console.log(await page.evaluate(async (target) => {
  const db = await new Promise((res, rej) => {
    const r = indexedDB.open("flowrecall-reader");
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  const id = "11da49a7-0c9f-4ac5-8513-40aafc673ef6";
  const get = () => new Promise((res, rej) => {
    const t = db.transaction("books", "readonly").objectStore("books").get(id);
    t.onsuccess = () => res(t.result); t.onerror = () => rej(t.error);
  });
  const before = await get();
  if (!target) return { lastPosition: before.lastPosition, progress: before.progress };
  const row = { ...before, lastPosition: target };
  await new Promise((res, rej) => {
    const t = db.transaction("books", "readwrite").objectStore("books").put(row);
    t.onsuccess = () => res(); t.onerror = () => rej(t.error);
  });
  const after = await get();
  return { was: before.lastPosition, now: after.lastPosition };
}, target));
await browser.close();
