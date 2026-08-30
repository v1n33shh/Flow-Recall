import { chromium } from "playwright";
const browser = await chromium.connectOverCDP("http://localhost:9222");
const page = browser.contexts()[0].pages()[0];
console.log("url:", page.url());
console.log("saved decks in localStorage:", await page.evaluate(() => {
  const out = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    const v = localStorage.getItem(k) || "";
    out[k] = v.length > 90 ? v.slice(0, 90) + `... (${v.length} chars)` : v;
  }
  return out;
}));
console.log("sessionStorage keys:", await page.evaluate(() => Object.keys(sessionStorage)));
console.log("signed in?", await page.evaluate(async () => {
  try {
    const r = await fetch("/api/auth/session", { credentials: "include" });
    const s = await r.json();
    return s?.user ? { hasUser: true, plan: s.user.plan, streak: s.user.currentStreak, nameLen: (s.user.name||"").length, emailLen: (s.user.email||"").length } : { hasUser: false };
  } catch (e) { return "error: " + e.message; }
}));
await browser.close();
