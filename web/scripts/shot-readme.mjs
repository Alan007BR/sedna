// Screenshots of the published site for the README, taken through the same links the README gives,
// so the pictures and the links are checked together.
//   node scripts/shot-readme.mjs [site] [folder]      (defaults: https://sednaspace.earth, ../docs/readme)
// Code written with AI assistance (Claude); see AI_USAGE.md.
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";

const SITE = (process.argv[2] ?? "https://sednaspace.earth").replace(/\/$/, "");
const OUT = resolve(process.argv[3] ?? "../docs/readme");
const LONG = 120000;
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });

async function shot(name, path, ready) {
  const page = await context.newPage();
  await page.goto(`${SITE}${path}`);
  await ready(page);
  await page.mouse.move(1439, 899);
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  await page.close();
  console.log(`${name}: ${SITE}${path}`);
}

await shot("start", "/?intro=0", (p) => p.waitForSelector(".target-card", { timeout: LONG }));
await shot("blink", "/?ra=269.44629&dec=4.76792&fov=4&band=2&mode=diff&target=barnard&view=sky&intro=0", (p) => p.waitForSelector(".sky .sky-window", { timeout: LONG }));
await shot("search", "/?ra=199.94124&dec=21.48776&fov=6&band=1&mode=film&intro=0", async (p) => {
  await p.getByRole("button", { name: "Search this visit for moving bodies" }).click({ timeout: LONG });
  await p.waitForSelector(".search-result", { timeout: LONG });
});
await shot("focus", "/?ra=199.94124&dec=21.48776&fov=6&band=2&mode=focus&target=makemake&intro=0", async (p) => {
  await p.getByRole("tab", { name: /Focus/ }).click({ timeout: LONG });
  await p.getByRole("button", { name: /Find the focus/ }).click();
  await p.waitForTimeout(800);
});
await shot("sedna", "/?ra=60.70000&dec=8.60000&fov=6&band=2&mode=follow&target=sedna&intro=0", (p) => p.waitForSelector(".follow .lens-summary", { timeout: LONG }));
for (const m of ["walk", "infrared", "distance"]) {
  const page = await context.newPage();
  await page.goto(`${SITE}/?mission=${m}&intro=0`);
  await page.waitForSelector(".coach-text", { timeout: LONG });
  console.log(`mission ${m}: opens`);
  await page.close();
}
await browser.close();
