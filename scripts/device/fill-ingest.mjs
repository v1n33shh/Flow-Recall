import { chromium } from "playwright";
const browser = await chromium.connectOverCDP("http://localhost:9222");
const page = browser.contexts()[0].pages()[0];
// Fictional lecture notes - store assets must not show anyone's real content.
const NOTES = `Cardiac cycle - lecture 4

Systole begins when ventricular pressure exceeds atrial pressure, closing the mitral and tricuspid valves. That closure is the first heart sound, S1. Ventricular pressure then rises with no change in volume until it passes aortic pressure and the aortic valve opens.

Stroke volume is end-diastolic volume minus end-systolic volume, normally about 70 mL. Cardiac output is stroke volume times heart rate.

Preload is the ventricular stretch at the end of diastole. The Frank-Starling relationship says a greater preload produces a stronger contraction, because stretching the sarcomeres improves actin-myosin overlap.`;
await page.fill("textarea", NOTES);
await page.waitForTimeout(700);
const title = await page.$('input[type="text"], input:not([type])');
if (title) await title.fill("Cardiac cycle - lecture 4");
await page.waitForTimeout(600);
await page.evaluate(() => {
  const t = document.querySelector("textarea"); t.scrollTop = 0; t.blur();
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
});
await page.waitForTimeout(1400);
console.log(await page.evaluate(() => ({
  chars: document.querySelector("textarea").value.length,
  deckTitle: (document.querySelector('input[type="text"], input:not([type])') || {}).value,
  generate: (() => { const b = Array.from(document.querySelectorAll("button")).find((x) => /generate/i.test(x.textContent || "")); return b ? { text: b.textContent.trim(), disabled: b.disabled } : "none"; })(),
})));
await browser.close();
