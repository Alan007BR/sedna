// Records the 30-second demo video from the published site: each scene is driven by Playwright and captured
// frame by frame (Chrome's screencast, JPEG), English captions are drawn in the page, and ffmpeg assembles a
// 1920 x 1080, 30 fps H.264 file. No audio, so no music rights and nothing to subtitle.
//   FFMPEG=<path to ffmpeg> node scripts/record-demo.mjs [site] [output.mp4]
// Code written with AI assistance (Claude); see AI_USAGE.md.
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright";

const SITE = (process.argv[2] ?? "https://sednaspace.earth").replace(/\/$/, "");
const OUT = resolve(process.argv[3] ?? "sedna-demo.mp4");
const FFMPEG = process.env.FFMPEG ?? "ffmpeg";
const API = process.env.SEDNA_API ?? "https://x3db7sx2drpmxc3oiazigdkmnu0fyecz.lambda-url.us-east-2.on.aws";
// the page is laid out at 1600 x 900 and drawn at 1.2x, so the interface reads well in a 1920 x 1080 video
const W = 1600, H = 900, SCALE = 1.2, OUT_W = 1920, OUT_H = 1080, FPS = 30;
const WORK = join(tmpdir(), "sedna-demo-frames");
const ORION = { ra: 83.822, dec: -5.391 }; // the Orion Nebula, typed live in the last scene (exactly as typed)
const LONG = 120000;

rmSync(WORK, { recursive: true, force: true });
mkdirSync(WORK, { recursive: true });
const frames = []; // { file, t } with t in seconds on the video's own clock
let clock = 0;

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: SCALE });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The caption band, drawn in the page with the site's own font. */
async function caption(page, text, where = "bottom") {
  await page.evaluate(([t, w]) => {
    let el = document.getElementById("demo-caption");
    if (!el) {
      el = document.createElement("div");
      el.id = "demo-caption";
      document.body.appendChild(el);
    }
    el.setAttribute("style", [
      "position:fixed", "left:50%", w === "top" ? "top:26px" : "bottom:90px", "transform:translateX(-50%)", "z-index:9999",
      "max-width:1120px", "padding:16px 30px", "border-radius:12px", "background:rgba(2,3,5,0.9)",
      "box-shadow:0 0 0 1px rgba(236,238,242,0.12)", "color:#ECEEF2", "font:400 28px/1.35 'IBM Plex Sans',system-ui,sans-serif",
      "letter-spacing:-0.005em", "text-align:center", "opacity:0", "transition:opacity 0.35s ease",
    ].join(";"));
    el.textContent = t;
    requestAnimationFrame(() => requestAnimationFrame(() => { el.style.opacity = "1"; }));
  }, [text, where]);
}

/** Captures `seconds` of the page while `script` runs; frames land on the video clock. */
async function scene(name, page, seconds, script) {
  const cdp = await context.newCDPSession(page);
  const start = clock;
  let first = null;
  let n = 0;
  cdp.on("Page.screencastFrame", async ({ data, metadata, sessionId }) => {
    cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
    if (first === null) first = metadata.timestamp;
    const t = start + (metadata.timestamp - first);
    if (t > start + seconds) return;
    const file = join(WORK, `${name}-${String(n++).padStart(5, "0")}.jpg`);
    writeFileSync(file, Buffer.from(data, "base64"));
    frames.push({ file, t });
  });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: OUT_W, maxHeight: OUT_H, everyNthFrame: 1 });
  const t0 = Date.now();
  await script(() => (Date.now() - t0) / 1000);
  const left = seconds * 1000 - (Date.now() - t0);
  if (left > 0) await sleep(left);
  await cdp.send("Page.stopScreencast");
  await cdp.detach();
  clock = start + seconds;
  console.log(`${name}: ${n} frames, ${seconds} s`);
}

const at = async (elapsed, s) => { const wait = s - elapsed(); if (wait > 0) await sleep(wait * 1000); };

// warm the live service for the last scene, so the typed position answers from its cache
await Promise.all(["stack", "gaia", "movers"].map((p) => fetch(`${API}/api/${p}?ra=${ORION.ra.toFixed(5)}&dec=${ORION.dec.toFixed(5)}&fov=6`, { signal: AbortSignal.timeout(90000) }).then((r) => r.arrayBuffer()).catch(() => null)));

// 1. the brand intro, then the start page with Makemake crossing its field
{
  const page = await context.newPage();
  await page.goto(`${SITE}/landing/sky-barnard-30.jpg`); // fonts and images warm in the cache first
  await page.goto(`${SITE}/?intro=0`);
  await page.waitForSelector(".target-card", { timeout: LONG });
  await page.waitForTimeout(1500);
  await page.goto("about:blank");
  await scene("01-intro", page, 6.5, async (elapsed) => {
    await page.goto(`${SITE}/?intro=arrival`);
    await at(elapsed, 4.3);
    await caption(page, "NASA SPHEREx photographs the whole sky in 102 infrared colours, again and again.");
  });
  await page.close();
}

