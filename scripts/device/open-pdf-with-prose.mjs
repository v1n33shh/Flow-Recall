import { chromium } from "playwright";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
const PARA = Number(process.argv[2] || 155);
const BOOK = "11da49a7-0c9f-4ac5-8513-40aafc673ef6";
const browser = await chromium.connectOverCDP("http://localhost:9222");
const page = browser.contexts()[0].pages()[0];

// 1. Leave the reader first. It writes lastPosition on exit, so setting the
//    position before leaving would just be overwritten.
const back = await page.$('button[aria-label="Back to library"]');
if (back) { await page.evaluate(() => document.querySelector('button[aria-label="Back to library"]').click()); await page.waitForTimeout(2800); }

// 2. Park the reader mid-book, so the progress bar reads as a real reading
//    session rather than a 2%-wide sliver in the corner.
console.log("position:", await page.evaluate(async ({ BOOK, PARA }) => {
  const db = await new Promise((res, rej) => { const r = indexedDB.open("flowrecall-reader"); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const get = () => new Promise((res, rej) => { const t = db.transaction("books", "readonly").objectStore("books").get(BOOK); t.onsuccess = () => res(t.result); t.onerror = () => rej(t.error); });
  const row = await get();
  const was = row.lastPosition;
  await new Promise((res, rej) => { const t = db.transaction("books", "readwrite").objectStore("books").put({ ...row, lastPosition: JSON.stringify({ paragraphIndex: PARA }) }); t.onsuccess = () => res(); t.onerror = () => rej(t.error); });
  return { was, now: (await get()).lastPosition };
}, { BOOK, PARA }));

// 3. Open the PDF by badge text, never by grid slot.
await page.evaluate(() => Array.from(document.querySelectorAll("button")).find((b) => /(^|[^A-Z])PDF$/.test((b.textContent || "").trim())).click());
for (let i = 0; i < 8; i++) {
  await page.waitForTimeout(2500);
  if (await page.evaluate(() => document.querySelectorAll(".reader-longpress-text p").length > 0)) break;
}

// 4. Length-preserving swap to fictional prose: no real book content in a store asset.
const PROSE = join(dirname(fileURLToPath(import.meta.url)), "prose.js");
await page.evaluate(readFileSync(PROSE, "utf8"));
console.log("swap:", await page.evaluate(() => {
  const prose = window.__FR_PROSE;
  const ps = Array.from(document.querySelectorAll(".reader-longpress-text p"));
  let cursor = 0;
  for (const p of ps) {
    const want = (p.textContent || "").length;
    let out = "";
    while (out.length < want) out += (out ? " " : "") + prose[cursor++ % prose.length];
    if (out.length > want) { const cut = out.lastIndexOf(" ", want); out = out.slice(0, cut > want * 0.6 ? cut : want); }
    p.textContent = out;
  }
  return ps.length;
}));
await page.waitForTimeout(1800);
console.log("state:", await page.evaluate(() => {
  const root = document.querySelector(".reader-longpress-text");
  const ps = Array.from(root.querySelectorAll("p"));
  const visible = ps.filter((p) => { const r = p.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.right > 0 && r.left < innerWidth; });
  const starts = window.__FR_PROSE.map((s) => s.slice(0, 30));
  return {
    visible: visible.length,
    allVisibleFictional: visible.length > 0 && visible.every((p) => starts.some((s) => (p.textContent || "").includes(s))),
    counter: (Array.from(document.querySelectorAll("p,span,div")).find((n) => /^Page \d+ of \d+$/.test((n.textContent || "").trim())) || {}).textContent,
    firstVisible: visible[0] ? visible[0].textContent.slice(0, 60) : "(none)",
  };
}));
await browser.close();
