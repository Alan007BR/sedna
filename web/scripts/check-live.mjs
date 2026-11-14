// Checks a deployed site against its live data service: prepared cases never reach the service, a new position
// does, and the large responses (single exposures on a 15' field) arrive. Exits non-zero on the first failure.
//   node scripts/check-live.mjs <site url> <service url>
// Code written with AI assistance (Claude); see AI_USAGE.md.
import { chromium } from "playwright";

const SITE = (process.argv[2] ?? "http://127.0.0.1:5173").replace(/\/$/, "");
const API = (process.argv[3] ?? "").replace(/\/$/, "");
if (!API) {
  console.error("usage: node scripts/check-live.mjs <site url> <service url>");
  process.exit(2);
}
const T = 180000;
let failures = 0;
const browser = await chromium.launch();

async function check(name, fn) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  const calls = [];
  page.on("request", (r) => { if (r.url().startsWith(API)) calls.push(new URL(r.url()).pathname); });
  try {
    const note = await fn(page, calls);
    console.log(`ok   ${name}${note ? ` | ${note}` : ""}`);
  } catch (err) {
    failures++;
    console.log(`FAIL ${name} | ${String(err.message ?? err).split("\n")[0]}`);
  } finally {
    await page.close();
  }
}

await check("service answers its health check", async () => {
  const t0 = Date.now();
  const r = await fetch(`${API}/api/health`);
  const body = await r.json();
  if (!body.exposures) throw new Error(`unexpected health: ${JSON.stringify(body)}`);
  return `${body.exposures} exposures indexed, ${Date.now() - t0} ms`;
});

await check("prepared target opens without asking the service for data", async (page, calls) => {
  await page.goto(`${SITE}/`);
  await page.getByRole("button", { name: /^Barnard's Star/ }).click({ timeout: T });
  await page.waitForSelector(".stage canvas:not([hidden])", { timeout: T });
  await page.waitForTimeout(1500);
  const data = calls.filter((p) => p !== "/api/health");
  if (data.length) throw new Error(`the service was asked for ${data.join(", ")}`);
  return `service calls: ${calls.length ? calls.join(", ") : "none"}`;
});

await check("start page says the live service is answering", async (page) => {
  await page.goto(`${SITE}/`);
  await page.waitForSelector(".target-card", { timeout: T });
  await page.waitForFunction(() => !/Running on prepared cases/.test(document.body.innerText), null, { timeout: 40000 }).catch(() => null);
  const help = await page.locator("#landing-help").innerText();
  if (/prepared cases/i.test(help)) throw new Error(`still says: ${help}`);
  return help;
});

await check("a new position is read live from the archive", async (page, calls) => {
  await page.goto(`${SITE}/?ra=12.34560&dec=-23.45670&fov=6&band=2&mode=blink`);
  await page.waitForSelector(".stage canvas:not([hidden])", { timeout: T });
  if (!calls.includes("/api/stack")) throw new Error(`no stack request reached the service: ${calls.join(", ")}`);
  return `service calls: ${[...new Set(calls)].join(", ")}`;
});

await check("a name typed on the start page is looked up and opened", async (page, calls) => {
  await page.goto(`${SITE}/?intro=0`);
  await page.waitForSelector(".target-card", { timeout: T });
  await page.locator("#landing-input").fill("Orion Nebula");
  await page.keyboard.press("Enter");
  await page.waitForSelector(".stage canvas:not([hidden])", { timeout: T });
  const shown = await page.locator("#target-input").inputValue();
  if (shown !== "M 42") throw new Error(`the search box shows "${shown}", not the resolved name`);
  if (!calls.includes("/api/resolve")) throw new Error("the name never reached the resolver");
  return `"Orion Nebula" -> ${shown} at ${new URL(page.url()).searchParams.get("ra")}, ${new URL(page.url()).searchParams.get("dec")}`;
});

await check("an unknown name says why", async (page) => {
  await page.goto(`${SITE}/?intro=0`);
  await page.waitForSelector(".target-card", { timeout: T });
  await page.locator("#landing-input").fill("Ceres");
  await page.keyboard.press("Enter");
  await page.getByText(/do not know "Ceres"/).waitFor({ timeout: T });
});

await check("a field search runs live and finds Makemake on its own", async () => {
  const t0 = Date.now();
  // asked of the service directly, not through the site, so the prepared copy is never used
  const r = await fetch(`${API}/api/search?ra=199.94124&dec=21.48776&fov=6&visit=0`);
  const body = await r.json();
  if (!r.ok) throw new Error(`status ${r.status}: ${JSON.stringify(body).slice(0, 120)}`);
  const top = body.candidates[0];
  if (!top || top.known?.name !== "Makemake") throw new Error(`first candidate: ${JSON.stringify(top ?? null).slice(0, 160)}`);
  return `${body.candidates.length} candidate(s), Makemake at S/N ${top.snr}, ${top.distanceAu} au, noise peaks ${body.noisePeaks.length}, ${((Date.now() - t0) / 1000).toFixed(1)} s (${body.source})`;
});

await check("single exposures of a 15' field arrive (a large, streamed response)", async () => {
  const t0 = Date.now();
  const r = await fetch(`${API}/api/film?ra=199.94124&dec=21.48776&fov=15&visit=0`);
  const buf = await r.arrayBuffer();
  if (!r.ok) throw new Error(`status ${r.status}`);
  return `${(buf.byteLength / 1e6).toFixed(1)} MB in ${((Date.now() - t0) / 1000).toFixed(1)} s`;
});

await browser.close();
console.log(failures ? `${failures} failed` : "all live checks passed");
process.exit(failures ? 1 : 0);