// 2. full screen: Barnard's Star blinks, then the difference shows its walk
{
  const page = await context.newPage();
  await page.goto(`${SITE}/?ra=269.44629&dec=4.76792&fov=4&band=2&mode=blink&target=barnard&view=sky&intro=0`);
  await page.waitForSelector(".sky .sky-window", { timeout: LONG });
  await page.waitForTimeout(1200);
  await page.mouse.move(W - 4, H / 2);
  await scene("02-barnard", page, 5.0, async (elapsed) => {
    await caption(page, "SEDNA turns those images into films. Barnard’s Star walks 10″ a year.", "top");
    await page.keyboard.press("Space");
    await at(elapsed, 3.0);
    await page.keyboard.press("Space");
    await page.keyboard.press("2");
  });
  await page.close();
}

// 3. the distance focus: one knob, and Makemake snaps into a point
{
  const page = await context.newPage();
  await page.goto(`${SITE}/?ra=199.94124&dec=21.48776&fov=6&band=2&mode=focus&target=makemake&intro=0`);
  await page.getByRole("tab", { name: /Focus/ }).click({ timeout: LONG });
  await page.waitForTimeout(1200);
  await scene("03-focus", page, 5.5, async (elapsed) => {
    await caption(page, "Turn one knob and a moving world snaps into focus, revealing its distance.", "top");
    await at(elapsed, 0.8);
    await page.getByRole("button", { name: /Find the focus/ }).click();
  });
  await page.close();
}

// 4. Find Sedna
{
  const page = await context.newPage();
  await page.goto(`${SITE}/?ra=60.70000&dec=8.60000&fov=6&band=2&mode=follow&target=sedna&intro=0`);
  await page.waitForSelector(".follow .lens-summary", { timeout: LONG });
  await page.locator(".follow .zooms").first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(800);
  await scene("04-sedna", page, 4.5, async () => {
    await caption(page, "90377 Sedna: invisible in one exposure, found in 161 stacked along its orbit.");
  });
  await page.close();
}

// 5. any position, typed and read live
{
  const page = await context.newPage();
  await page.goto(`${SITE}/?intro=0`);
  await page.waitForSelector(".target-card", { timeout: LONG });
  await page.waitForTimeout(1500);
  // typed, sent, and the loader; then a cut while the archive is read; then the field itself
  await scene("05a-typed", page, 1.9, async () => {
    await caption(page, "Any point in the sky, read live from NASA’s public SPHEREx archive.", "top");
    await page.locator("#landing-input").click();
    await page.keyboard.type(`${ORION.ra.toFixed(3)} ${ORION.dec.toFixed(3)}`, { delay: 40 });
    await page.keyboard.press("Enter");
  });
  await page.waitForSelector(".stage canvas:not([hidden])", { timeout: LONG });
  await page.waitForTimeout(500);
  await page.mouse.move(W - 4, H - 4);
  await scene("05b-field", page, 2.1, async () => {});
  await page.close();
}

// 6. the end card
{
  const page = await context.newPage();
  await page.goto(`${SITE}/?intro=0`);
  await page.waitForSelector(".target-card", { timeout: LONG });
  await page.evaluate(() => {
    const card = document.createElement("div");
    card.setAttribute("style", "position:fixed;inset:0;z-index:9999;background:#020305;display:grid;place-content:center;justify-items:center;gap:34px;opacity:0;transition:opacity 0.5s ease;font-family:'IBM Plex Sans',system-ui,sans-serif");
    card.innerHTML = `
      <img src="/brand/sedna-horizontal-on-dark.svg" alt="" style="width:560px;height:auto">
      <div style="font:300 64px/1 'IBM Plex Sans';color:#ECEEF2;letter-spacing:-0.01em">sednaspace.earth</div>
      <div style="font:400 22px/1.5 'IBM Plex Mono',monospace;color:#7E8595;text-align:center">Data: NASA SPHEREx (IRSA) · ESA Gaia DR3 · IMCCE SkyBoT · JPL Horizons<br>NASA Space Apps Challenge 2026 · Planet X and SPHEREx</div>`;
    card.id = "demo-end";
    document.body.appendChild(card);
  });
  await page.waitForTimeout(800);
  await scene("06-end", page, 3.0, async () => {
    await page.evaluate(() => { document.getElementById("demo-end").style.opacity = "1"; });
  });
  await page.close();
}

await browser.close();

// assemble: each frame lasts until the next one, the last until the end of the video
frames.sort((a, b) => a.t - b.t);
const total = clock;
const lines = [];
frames.forEach((f, i) => {
  const next = i + 1 < frames.length ? frames[i + 1].t : total;
  lines.push(`file '${f.file.replace(/\\/g, "/")}'`, `duration ${Math.max(next - f.t, 0.001).toFixed(4)}`);
});
lines.push(`file '${frames[frames.length - 1].file.replace(/\\/g, "/")}'`);
const list = join(WORK, "frames.txt");
writeFileSync(list, lines.join("\n"));
execFileSync(FFMPEG, [
  "-y", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", list,
  "-vf", `fps=${FPS},scale=${OUT_W}:${OUT_H}:flags=lanczos:in_range=pc:out_range=tv,fade=t=in:st=0:d=0.4,fade=t=out:st=${(total - 0.5).toFixed(2)}:d=0.5,format=yuv420p`,
  "-color_range", "tv", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709",
  "-c:v", "libx264", "-preset", "slow", "-crf", "17", "-movflags", "+faststart", "-t", total.toFixed(2), OUT,
], { stdio: "inherit" });
console.log(`wrote ${OUT}: ${total.toFixed(1)} s, ${frames.length} frames captured`);
