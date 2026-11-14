// Records the 30-second narrated demo video from the published site. Each scene is driven by Playwright and
// captured frame by frame (Chrome's screencast, JPEG) for exactly as long as its narration line plus a pause;
// the line is shown as a subtitle in the page, a small label says what was made with AI, and ffmpeg assembles
// a 1920 x 1080, 30 fps H.264 file with the narration mixed in (AAC). The voice is synthetic: make it first
// with scripts/make-narration.py, which also measures each line.
//   FFMPEG=<path to ffmpeg> NARRATION=<dir from make-narration.py> node scripts/record-demo.mjs [site] [output.mp4]
// Code written with AI assistance (Claude); see AI_USAGE.md.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const SITE = (process.argv[2] ?? "https://sednaspace.earth").replace(/\/$/, "");
const OUT = resolve(process.argv[3] ?? "sedna-demo.mp4");
const FFMPEG = process.env.FFMPEG ?? "ffmpeg";
const NARRATION = process.env.NARRATION;
if (!NARRATION) {
  console.error("Set NARRATION to the folder written by scripts/make-narration.py.");
  process.exit(2);
}
const HERE = dirname(fileURLToPath(import.meta.url));
const SPEC = JSON.parse(readFileSync(join(HERE, "narration.json"), "utf8"));
const DUR = JSON.parse(readFileSync(join(NARRATION, "durations.json"), "utf8"));
const LINE = Object.fromEntries(SPEC.lines.map((l) => [l.id, l]));
const LEAD = 0.3, GAP = 0.4, TAIL = 0.8; // seconds of silence before the first line, after each line, at the end
// the page is laid out at 1600 x 900 and drawn at 1.2x, so the interface reads well in a 1920 x 1080 video
const W = 1600, H = 900, SCALE = 1.2, OUT_W = 1920, OUT_H = 1080, FPS = 30;
const WORK = join(tmpdir(), "sedna-demo-frames");
const LONG = 120000;
const AI_LABEL = "Made with AI assistance: logo, animations, and this synthetic narration voice";

rmSync(WORK, { recursive: true, force: true });
mkdirSync(WORK, { recursive: true });
const frames = []; // { file, t } with t in seconds on the video's own clock
const cues = []; // { id, t } where each narration line starts
let clock = 0;

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: SCALE });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The subtitle band and the AI label, drawn in the page with the site's own font. */
async function overlay(page, text, where = "bottom") {
  await page.evaluate(([t, w, label]) => {
    let el = document.getElementById("demo-caption");
    if (!el) {
      el = document.createElement("div");
      el.id = "demo-caption";
      document.body.appendChild(el);
    }
    el.setAttribute("style", [
      "position:fixed", "left:50%", w === "top" ? "top:22px" : "bottom:64px", "transform:translateX(-50%)", "z-index:9999",
      "max-width:1180px", "width:max-content", "padding:13px 26px", "border-radius:12px", "background:rgba(2,3,5,0.88)",
      "box-shadow:0 0 0 1px rgba(236,238,242,0.12)", "color:#ECEEF2", "font:400 25px/1.35 'IBM Plex Sans',system-ui,sans-serif",
      "text-align:center", "opacity:0", "transition:opacity 0.25s ease", t ? "" : "display:none",
    ].join(";"));
    el.textContent = t;
    requestAnimationFrame(() => requestAnimationFrame(() => { el.style.opacity = "1"; }));
    if (!document.getElementById("demo-ai")) {
      const ai = document.createElement("div");
      ai.id = "demo-ai";
      ai.setAttribute("style", "position:fixed;left:18px;bottom:14px;z-index:10000;max-width:330px;padding:6px 12px;border-radius:10px;background:rgba(2,3,5,0.8);color:#C9CDD6;font:400 15px/1.35 'IBM Plex Sans',system-ui,sans-serif");
      ai.textContent = label;
      document.body.appendChild(ai);
    }
  }, [text, where, AI_LABEL]);
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
  console.log(`${name}: ${n} frames, ${seconds.toFixed(2)} s`);
}

