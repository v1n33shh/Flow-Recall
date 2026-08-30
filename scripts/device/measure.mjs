import { chromium } from "playwright";
const browser = await chromium.connectOverCDP("http://localhost:9222");
const page = browser.contexts()[0].pages()[0];
console.log(await page.evaluate(() => {
  const byText = (re) => {
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) if (re.test((n.nodeValue || "").trim())) return n.parentElement;
    return null;
  };
  const pane = Array.from(document.querySelectorAll("*")).find((e) => e.scrollHeight > e.clientHeight + 8 && e.clientHeight > 100 && getComputedStyle(e).overflowY === "auto");
  const r = (el) => el ? { top: Math.round(el.getBoundingClientRect().top), bottom: Math.round(el.getBoundingClientRect().bottom) } : null;
  const gen = Array.from(document.querySelectorAll("button")).find((b) => /generate/i.test(b.textContent || ""));
  const nav = document.querySelector("nav");
  return {
    pane: pane ? { scrollTop: pane.scrollTop, max: pane.scrollHeight - pane.clientHeight } : "none",
    orPasteText: r(byText(/^or paste text$/i)),
    dropzoneText: r(byText(/pull the text out/i)),
    generate: r(gen),
    navTop: nav ? Math.round(nav.getBoundingClientRect().top) : null,
    viewportCss: innerHeight,
  };
}));
await browser.close();
