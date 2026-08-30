import { chromium } from "playwright";
const set = process.argv[2];   // JSON string to write back, or omit to read
const browser = await chromium.connectOverCDP("http://localhost:9222");
const page = browser.contexts()[0].pages()[0];
console.log(await page.evaluate((set) => {
  const K = "flowrecall:reader-prefs";
  const before = localStorage.getItem(K);
  if (set) localStorage.setItem(K, set);
  return { before, now: localStorage.getItem(K) };
}, set));
await browser.close();
