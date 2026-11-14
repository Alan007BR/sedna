// Screenshots of the start page at common laptop, tablet and phone sizes, and whether each fits without scrolling.
//   node scripts/shot-landing.mjs [app url] [out dir]
// Code written with AI assistance (Claude); see AI_USAGE.md.
import { chromium } from "playwright";

const APP = (process.argv[2] ?? "http://127.0.0.1:5173").replace(/\/$/, "");
const OUT = process.argv[3] ?? ".";
const browser = await chromium.launch();
for (const vp of [{ width: 1920, height: 960 }, { width: 1536, height: 730 }, { width: 1440, height: 900 }, { width: 1366, height: 657 }, { width: 1280, height: 800 }, { width: 768, height: 1024 }, { width: 390, height: 844 }, { width: 360, height: 740 }]) {
  const page = await browser.newPage({ viewport: vp, reducedMotion: "reduce" });
  await page.goto(`${APP}/`);
  await page.waitForSelector(".target-card", { timeout: 30000 });
  await page.waitForTimeout(600);
  const m = await page.evaluate(() => ({ scrollH: document.documentElement.scrollHeight, scrollW: document.documentElement.scrollWidth, h: innerHeight, w: innerWidth }));
  await page.screenshot({ path: `${OUT}/landing-${vp.width}x${vp.height}.png` });
  console.log(`${vp.width}x${vp.height}: page ${m.scrollW}x${m.scrollH} ${m.scrollH > m.h ? `SCROLLS by ${m.scrollH - m.h}px` : "fits"}${m.scrollW > m.w ? ", horizontal overflow" : ""}`);
  await page.close();
}
await browser.close();
