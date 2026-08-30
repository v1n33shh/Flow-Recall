import { chromium } from "playwright";
const browser = await chromium.connectOverCDP("http://localhost:9222");
const page = browser.contexts()[0].pages()[0];
console.log("click:", await page.evaluate(() => {
  const b = Array.from(document.querySelectorAll("button")).find((x) => /define/i.test(x.textContent || ""));
  if (!b) return "no Define button"; b.click(); return "clicked";
}));
for (let i = 0; i < 12; i++) {
  await page.waitForTimeout(2500);
  const st = await page.evaluate(() => {
    return {
      buttons: Array.from(document.querySelectorAll("button")).map((b) => (b.textContent || "").replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 10),
      // The popover's own text only - not the whole page of swapped prose.
      panelText: (() => {
        const cands = Array.from(document.querySelectorAll("div")).filter((d) => /Save as Note|Copy definition|Add to Note/i.test(d.textContent || ""));
        const el = cands[cands.length - 1];
        return el ? el.innerText.split("\n").map((s) => s.trim()).filter(Boolean).slice(0, 14) : null;
      })(),
    };
  });
  console.log(`t+${(i + 1) * 2.5}s`, JSON.stringify(st));
  if (st.panelText) break;
}
await browser.close();
