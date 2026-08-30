import { chromium } from "playwright";
const browser = await chromium.connectOverCDP("http://localhost:9222");
const page = browser.contexts()[0].pages()[0];
// 1. Close the definition sheet.
console.log("close sheet:", await page.evaluate(() => {
  const btns = Array.from(document.querySelectorAll("button"));
  const x = btns.find((b) => (b.textContent || "").trim() === "✕" || b.getAttribute("aria-label")?.match(/close/i));
  if (x) { x.click(); return "clicked " + (x.getAttribute("aria-label") || x.textContent.trim()); }
  return "no close button: " + btns.map((b) => (b.textContent || "").trim().slice(0, 12)).join("|");
}));
await page.waitForTimeout(1600);
// 2. Open the Aa display-settings menu.
console.log("open Aa:", await page.evaluate(() => {
  const b = document.querySelector('button[aria-label="Display settings"]');
  if (!b) return "no Aa button"; b.click(); return "clicked";
}));
await page.waitForTimeout(1600);
// 3. Warm, with a modest dim - Amber at full dim is the combination that drops
//    body text under WCAG AA, so it is not what a store asset should show.
console.log("set filter:", await page.evaluate(() => {
  const warm = Array.from(document.querySelectorAll("button")).find((b) => (b.textContent || "").trim() === "Warm");
  if (!warm) return "no Warm swatch: " + Array.from(document.querySelectorAll("button")).map((b) => (b.textContent || "").trim().slice(0, 10)).join("|");
  warm.click();
  return "warm clicked";
}));
await page.waitForTimeout(900);
console.log("dim:", await page.evaluate(() => {
  const up = document.querySelector('button[aria-label="Increase dim"]');
  if (!up) return "no dim stepper";
  for (let i = 0; i < 3; i++) up.click();     // 3 x 5% = 15%
  return "clicked x3";
}));
await page.waitForTimeout(1400);
console.log("state:", await page.evaluate(() => ({
  prefs: localStorage.getItem("flowrecall:reader-prefs"),
  eyeFilterOverlay: (() => {
    const el = Array.from(document.querySelectorAll("div")).find((d) => /eye/i.test(d.className || "") || d.style.backgroundColor && d.style.mixBlendMode);
    return el ? { bg: el.style.backgroundColor, blend: el.style.mixBlendMode } : "not found by style";
  })(),
})));
await browser.close();
