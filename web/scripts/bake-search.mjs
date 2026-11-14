// Add the region-search case to the prepared cases, keeping every response already in public/demo:
// open Makemake's field in single exposures, search the visit, measure the first candidate's distance and
// check the next visit, saving each new API response the screens ask for.
//
// Needs the data service (uvicorn, port 8000) and `npm run dev` (port 5173) running. Run: node scripts/bake-search.mjs
// Code written with AI assistance (Claude); see AI_USAGE.md.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const APP = process.env.SEDNA_APP ?? "http://127.0.0.1:5173";
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "demo");
const LONG = 300000;
const index = JSON.parse(readFileSync(join(OUT, "index.json"), "utf8"));
const before = Object.keys(index.responses).length;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
const pending = [];
page.on("response", (res) => {
  const url = new URL(res.url());
  if (!url.pathname.startsWith("/api/") || res.status() !== 200) return;
  const key = url.pathname + url.search;
  if (index.responses[key] || key === "/api/health" || key === "/api/targets") return;
  const file = `api/${createHash("sha1").update(key).digest("hex").slice(0, 20)}.json`;
  pending.push(
    res.body().then((body) => {
      writeFileSync(join(OUT, file), body);
      index.responses[key] = file;
      console.log(`  + ${key}`);
    }),
  );
});

const filmUrl = "?ra=199.94124&dec=21.48776&fov=6&band=1&mode=film";
await page.goto(`${APP}/${filmUrl}&intro=0`);
await page.waitForSelector(".stage canvas:not([hidden])", { timeout: LONG });
await page.getByRole("button", { name: "Search this visit for moving bodies" }).click();
await page.waitForSelector(".search-result", { timeout: LONG });
await page.getByRole("button", { name: "Measure its distance" }).first().click();
await page.getByRole("tab", { name: /Focus/ }).click({ timeout: LONG });
await page.getByRole("button", { name: /Find the focus/ }).click();
await page.getByRole("tab", { name: /Check/ }).click({ timeout: LONG });
await page.getByRole("button", { name: /Predict the next visit/ }).click();
await page.waitForSelector(".next-visit .chip", { timeout: LONG });
await page.waitForTimeout(800);
await Promise.all(pending);
await browser.close();

index.cases = index.cases.filter((c) => c.id !== "makemake-search").concat({ id: "makemake-search", label: "Makemake's field searched for moving bodies", url: filmUrl });
writeFileSync(join(OUT, "index.json"), JSON.stringify(index, null, 1));
console.log(`${Object.keys(index.responses).length - before} responses added, ${index.cases.length} cases`);
