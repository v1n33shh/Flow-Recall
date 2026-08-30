import { chromium } from "playwright";
const SAVED = '{"fontPercent":112,"fontFamily":"sans","epubScrollMode":"paginated","textLayoutMode":"paginated","pdfViewMode":"original","pdfReflowLayoutMode":"paginated","librarySort":"recent","eyeFilterWarmth":"off","eyeFilterDim":0}';
const browser = await chromium.connectOverCDP("http://localhost:9222");
const page = browser.contexts()[0].pages()[0];
// Use the menu's own Reset - warmth "off" + dim 0 is exactly the saved state.
console.log("reset:", await page.evaluate(() => {
  const b = Array.from(document.querySelectorAll("button")).find((x) => (x.textContent || "").trim() === "Reset");
  if (!b) return "no Reset button"; b.click(); return "clicked";
}));
await page.waitForTimeout(1200);
// Dismiss the menu via its own scrim: the scrim intercepts clicks on the trigger.
console.log("dismiss:", await page.evaluate(() => {
  const scrim = document.querySelector("div.fixed.inset-0.z-40.bg-transparent");
  if (!scrim) return "no scrim";
  scrim.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
  scrim.click();
  return "clicked scrim";
}));
await page.waitForTimeout(1400);
console.log("prefs match saved:", await page.evaluate((SAVED) => {
  const now = localStorage.getItem("flowrecall:reader-prefs");
  return { equal: now === SAVED, now };
}, SAVED));
// Leave the reader so it writes its position, then put the real position back.
console.log("exit:", await page.evaluate(() => {
  const b = document.querySelector('button[aria-label="Back to library"]');
  if (!b) return "not in reader"; b.click(); return "clicked";
}));
await page.waitForTimeout(2800);
console.log("position:", await page.evaluate(async () => {
  const db = await new Promise((res, rej) => { const r = indexedDB.open("flowrecall-reader"); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const id = "11da49a7-0c9f-4ac5-8513-40aafc673ef6";
  const get = () => new Promise((res, rej) => { const t = db.transaction("books", "readonly").objectStore("books").get(id); t.onsuccess = () => res(t.result); t.onerror = () => rej(t.error); });
  const row = await get();
  const was = row.lastPosition;
  await new Promise((res, rej) => { const t = db.transaction("books", "readwrite").objectStore("books").put({ ...row, lastPosition: JSON.stringify({ paragraphIndex: 400 }) }); t.onsuccess = () => res(); t.onerror = () => rej(t.error); });
  const after = await get();
  return { was, now: after.lastPosition, progress: after.progress };
}));
await browser.close();