/** A scene that lasts as long as its narration line (plus a pause), with the line as a subtitle. */
async function spoken(name, id, page, where, script, lead = 0, after = GAP) {
  const seconds = lead + DUR[id] + after;
  cues.push({ id, t: clock + lead });
  await scene(name, page, seconds, async (elapsed) => {
    await script(elapsed, async () => overlay(page, LINE[id].text, where));
  });
}

const at = async (elapsed, s) => { const wait = s - elapsed(); if (wait > 0) await sleep(wait * 1000); };

// 1. the brand intro over the sky: what SPHEREx does
{
  const page = await context.newPage();
  await page.goto(`${SITE}/landing/sky-barnard-30.jpg`); // fonts and images warm in the cache first
  await page.goto(`${SITE}/?intro=0`);
  await page.waitForSelector(".target-card", { timeout: LONG });
  await page.waitForTimeout(1500);
  await page.goto("about:blank");
  await spoken("01-sky", "sky", page, "bottom", async (elapsed, sub) => {
    await page.goto(`${SITE}/?intro=arrival`);
    await at(elapsed, LEAD);
    await sub();
  }, LEAD);
  await page.close();
}

// 2. full screen: Barnard's Star blinks, then the difference shows its walk
{
  const page = await context.newPage();
  await page.goto(`${SITE}/?ra=269.44629&dec=4.76792&fov=4&band=2&mode=blink&target=barnard&view=sky&intro=0`);
  await page.waitForSelector(".sky .sky-window", { timeout: LONG });
  await page.waitForTimeout(1200);
  await page.mouse.move(W - 4, H / 2);
  await spoken("02-films", "films", page, "top", async (elapsed, sub) => {
    await sub();
    await page.keyboard.press("Space");
    await at(elapsed, 2.5);
    await page.keyboard.press("Space");
    await page.keyboard.press("2");
  });
  await page.close();
}

// 3. the region search: Makemake's field, searched with no starting point
{
  const page = await context.newPage();
  await page.goto(`${SITE}/?ra=199.94124&dec=21.48776&fov=6&band=1&mode=film&intro=0`);
  await page.waitForSelector(".stage canvas:not([hidden])", { timeout: LONG });
  await page.getByRole("button", { name: "Search this visit for moving bodies" }).waitFor({ timeout: LONG });
  await page.waitForTimeout(1000);
  await page.mouse.move(W - 4, H / 2);
  await spoken("03-search", "search", page, "top", async (elapsed, sub) => {
    await sub();
    await at(elapsed, 1.2);
    await page.getByRole("button", { name: "Search this visit for moving bodies" }).click();
    await page.mouse.move(W - 4, H / 2);
  });
  await page.close();
}

// 4. the distance focus: one knob, Makemake snaps into a point, and the check against JPL Horizons
{
  const page = await context.newPage();
  await page.goto(`${SITE}/?ra=199.94124&dec=21.48776&fov=6&band=2&mode=focus&target=makemake&intro=0`);
  await page.getByRole("tab", { name: /Focus/ }).click({ timeout: LONG });
  await page.waitForTimeout(1200);
  await spoken("04-focus", "focus", page, "top", async (elapsed, sub) => {
    await sub();
    await at(elapsed, 0.3);
    await page.getByRole("button", { name: /Find the focus/ }).click();
    await at(elapsed, 3.2);
    await page.getByRole("button", { name: /Check the answer/ }).click();
    await page.mouse.move(W - 4, H / 2);
  });
  await page.close();
}

// 5. Find Sedna
{
  const page = await context.newPage();
  await page.goto(`${SITE}/?ra=60.70000&dec=8.60000&fov=6&band=2&mode=follow&target=sedna&intro=0`);
  await page.waitForSelector(".follow .lens-summary", { timeout: LONG });
  await page.locator(".follow .zooms").first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(800);
  await spoken("05-sedna", "sedna", page, "bottom", async (elapsed, sub) => {
    await sub();
  });
  await page.close();
}

