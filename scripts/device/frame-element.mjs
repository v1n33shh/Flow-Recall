import { chromium } from "playwright";
// _frame <needle> <targetCssTop>  - scroll the app's own overflow pane (the
// document itself never scrolls here) so the element containing <needle> sits
// at <targetCssTop> in the viewport.
const needle = process.argv[2], target = Number(process.argv[3] || 150);
const browser = await chromium.connectOverCDP("http://localhost:9222");
const page = browser.contexts()[0].pages()[0];
console.log(await page.evaluate(({ needle, target }) => {
  const find = () => {
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      if ((n.nodeValue || "").trim().toLowerCase() === needle.toLowerCase()) return n.parentElement;
    }
    return null;
  };
  const el = find();
  if (!el) return "not found: " + needle;
  const pane = Array.from(document.querySelectorAll("*"))
    .find((e) => e.scrollHeight > e.clientHeight + 8 && e.clientHeight > 100 && getComputedStyle(e).overflowY === "auto");
  if (!pane) return "no scroll pane";
  const delta = el.getBoundingClientRect().top - target;
  const max = pane.scrollHeight - pane.clientHeight;
  pane.scrollTop = Math.max(0, Math.min(max, pane.scrollTop + delta));
  return { requested: delta, scrollTop: pane.scrollTop, max };
}, { needle, target }));
await page.waitForTimeout(1400);
console.log("after:", await page.evaluate(({ needle }) => {
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let el = null;
  for (let n = w.nextNode(); n && !el; n = w.nextNode()) if ((n.nodeValue || "").trim().toLowerCase() === needle.toLowerCase()) el = n.parentElement;
  return { top: Math.round(el.getBoundingClientRect().top) };
}, { needle }));
await browser.close();
