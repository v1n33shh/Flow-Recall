import { chromium } from "playwright";
const want = process.argv[2];
const browser = await chromium.connectOverCDP("http://localhost:9222");
const page = browser.contexts()[0].pages()[0];
console.log(await page.evaluate((want) => {
  const root = document.querySelector(".reader-longpress-text");
  const ps = Array.from(root.querySelectorAll("p")).filter((p) => {
    const r = p.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.right > 0 && r.left < innerWidth;
  });
  const out = [];
  for (const p of ps) {
    const node = p.firstChild;
    if (!node || node.nodeType !== 3) continue;
    const text = node.nodeValue;
    const re = new RegExp(`\\b${want}\\b`, "gi");
    let m;
    while ((m = re.exec(text))) {
      const range = document.createRange();
      range.setStart(node, m.index);
      range.setEnd(node, m.index + m[0].length);
      const r = range.getBoundingClientRect();
      // Only offer hits actually on screen: columns off-viewport report boxes too.
      if (r.width > 0 && r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight) {
        out.push({
          word: m[0],
          deviceX: Math.round((r.left + r.width / 2) * devicePixelRatio),
          deviceY: Math.round((r.top + r.height / 2) * devicePixelRatio) + 96,
        });
      }
    }
  }
  return out.length ? out : "no on-screen hit for " + want;
}, want));
await browser.close();
