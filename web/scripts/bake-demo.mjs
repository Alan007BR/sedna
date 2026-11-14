// Bake the prepared cases: drive the real app against the live data service through every demo flow and
// save each API response the screens ask for into public/demo, keyed by the exact request.
// The app then answers those same requests from files when the service is offline (src/lib/transport.ts).
//
// Needs the data service (uvicorn, port 8000) and `npm run dev` (port 5173) running. Run: npm run bake:demo
// Never edit the files in public/demo by hand; bake again instead.
// Code written with AI assistance (Claude); see AI_USAGE.md.
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { mkdirSync, rmSync, statSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const APP = process.env.SEDNA_APP ?? "http://127.0.0.1:5173";
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "demo");
const LONG = 300000;

const health = await fetch(`${APP}/api/health`).then((r) => r.json()).catch(() => null);
if (!health?.exposures) {
  console.error("The data service is not answering through the dev server. Start uvicorn and `npm run dev` first.");
  process.exit(1);
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, "api"), { recursive: true });
const responses = {};
const cases = [];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on("response", async (res) => {
  const url = new URL(res.url());
  if (!url.pathname.startsWith("/api/") || res.status() !== 200) return;
  const key = url.pathname + url.search;
  if (responses[key]) return;
  const file = `api/${createHash("sha1").update(key).digest("hex").slice(0, 20)}.json`;
  try {
    writeFileSync(join(OUT, file), await res.body());
    responses[key] = file;
  } catch {
    /* the page navigated before the body was read; the next flow that needs it will record it */
  }
});

const settle = async () => {
  await page.waitForFunction(() => !document.querySelector("[role=status]")?.textContent?.match(/Reading|Checking|Measuring|Predicting|Working out/), null, { timeout: LONG }).catch(() => {});
  await page.waitForTimeout(800);
};
const start = async () => {
  await page.goto(`${APP}/`);
  await page.waitForSelector(".examples.missions button:not([disabled])", { timeout: LONG });
};
const coachIs = (re) => page.waitForFunction((src) => new RegExp(src).test(document.querySelector(".coach-text")?.textContent ?? ""), re.source, { timeout: LONG });
const playOnce = async () => {
  await page.waitForTimeout(800);
  if ((await page.locator(".play").getAttribute("aria-label")) === "Play") await page.locator(".play").click();
};
const step = (name) => console.log(`- ${name}`);

