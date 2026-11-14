// Turning calibrated frames into pixels on screen. One stretch for every frame of a detector.
// Code written with AI assistance (Claude); see AI_USAGE.md.

export type Limits = { lo: number; hi: number };

function percentile(sorted: Float32Array, p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(p * sorted.length)))];
}

/** Display limits computed over ALL frames given, so stars do not flicker between epochs. */
export function sharedLimits(images: Float32Array[], loP = 0.25, hiP = 0.995): Limits {
  let n = 0;
  for (const im of images) for (let i = 0; i < im.length; i++) if (Number.isFinite(im[i])) n++;
  const all = new Float32Array(n);
  let k = 0;
  for (const im of images) for (let i = 0; i < im.length; i++) if (Number.isFinite(im[i])) all[k++] = im[i];
  all.sort();
  if (!n) return { lo: 0, hi: 1 };
  const lo = percentile(all, loP);
  const hi = percentile(all, hiP);
  return { lo, hi: hi > lo ? hi : lo + 1 };
}

/** Symmetric limit for a difference image. */
export function differenceLimit(diff: Float32Array): number {
  const abs = Float32Array.from(diff, (v) => (Number.isFinite(v) ? Math.abs(v) : 0)).sort();
  return percentile(abs, 0.995) || 1;
}

const asinh = (x: number) => Math.log(x + Math.sqrt(x * x + 1));
const NEG = [74, 144, 226];
const ZERO = [17, 19, 23];
const POS = [232, 131, 58];
const MASK = [38, 20, 48]; // pixels never observed: visibly not sky

export type RenderOptions = { limits: Limits; softening: number; invert: boolean };

/** Grayscale asinh rendering into RGBA. The grid's row 0 is south, so rows are flipped for the screen. */
export function renderFrame(image: Float32Array, size: number, out: ImageData, opt: RenderOptions) {
  const norm = asinh(opt.softening);
  for (let row = 0; row < size; row++) {
    const src = (size - 1 - row) * size;
    for (let col = 0; col < size; col++) {
      const v = image[src + col];
      const o = (row * size + col) * 4;
      if (!Number.isFinite(v)) {
        out.data[o] = MASK[0]; out.data[o + 1] = MASK[1]; out.data[o + 2] = MASK[2]; out.data[o + 3] = 255;
        continue;
      }
      const t = Math.min(1, Math.max(0, (v - opt.limits.lo) / (opt.limits.hi - opt.limits.lo)));
      let g = 255 * (asinh(opt.softening * t) / norm);
      if (opt.invert) g = 255 - g;
      out.data[o] = g; out.data[o + 1] = g; out.data[o + 2] = g; out.data[o + 3] = 255;
    }
  }
}

/** Diverging rendering of a difference (later minus earlier): blue fainter, orange brighter, dark where nothing changed. */
export function renderDifference(diff: Float32Array, size: number, out: ImageData, limit: number) {
  for (let row = 0; row < size; row++) {
    const src = (size - 1 - row) * size;
    for (let col = 0; col < size; col++) {
      const v = diff[src + col];
      const o = (row * size + col) * 4;
      if (!Number.isFinite(v)) {
        out.data[o] = MASK[0]; out.data[o + 1] = MASK[1]; out.data[o + 2] = MASK[2]; out.data[o + 3] = 255;
        continue;
      }
      const t = Math.max(-1, Math.min(1, v / limit));
      const to = t < 0 ? NEG : POS;
      const w = Math.abs(t);
      out.data[o] = ZERO[0] + (to[0] - ZERO[0]) * w;
      out.data[o + 1] = ZERO[1] + (to[1] - ZERO[1]) * w;
      out.data[o + 2] = ZERO[2] + (to[2] - ZERO[2]) * w;
      out.data[o + 3] = 255;
    }
  }
}

export type ViewMode = "blink" | "diff" | "sum";

/**
 * The pixels one viewer shows for a stack: the current epoch, the difference last minus first, or the sum.
 * The void view and the sky view both paint with this, so they always show the same thing.
 */
export function paintStack(frames: Float32Array[], epoch: number, mode: ViewMode, size: number, out: ImageData, limits: Limits, invert: boolean) {
  if (!frames.length) return;
  if (mode === "diff" && frames.length >= 2) {
    const diff = subtract(frames[frames.length - 1], frames[0]);
    renderDifference(diff, size, out, differenceLimit(diff));
  } else if (mode === "sum") {
    renderFrame(mean(frames), size, out, { limits, softening: 10, invert });
  } else {
    renderFrame(frames[Math.min(epoch, frames.length - 1)], size, out, { limits, softening: 10, invert });
  }
}

/**
 * The sky view's smoked glass: an RGBA image of ``tile`` (size x size, already rendered) mirrored outward
 * from every edge, ``reach`` copies on each side. Mirroring keeps the edges continuous; it is never data.
 */
export function mirrorTiles(tile: Uint8ClampedArray, size: number, reach: number): Uint8ClampedArray<ArrayBuffer> {
  const span = (2 * reach + 1) * size;
  const out = new Uint8ClampedArray(new ArrayBuffer(span * span * 4));
  for (let Y = 0; Y < span; Y++) {
    const ty = Math.floor(Y / size) - reach;
    let y = Y % size;
    if (ty % 2 !== 0) y = size - 1 - y;
    for (let X = 0; X < span; X++) {
      const tx = Math.floor(X / size) - reach;
      let x = X % size;
      if (tx % 2 !== 0) x = size - 1 - x;
      const s = (y * size + x) * 4;
      const o = (Y * span + X) * 4;
      out[o] = tile[s];
      out[o + 1] = tile[s + 1];
      out[o + 2] = tile[s + 2];
      out[o + 3] = 255;
    }
  }
  return out;
}

export function subtract(later: Float32Array, earlier: Float32Array): Float32Array {
  const out = new Float32Array(later.length);
  for (let i = 0; i < out.length; i++) out[i] = later[i] - earlier[i];
  return out;
}

export function mean(images: Float32Array[]): Float32Array {
  const out = new Float32Array(images[0].length);
  const count = new Float32Array(out.length);
  for (const im of images) for (let i = 0; i < out.length; i++) if (Number.isFinite(im[i])) { out[i] += im[i]; count[i]++; }
  for (let i = 0; i < out.length; i++) out[i] = count[i] ? out[i] / count[i] : NaN;
  return out;
}
