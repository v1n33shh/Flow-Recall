import { chromium } from "playwright";
const href = process.argv[2];
const browser = await chromium.connectOverCDP("http://localhost:9222");
const page = browser.contexts()[0].pages()[0];
// The tab bar is null on /reader and /study, so route through home first.
if (await page.$('button[aria-label="Back to library"]')) {
  await page.evaluate(() => document.querySelector('button[aria-label="Back to library"]').click());
  await page.waitForTimeout(2200);
}
const clickVisible = (sel) => page.evaluate((sel) => {
  const vis = Array.from(document.querySelectorAll(sel))
    .filter((a) => { const r = a.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
  if (!vis.length) return "none visible: " + sel;
  vis[vis.length - 1].click();
  return "ok";
}, sel);
if (!(await page.evaluate(() => location.pathname === "/"))) {
  console.log("home:", await clickVisible('a[href="/"]'));
  await page.waitForTimeout(2600);
}
console.log("tab:", await clickVisible(`a[href="${href}"]`));
await page.waitForTimeout(3800);
console.log("url:", page.url());
console.log(await page.evaluate(() => document.body.innerText.split("\n").filter(Boolean).slice(0, 30)));
await browser.close();