// 6. the end card
{
  const page = await context.newPage();
  await page.goto(`${SITE}/?intro=0`);
  await page.waitForSelector(".target-card", { timeout: LONG });
  await page.evaluate(() => {
    const card = document.createElement("div");
    card.setAttribute("style", "position:fixed;inset:0;z-index:9998;background:#020305;display:grid;place-content:center;justify-items:center;gap:30px;opacity:0;transition:opacity 0.4s ease;font-family:'IBM Plex Sans',system-ui,sans-serif");
    card.innerHTML = `
      <img src="/brand/sedna-horizontal-on-dark.svg" alt="" style="width:520px;height:auto">
      <div style="font:300 60px/1 'IBM Plex Sans';color:#ECEEF2;letter-spacing:-0.01em">sednaspace.earth</div>
      <div style="font:400 22px/1.5 'IBM Plex Sans';color:#B3B8C4;text-align:center">Team Deneb · NASA Space Apps Challenge 2026 · Planet X and SPHEREx</div>
      <div style="font:400 18px/1.5 'IBM Plex Mono',monospace;color:#7E8595;text-align:center">Data: NASA SPHEREx (IRSA) · ESA Gaia DR3 · IMCCE SkyBoT · JPL Horizons</div>`;
    card.id = "demo-end";
    document.body.appendChild(card);
  });
  await page.waitForTimeout(800);
  await spoken("06-end", "end", page, "bottom", async (elapsed, sub) => {
    await page.evaluate(() => { document.getElementById("demo-end").style.opacity = "1"; });
    await sub();
  }, 0, TAIL);
  await page.close();
}

await browser.close();

// assemble: each frame lasts until the next one, the last until the end of the video
frames.sort((a, b) => a.t - b.t);
const total = clock;
if (total > 30) throw new Error(`the video would last ${total.toFixed(2)} s; the limit is 30 s`);
const lines = [];
frames.forEach((f, i) => {
  const next = i + 1 < frames.length ? frames[i + 1].t : total;
  lines.push(`file '${f.file.replace(/\\/g, "/")}'`, `duration ${Math.max(next - f.t, 0.001).toFixed(4)}`);
});
lines.push(`file '${frames[frames.length - 1].file.replace(/\\/g, "/")}'`);
const list = join(WORK, "frames.txt");
writeFileSync(list, lines.join("\n"));
// the narration: each line placed at its cue, mixed, padded to the video's length and levelled for speech
const inputs = cues.flatMap((c) => ["-i", join(NARRATION, `${c.id}.wav`)]);
const delays = cues.map((c, i) => `[${i + 1}:a]adelay=${Math.round(c.t * 1000)}:all=1[a${i}]`).join(";");
const mix = `${cues.map((_, i) => `[a${i}]`).join("")}amix=inputs=${cues.length}:normalize=0,apad,atrim=0:${total.toFixed(3)},loudnorm=I=-16:TP=-1.5:LRA=11[aout]`;
const video = `[0:v]fps=${FPS},scale=${OUT_W}:${OUT_H}:flags=lanczos:in_range=pc:out_range=tv,fade=t=in:st=0:d=0.3,fade=t=out:st=${(total - 0.5).toFixed(2)}:d=0.5,format=yuv420p[vout]`;
execFileSync(FFMPEG, [
  "-y", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", list, ...inputs,
  "-filter_complex", `${video};${delays};${mix}`, "-map", "[vout]", "-map", "[aout]",
  "-color_range", "tv", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709",
  "-c:v", "libx264", "-preset", "slow", "-crf", "17", "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
  "-movflags", "+faststart", "-t", total.toFixed(2), OUT,
], { stdio: "inherit" });
console.log(`wrote ${OUT}: ${total.toFixed(2)} s, ${frames.length} frames, narration cues ${cues.map((c) => `${c.id}@${c.t.toFixed(2)}`).join(" ")}`);