// 1. the five challenge targets: the sky, Gaia, known movers, and the brightness lens
for (const name of ["Barnard's Star", "WISE 0855-0714", "Epsilon Indi B", "RW Aurigae", "R Draconis"]) {
  step(name);
  await start();
  await page.getByRole("button", { name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`) }).click();
  await page.waitForSelector(".stage canvas:not([hidden])", { timeout: LONG });
  await settle();
  cases.push({ id: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"), label: name, url: new URL(page.url()).search });
  await page.getByRole("button", { name: /^Measure .+ brightness and spectrum/ }).click();
  await page.waitForSelector(".lens-summary", { timeout: LONG });
}

// 1b. the namesake: 90377 Sedna stacked along its orbit
step("90377 Sedna");
await start();
await page.getByRole("button", { name: /named after 90377 Sedna/ }).click();
await page.waitForSelector(".follow .lens-summary", { timeout: LONG });
cases.push({ id: "sedna", label: "90377 Sedna", url: new URL(page.url()).search });

// 2. the three missions, played to the end
step("mission: watch a star walk");
await start();
await page.getByRole("button", { name: /Watch a star walk/ }).click();
await page.waitForSelector(".stage canvas:not([hidden])", { timeout: LONG });
await page.waitForSelector(".stage svg circle", { timeout: LONG });
await settle();
await playOnce();
await coachIs(/choose Difference/);
await page.getByRole("button", { name: "Show the difference" }).click();
await coachIs(/click the star/);
await page.getByRole("button", { name: "Back to Blink" }).click();
await page.waitForTimeout(300);
if ((await page.locator(".play").getAttribute("aria-label")) === "Pause") await page.locator(".play").click();
let box = await page.locator(".stage").boundingBox();
await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
await coachIs(/gives itself away/);
cases.push({ id: "mission-walk", label: "Mission 1, Watch a star walk", url: "?mission=walk" });

step("mission: see what only the infrared shows");
await page.getByRole("button", { name: /Next mission/ }).click();
await page.waitForFunction(() => location.search.includes("mission=infrared"));
await page.waitForSelector(".stage canvas:not([hidden])", { timeout: LONG });
await settle();
await playOnce();
await coachIs(/Switch to detector D6/);
await page.getByRole("button", { name: "Switch to D6" }).click();
await coachIs(/Play again/);
await playOnce();
await coachIs(/Cold bodies/);
cases.push({ id: "mission-infrared", label: "Mission 2, See what only the infrared shows", url: "?mission=infrared" });

step("mission: measure a dwarf planet's distance");
await page.getByRole("button", { name: /Next mission/ }).click();
await coachIs(/Step 1 plays/);
await page.getByRole("tab", { name: /Focus/ }).click({ timeout: LONG });
await page.getByRole("button", { name: /Find the focus/ }).click();
await page.getByRole("tab", { name: /Check/ }).click({ timeout: LONG });
await page.getByRole("button", { name: /Predict the next visit/ }).click();
await page.waitForSelector(".next-visit .chip", { timeout: LONG });
cases.push({ id: "mission-distance", label: "Mission 3, Measure a dwarf planet's distance", url: "?mission=distance" });

// 3. the distance controls, with the next-visit check where the focus is clear enough
for (const name of ["Makemake", "Haumea", "Pluto", "Eris"]) {
  step(`distance focus: ${name}`);
  await start();
  await page.getByRole("button", { name: new RegExp(`^${name}`) }).click();
  await page.getByRole("tab", { name: /Focus/ }).click({ timeout: LONG });
  await page.getByRole("button", { name: /Find the focus/ }).click();
  await page.getByRole("tab", { name: /Check/ }).click({ timeout: LONG });
  const predict = page.getByRole("button", { name: /Predict the next visit/ });
  if (await predict.count()) {
    await predict.click();
    await page.waitForSelector(".next-visit .chip", { timeout: LONG });
  }
  cases.push({ id: `focus-${name.toLowerCase()}`, label: `${name} (distance focus)`, url: new URL(page.url()).search });
}

// 4. a blind search on Makemake's field: known movers, the parallax ruler, single exposures, a picked point
step("Makemake's field: movers, ruler, single exposures, picked point");
const field = "?ra=199.94124&dec=21.48776&fov=6&band=1&mode=blink";
await page.goto(`${APP}/${field}`);
await page.waitForSelector(".stage canvas:not([hidden])", { timeout: LONG });
await settle();
await page.getByRole("button", { name: "Parallax ruler" }).click();
await page.waitForSelector(".ruler .lens-summary", { timeout: LONG });
await page.getByRole("button", { name: "Parallax ruler" }).click();
await page.getByRole("button", { name: "Show in single exposures" }).first().click();
await page.waitForSelector(".legend", { timeout: LONG });
box = await page.locator(".stage").boundingBox();
await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
await page.getByRole("button", { name: /Focus the distance on this point/ }).click();
await page.getByRole("tab", { name: /Focus/ }).click({ timeout: LONG });
await page.getByRole("button", { name: /Find the focus/ }).click();
await page.getByRole("tab", { name: /Check/ }).click({ timeout: LONG });
await page.getByRole("button", { name: /Predict the next visit/ }).click();
await page.waitForSelector(".next-visit .chip", { timeout: LONG });
cases.push({ id: "makemake-field", label: "Makemake's field, 8 June 2025 (199.94124 21.48776)", url: field });

await browser.close();

let commit = "unknown";
try {
  commit = execSync("git rev-parse --short HEAD", { cwd: OUT }).toString().trim();
} catch {
  /* not a git checkout */
}
writeFileSync(
  join(OUT, "index.json"),
  JSON.stringify({ schemaVersion: 1, release: "SPHEREx DR1 + QR3 (pipeline R7)", dataThrough: health.dataThrough, code: commit, cases, responses }, null, 1),
);
const bytes = readdirSync(join(OUT, "api")).reduce((sum, f) => sum + statSync(join(OUT, "api", f)).size, 0);
console.log(`${Object.keys(responses).length} responses, ${(bytes / 1e6).toFixed(1)} MB, ${cases.length} cases -> public/demo`);
