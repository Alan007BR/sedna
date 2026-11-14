// The sky view as a map: pure geometry for pan, zoom, clamping and the scale bar.
// Map units are SPHEREx pixels. The map is the data window (size x size) with ``REACH`` mirrored
// copies on each side, so it spans (2 * REACH + 1) * size; the window sits in the middle.
// Code written with AI assistance (Claude); see AI_USAGE.md.

export const REACH = 3; // mirrored copies on each side: enough room to frame the window beside a drawer or above a phone sheet
export const MAX_SCALE = 24; // screen px per SPHEREx px
export const SHARP_FROM = 4; // below this the frames are smoothed, from it they are sharp pixels
export const OPENING_SHARE = 0.86; // the window fills this share of the shorter viewport side

export type MapView = { s: number; tx: number; ty: number }; // scale, and the screen position of the map's top-left corner
export type Viewport = { w: number; h: number };

export const mapSpan = (size: number) => (2 * REACH + 1) * size;
export const minScale = (size: number, vp: Viewport) => Math.max(vp.w, vp.h) / mapSpan(size);

/** Keep the map covering the whole viewport, and the scale inside its range. */
export function clampView(v: MapView, size: number, vp: Viewport): MapView {
  const s = Math.min(MAX_SCALE, Math.max(minScale(size, vp), v.s));
  const span = mapSpan(size) * s;
  return { s, tx: Math.min(0, Math.max(vp.w - span, v.tx)), ty: Math.min(0, Math.max(vp.h - span, v.ty)) };
}

export const HUD_BAND = 76; // height kept clear for the top and bottom HUD rows when the view opens

/** The window centred, filling 86 % of the shorter side, but never under the top or bottom HUD rows. */
export function openingView(size: number, vp: Viewport): MapView {
  const s = Math.min(OPENING_SHARE * Math.min(vp.w, vp.h), vp.h - 2 * HUD_BAND) / size;
  const centre = (mapSpan(size) / 2) * s;
  return clampView({ s, tx: vp.w / 2 - centre, ty: vp.h / 2 - centre }, size, vp);
}

export type Area = { x: number; y: number; w: number; h: number };

/** Like the opening view, but centred in a free part of the screen (beside the details drawer). */
export function openingViewIn(size: number, vp: Viewport, area: Area, band = HUD_BAND): MapView {
  const s = Math.max(1e-3, Math.min(OPENING_SHARE * Math.min(area.w, area.h), area.h - 2 * band)) / size;
  const centre = (mapSpan(size) / 2) * s;
  return clampView({ s, tx: area.x + area.w / 2 - centre, ty: area.y + area.h / 2 - centre }, size, vp);
}

/** Zoom by ``factor`` keeping the map point under (px, py) where it is. */
export function zoomAt(v: MapView, factor: number, px: number, py: number, size: number, vp: Viewport): MapView {
  const target = Math.min(MAX_SCALE, Math.max(minScale(size, vp), v.s * factor));
  const k = target / v.s;
  return clampView({ s: target, tx: px - (px - v.tx) * k, ty: py - (py - v.ty) * k }, size, vp);
}

/** Screen position of a point given in the stage's SVG grid units (x right, y down, window 0..size). */
export function gridToScreen(v: MapView, size: number, x: number, y: number) {
  return { x: v.tx + (REACH * size + x) * v.s, y: v.ty + (REACH * size + y) * v.s };
}

/** Window pixel under a screen point, or null when it falls on the reflection. Row 0 is the top of the screen. */
export function screenToWindow(v: MapView, size: number, sx: number, sy: number) {
  const x = (sx - v.tx) / v.s - REACH * size;
  const y = (sy - v.ty) / v.s - REACH * size;
  return x >= 0 && y >= 0 && x < size && y < size ? { col: Math.floor(x), rowScreen: Math.floor(y) } : null;
}

/** A scale bar that stays readable: 0.5', 1', 2' or 5', the longest under 140 px. */
export function scaleBar(s: number, pixelArcsec: number): { arcmin: number; px: number } {
  const options = [0.5, 1, 2, 5];
  let best = { arcmin: options[0], px: ((options[0] * 60) / pixelArcsec) * s };
  for (const a of options) {
    const px = ((a * 60) / pixelArcsec) * s;
    if (px <= 140) best = { arcmin: a, px };
  }
  return best;
}

/** Width and height of sky on screen, in arcminutes. */
export const fieldInView = (s: number, vp: Viewport, pixelArcsec: number) => ({ w: (vp.w / s) * (pixelArcsec / 60), h: (vp.h / s) * (pixelArcsec / 60) });
