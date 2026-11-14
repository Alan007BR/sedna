// Sky view geometry and the smoked-glass mirror.
// Code written with AI assistance (Claude); see AI_USAGE.md.
import { describe, expect, it } from "vitest";
import { mirrorTiles } from "./render";
import { clampView, gridToScreen, HUD_BAND, mapSpan, MAX_SCALE, minScale, openingView, scaleBar, screenToWindow, zoomAt } from "./skymap";

const vp = { w: 1440, h: 900 };
const N = 59; // a 6 arcmin field

describe("sky view map", () => {
  it("opens with the window centred, as large as 86% of the shorter side allows without touching the HUD rows", () => {
    const v = openingView(N, vp);
    expect(v.s * N).toBeCloseTo(Math.min(0.86 * 900, 900 - 2 * HUD_BAND), 6);
    expect(openingView(N, { w: 390, h: 844 }).s * N).toBeCloseTo(0.86 * 390, 6); // a phone keeps the 86 %
    const c = gridToScreen(v, N, N / 2, N / 2);
    expect(c.x).toBeCloseTo(720, 6);
    expect(c.y).toBeCloseTo(450, 6);
  });

  it("never lets the map uncover the viewport, at any zoom or pan", () => {
    for (const [s, tx, ty] of [[1, 500, 500], [50, -1e6, 1e6], [9, -400, -300]]) {
      const v = clampView({ s, tx, ty }, N, vp);
      const span = mapSpan(N) * v.s;
      expect(v.s).toBeGreaterThanOrEqual(minScale(N, vp));
      expect(v.s).toBeLessThanOrEqual(MAX_SCALE);
      expect(v.tx).toBeLessThanOrEqual(0);
      expect(v.ty).toBeLessThanOrEqual(0);
      expect(v.tx + span).toBeGreaterThanOrEqual(vp.w - 1e-9);
      expect(v.ty + span).toBeGreaterThanOrEqual(vp.h - 1e-9);
    }
  });

  it("zooms around the pointer", () => {
    const v = openingView(N, vp);
    const before = screenToWindow(v, N, 800, 400)!;
    const z = zoomAt(v, 1.5, 800, 400, N, vp);
    const after = screenToWindow(z, N, 800, 400)!;
    expect(after).toEqual(before);
    expect(z.s).toBeCloseTo(Math.min(MAX_SCALE, v.s * 1.5), 6);
  });

  it("knows the reflection from the data", () => {
    const v = openingView(N, vp);
    expect(screenToWindow(v, N, 720, 450)).not.toBeNull();
    expect(screenToWindow(v, N, 20, 20)).toBeNull();
  });

  it("picks a readable scale bar", () => {
    const bar = scaleBar(13, 6.15);
    expect(bar.px).toBeLessThanOrEqual(140);
    expect([0.5, 1, 2, 5]).toContain(bar.arcmin);
  });
});

describe("smoked glass", () => {
  it("mirrors the window outward so every edge continues", () => {
    const size = 3;
    const tile = new Uint8ClampedArray(size * size * 4);
    for (let i = 0; i < size * size; i++) tile[i * 4] = i; // red channel holds the pixel index
    const out = mirrorTiles(tile, size, 1);
    const span = 3 * size;
    const at = (x: number, y: number) => out[(y * span + x) * 4];
    expect(at(3, 3)).toBe(0); // the window itself, untouched
    expect(at(2, 3)).toBe(0); // left neighbour is the mirror: its last column equals the window's first
    expect(at(3, 2)).toBe(0); // and the same upward
    expect(at(6, 3)).toBe(2); // right neighbour starts with the window's last column
  });
});
