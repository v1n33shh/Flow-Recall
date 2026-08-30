import { chromium } from "playwright";
const browser = await chromium.connectOverCDP("http://localhost:9222");
const page = browser.contexts()[0].pages()[0];
console.log(await page.evaluate(() => {
  const NAME = "Fabby", EMAIL = "jenyfuhrr@gmail.com";
  const report = { name: 0, email: 0, avatar: 0 };
  // Walk text nodes: the account header renders name and email as plain text.
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const hits = [];
  for (let n = walk.nextNode(); n; n = walk.nextNode()) hits.push(n);
  for (const n of hits) {
    const t = n.nodeValue || "";
    if (t.includes(EMAIL)) { n.nodeValue = t.replace(EMAIL, ""); report.email++; }
    else if (t.trim() === NAME) { n.nodeValue = "Unknown"; report.name++; }
    else if (t.trim() === NAME[0]) { n.nodeValue = "U"; report.avatar++; }
  }
  return {
    ...report,
    leaks: document.body.innerText.includes(EMAIL) || /\bFabby\b/.test(document.body.innerText),
    lines: document.body.innerText.split("\n").map((s) => s.trim()).filter(Boolean).slice(0, 12),
  };
}));
await browser.close();
