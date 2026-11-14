// Demo-flow check: with the data service off, every prepared case must work, an unprepared view must say
// so plainly, and the embed must fit a 400 x 300 iframe. Exits non-zero on the first failure.
// Run against `npm run dev` with the service stopped, `npm run dev:demo`, or `npm run preview` of a build:
//   node scripts/check-demo.mjs [app url]       (default http://127.0.0.1:5173)
// Screenshots go to docs/evidence/demo-*.png.
// Code written with AI assistance (Claude); see AI_USAGE.md.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const APP = (process.argv[2] ?? "http://127.0.0.1:5173").replace(/\/$/, "");
const EVIDENCE = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "docs", "evidence");
const T = 60000;
const errors = [];
let failures = 0;

const browser = await chromium.launch();
async function check(name, fn, viewport = { width: 1440, height: 900 }) {
  const page = await browser.newPage({ viewport });
  page.on("pageerror", (e) => errors.push(`${name}: ${e}`));
  try {
    const note = await fn(page);
    console.log(`ok   ${name}${note ? ` | ${note}` : ""}`);
  } catch (err) {
    failures++;
    console.log(`FAIL ${name} | ${String(err.message ?? err).split("\n")[0]}`);
  } finally {
    await page.close();
  }
}
const sky = (page) => page.waitForSelector(".stage canvas:not([hidden])", { timeout: T });
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - innerWidth);

await check("start page says prepared cases are in use", async (page) => {
  await page.goto(`${APP}/`);
  await page.waitForSelector(".examples.missions button:not([disabled])", { timeout: T });
  await page.getByText(/running on prepared cases/).waitFor({ timeout: T });
  await page.screenshot({ path: join(EVIDENCE, "demo-start-1440.png") });
  return (await page.locator(".credits").innerText()).replace(/\s+/g, " ").slice(-60);
});

