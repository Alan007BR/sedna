// Client of the SEDNA data service.
// Code written with AI assistance (Claude); see AI_USAGE.md.

export type Visit = { index: number; start: string; end: string; midMjd: number; detectors: number[] };
export type Frame = { visit: number; detector: number; wavelengthUm: [number, number]; start: string; end: string; exposures: number; image: Float32Array };
export type Stack = {
  center: { ra: number; dec: number };
  grid: { size: number; pixelScaleArcsec: number };
  visits: Visit[];
  frames: Frame[];
  exposuresRequested: number;
  exposuresRead: number;
  seconds: number;
  release: string;
  citation: string;
  source: "archive" | "cache";
};
export type GaiaSource = { id: string; ra: number; dec: number; pmRa: number | null; pmDec: number | null; parallax: number | null; g: number | null };
export type Target = {
  id: string;
  name: string;
  kind: "motion" | "brightness" | "distance";
  ra: number;
  dec: number;
  epoch: number;
  pmRa?: number;
  pmDec?: number;
  horizons?: string;
  note: string;
  source: string;
};

export class ApiError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { signal });
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    throw new ApiError("SERVICE_UNREACHABLE", "The SEDNA data service did not answer. Try again in a moment.");
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const detail = body?.detail;
    throw new ApiError(detail?.code ?? "ERROR", detail?.message ?? `The data service returned an error (${response.status}).`);
  }
  return response.json() as Promise<T>;
}

function decode(base64: string): Float32Array {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Float32Array(bytes.buffer);
}

export async function fetchStack(ra: number, dec: number, fov: number, signal?: AbortSignal): Promise<Stack> {
  const raw = await get<Omit<Stack, "frames"> & { frames: (Omit<Frame, "image"> & { data: string })[] }>(
    `/api/stack?ra=${ra.toFixed(5)}&dec=${dec.toFixed(5)}&fov=${fov}`,
    signal,
  );
  return { ...raw, frames: raw.frames.map(({ data, ...f }) => ({ ...f, image: decode(data) })) };
}

export const fetchTargets = (signal?: AbortSignal) => get<{ targets: Target[] }>("/api/targets", signal).then((r) => r.targets);
export const fetchGaia = (ra: number, dec: number, fov: number, signal?: AbortSignal) =>
  get<{ sources: GaiaSource[]; refEpoch: number }>(`/api/gaia?ra=${ra.toFixed(5)}&dec=${dec.toFixed(5)}&fov=${fov}`, signal);
export const fetchHealth = (signal?: AbortSignal) => get<{ exposures: number; dataThrough: string }>("/api/health", signal);

export type Focus = {
  body: string | null;
  name: string;
  seed: { ra: number; dec: number; mjd: number; date: string };
  distancesAu: (number | null)[]; // the last entry is null: infinity
  scores: (number | null)[];
  best: number;
  bestDistanceAu: number;
  halfRangeAu: [number, number];
  confidence: "clear" | "uncertain" | "none";
  confidenceReason: string;
  trueDistanceAu: number | null;
  known?: { status: "known" | "none" | "unavailable"; message: string; name?: string; class?: string; vMag?: number; separationArcsec?: number };
  visit: number;
  visits: number;
  exposures: number;
  spanDays: number;
  start: string;
  end: string;
  detectors: number[];
  stampSize: number;
  stacks: Float32Array[];
  film: { dates: string[]; static: Float32Array[]; follow: Float32Array[] };
  assumption: string;
  seconds: number;
};

type FocusRaw = Omit<Focus, "stacks" | "film"> & { stacks: string; film: { dates: string[]; static: string; follow: string } };

function unpackFocus(raw: FocusRaw): Focus {
  const n = raw.stampSize * raw.stampSize;
  const split = (b64: string, count: number) => {
    const all = decode(b64);
    return Array.from({ length: count }, (_, i) => all.subarray(i * n, (i + 1) * n));
  };
  const frames = raw.film.dates.length;
  return {
    ...raw,
    stacks: split(raw.stacks, raw.distancesAu.length),
    film: { dates: raw.film.dates, static: split(raw.film.static, frames), follow: split(raw.film.follow, frames) },
  };
}

export const fetchFocusAt = (seed: { ra: number; dec: number; mjd: number }, signal?: AbortSignal) =>
  get<FocusRaw>(`/api/focus-at?ra=${seed.ra.toFixed(5)}&dec=${seed.dec.toFixed(5)}&mjd=${seed.mjd.toFixed(5)}`, signal).then(unpackFocus);

export async function fetchFocus(body: string, visit: number, signal?: AbortSignal): Promise<Focus> {
  type Raw = Omit<Focus, "stacks" | "film"> & { stacks: string; film: { dates: string[]; static: string; follow: string } };
  const raw = await get<Raw>(`/api/focus?body=${encodeURIComponent(body)}&visit=${visit}`, signal);
  const n = raw.stampSize * raw.stampSize;
  const split = (b64: string, count: number) => {
    const all = decode(b64);
    return Array.from({ length: count }, (_, i) => all.subarray(i * n, (i + 1) * n));
  };
  const frames = raw.film.dates.length;
  return {
    ...raw,
    stacks: split(raw.stacks, raw.distancesAu.length),
    film: { dates: raw.film.dates, static: split(raw.film.static, frames), follow: split(raw.film.follow, frames) },
  };
}

export type Film = {
  center: { ra: number; dec: number };
  grid: { size: number; pixelScaleArcsec: number };
  visit: number;
  visits: number;
  frames: { mjd: number; date: string; detector: number; obsid: string }[];
  images: Float32Array[];
};

export async function fetchFilm(ra: number, dec: number, fov: number, visit: number, signal?: AbortSignal): Promise<Film> {
  const raw = await get<Omit<Film, "images"> & { data: string }>(`/api/film?ra=${ra.toFixed(5)}&dec=${dec.toFixed(5)}&fov=${fov}&visit=${visit}`, signal);
  const all = decode(raw.data);
  const n = raw.grid.size * raw.grid.size;
  return { ...raw, images: raw.frames.map((_, i) => all.subarray(i * n, (i + 1) * n)) };
}