for (const name of ["Barnard's Star", "WISE 0855-0714", "Epsilon Indi B", "RW Aurigae", "R Draconis"]) {
  await check(`${name}: sky, Gaia, movers, brightness`, async (page) => {
    await page.goto(`${APP}/`);
    await page.getByRole("button", { name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`) }).click({ timeout: T });
    await sky(page);
    await page.locator(".movers, .note-line").first().waitFor({ timeout: T });
    await page.getByRole("button", { name: /^Measure .+ brightness and spectrum/ }).click();
    await page.waitForSelector(".lens-summary", { timeout: T });
    await page.getByRole("button", { name: "Difference" }).click();
    return (await page.locator(".lens-summary").innerText()).slice(0, 70);
  });
}

await check("90377 Sedna appears when stacked along its orbit", async (page) => {
  await page.goto(`${APP}/`);
  await page.getByRole("button", { name: /named after 90377 Sedna/ }).click({ timeout: T });
  await page.waitForSelector(".follow .lens-summary", { timeout: T });
  const text = await page.locator(".follow .lens-summary").innerText();
  if (!/appears as a point at S\/N/.test(text)) throw new Error(`unexpected summary: ${text}`);
  await page.screenshot({ path: join(EVIDENCE, "demo-sedna-1440.png"), fullPage: true });
  return text.slice(0, 80);
});

await check("mission 1 played to the end", async (page) => {
  await page.goto(`${APP}/`);
  await page.getByRole("button", { name: /Watch a star walk/ }).click({ timeout: T });
  await sky(page);
  await page.waitForSelector(".stage svg circle", { timeout: T });
  await page.waitForTimeout(800);
  await page.locator(".play").click();
  await page.getByRole("button", { name: "Show the difference" }).click({ timeout: T });
  await page.getByRole("button", { name: "Back to Blink" }).click({ timeout: T });
  await page.waitForTimeout(300);
  if ((await page.locator(".play").getAttribute("aria-label")) === "Pause") await page.locator(".play").click();
  const box = await page.locator(".stage").boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.getByText(/gives itself away/).waitFor({ timeout: T });
});

await check("mission 3 and the next-visit check", async (page) => {
  await page.goto(`${APP}/`);
  await page.getByRole("button", { name: /Measure a dwarf planet/ }).click({ timeout: T });
  await page.getByRole("tab", { name: /Focus/ }).click({ timeout: T });
  await page.getByRole("button", { name: /Find the focus/ }).click();
  await page.getByRole("tab", { name: /Check/ }).click({ timeout: T });
  await page.getByRole("button", { name: /Predict the next visit/ }).click();
  await page.waitForSelector(".next-visit .zooms", { timeout: T });
  return (await page.locator(".next-visit p").first().innerText()).slice(0, 70);
});

await check("Makemake's field: movers, ruler, single exposures, picked point", async (page) => {
  await page.goto(`${APP}/?ra=199.94124&dec=21.48776&fov=6&band=1&mode=blink`);
  await sky(page);
  await page.getByRole("button", { name: "Parallax ruler" }).click();
  await page.waitForSelector(".ruler .lens-summary", { timeout: T });
  await page.getByRole("button", { name: "Parallax ruler" }).click();
  await page.getByRole("button", { name: "Show in single exposures" }).first().click({ timeout: T });
  await page.waitForSelector(".legend", { timeout: T });
  const box = await page.locator(".stage").boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.getByRole("button", { name: /Focus the distance on this point/ }).click();
  await page.getByRole("tab", { name: /Focus/ }).click({ timeout: T });
  await page.getByRole("button", { name: /Find the focus/ }).click();
  await page.getByRole("tab", { name: /Check/ }).click({ timeout: T });
  await page.getByRole("button", { name: /Predict the next visit/ }).click();
  await page.waitForSelector(".next-visit .chip", { timeout: T });
  return (await page.locator(".next-visit p").first().innerText()).slice(0, 90);
});

await check("an unprepared field says which cases are prepared", async (page) => {
  await page.goto(`${APP}/?ra=10.00000&dec=-20.00000&fov=6&band=2&mode=blink`);
  const msg = await page.locator(".stage-msg.error").innerText({ timeout: T });
  if (!/not among the prepared cases/.test(msg) || !/Barnard/.test(msg)) throw new Error(`unexpected message: ${msg}`);
  return msg.slice(0, 80);
});

for (const vp of [{ width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1440, height: 900 }]) {
  await check(`full view fits ${vp.width} px`, async (page) => {
    await page.goto(`${APP}/?mission=walk&ra=269.44629&dec=4.76792&fov=4&band=2&mode=blink&target=barnard`);
    await sky(page);
    const o = await overflow(page);
    if (o > 0) throw new Error(`horizontal overflow ${o}px`);
  }, vp);
}

await check("embed in a 400 x 300 iframe", async (page) => {
  const src = `${APP}/embed/?ra=269.44629&dec=4.76792&fov=4&band=2&mode=blink&target=barnard&gaia=0`;
  await page.setContent(`<body style="margin:24px;background:#888"><iframe src="${src}" width="400" height="300" style="border:0" title="SEDNA"></iframe></body>`);
  const frame = page.frameLocator("iframe");
  await frame.locator(".stage canvas:not([hidden])").waitFor({ timeout: T });
  await frame.getByRole("link", { name: /Open in SEDNA/ }).waitFor({ timeout: T });
  await page.waitForTimeout(1200);
  const fits = await frame.locator(".embed").evaluate((el) => ({ w: el.scrollWidth, h: el.scrollHeight, stage: el.querySelector(".stage").getBoundingClientRect().height }));
  if (fits.w > 400 || fits.h > 300) throw new Error(`embed overflows: ${fits.w} x ${fits.h}`);
  await page.locator("iframe").screenshot({ path: join(EVIDENCE, "demo-embed-400x300.png") });
  return `content ${fits.w} x ${fits.h}, sky ${Math.round(fits.stage)} px tall`;
}, { width: 460, height: 360 });

await browser.close();
if (errors.length) console.log("page errors:", errors);
console.log(failures || errors.length ? `${failures} failed, ${errors.length} page errors` : "all checks passed");
process.exit(failures || errors.length ? 1 : 0);
