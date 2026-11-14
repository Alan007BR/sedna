// Brightness of one point: contract, client and chart definitions.
// The service measures; these functions only reshape its points for display.
// Code written with AI assistance (Claude); see AI_USAGE.md.
import { z } from "zod";
import { ApiError } from "./api";

const ExposureSchema = z.object({
  mjd: z.number(),
  date: z.string(),
  detector: z.number().int().min(1).max(6),
  wavelengthUm: z.number(),
  bandwidthUm: z.number(),
  flux: z.number().nullable(),
  fluxErr: z.number().nullable(),
  saturatedPixels: z.number().int(),
  bin: z.number().int(),
});
const ChangePointSchema = z.object({
  bin: z.number().int(),
  midMjd: z.number(),
  deltaMag: z.number(),
  error: z.number(),
  channels: z.number().int(),
  exposures: z.number().int(),
  reliable: z.boolean(),
});
export const BrightnessSchema = z.object({
  schemaVersion: z.literal(1),
  release: z.string(),
  point: z.object({ ra: z.number(), dec: z.number() }),
  target: z.string().nullable(),
  method: z.enum(["aperture", "wing"]),
  methodNote: z.string(),
  unit: z.string(),
  exposuresAvailable: z.number().int(),
  exposuresMeasured: z.number().int(),
  bins: z.array(z.object({ index: z.number().int(), start: z.string(), end: z.string(), midMjd: z.number(), exposures: z.number().int() })),
  exposures: z.array(ExposureSchema),
  change: z.array(z.object({ detector: z.number().int(), rangeUm: z.tuple([z.number(), z.number()]), points: z.array(ChangePointSchema) })),
  seconds: z.number(),
  source: z.enum(["archive", "cache"]),
});
export type Brightness = z.infer<typeof BrightnessSchema>;

export async function fetchBrightness(ra: number, dec: number, target: string | null, signal?: AbortSignal): Promise<Brightness> {
  const q = `ra=${ra.toFixed(5)}&dec=${dec.toFixed(5)}${target ? `&target=${encodeURIComponent(target)}` : ""}`;
  let response: Response;
  try {
    response = await fetch(`/api/brightness?${q}`, { signal });
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    throw new ApiError("SERVICE_UNREACHABLE", "The SEDNA data service did not answer. Try again in a moment.");
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(body?.detail?.code ?? "ERROR", body?.detail?.message ?? `The data service returned an error (${response.status}).`);
  const parsed = BrightnessSchema.safeParse(body);
  if (!parsed.success) throw new ApiError("BAD_RESPONSE", "The brightness measurement came back in an unexpected shape.");
  return parsed.data;
}

/** Stable detector colours, ordered by wavelength (brand system tokens --chart-d1 … --chart-d6). */
export const detectorColor = (det: number) => `var(--chart-d${det})`;

const MJD_UNIX_EPOCH = 40587;
export const mjdToMs = (mjd: number) => (mjd - MJD_UNIX_EPOCH) * 86400000;
export const monthLabel = (ms: number) => new Date(ms).toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });

export type CurvePoint = { t: number; y: number; err: number; reliable: boolean; channels: number; exposures: number; det: number };

/** Light curve: one series per detector, change in magnitude per time bin. */
export function lightCurveSeries(b: Brightness) {
  return b.change.map((c) => ({
    detector: c.detector,
    rangeUm: c.rangeUm,
    points: c.points.map<CurvePoint>((p) => ({ t: mjdToMs(p.midMjd), y: p.deltaMag, err: p.error, reliable: p.reliable, channels: p.channels, exposures: p.exposures, det: c.detector })),
  }));
}

export type SpectrumPoint = { x: number; y: number; err: number; det: number; date: string; bandwidth: number; saturated: number };

/** Spectrum of one time bin: every exposure is one point, at the wavelength the filter gave it. */
export function spectrumPoints(b: Brightness, bin: number): SpectrumPoint[] {
  return b.exposures
    .filter((e) => e.bin === bin && e.flux !== null && e.fluxErr !== null && e.flux > 0)
    .map((e) => ({ x: e.wavelengthUm, y: e.flux as number, err: e.fluxErr as number, det: e.detector, date: e.date, bandwidth: e.bandwidthUm, saturated: e.saturatedPixels }))
    .sort((a, b2) => a.x - b2.x);
}

/** Time bins worth a spectrum (at least 12 measured exposures), the best-covered first. */
export function spectrumBins(b: Brightness) {
  const counts = new Map<number, number>();
  for (const e of b.exposures) if (e.flux !== null && e.flux > 0) counts.set(e.bin, (counts.get(e.bin) ?? 0) + 1);
  return b.bins
    .filter((bin) => (counts.get(bin.index) ?? 0) >= 12)
    .map((bin) => ({ ...bin, measured: counts.get(bin.index) ?? 0, label: bin.start.slice(0, 10) === bin.end.slice(0, 10) ? bin.start.slice(0, 10) : `${bin.start.slice(0, 10)} – ${bin.end.slice(5, 10)}` }));
}

export const defaultSpectrumBin = (b: Brightness) => spectrumBins(b).reduce<number | null>((best, bin, _, all) => (best === null || bin.measured > (all.find((x) => x.index === best)?.measured ?? 0) ? bin.index : best), null);

/** One row per detector for the text equivalent: change from the first to the last reliable bin, and the full range. */
export function changeRows(b: Brightness) {
  return b.change.map((c) => {
    const pts = c.points.filter((p) => p.reliable);
    const first = pts[0];
    const last = pts[pts.length - 1];
    const range = pts.length ? Math.max(...pts.map((p) => p.deltaMag)) - Math.min(...pts.map((p) => p.deltaMag)) : 0;
    const bin = (i: number) => b.bins.find((x) => x.index === i);
    return {
      detector: c.detector,
      rangeUm: c.rangeUm,
      bins: pts.length,
      firstDate: first ? bin(first.bin)?.start.slice(0, 10) ?? "" : "",
      lastDate: last ? bin(last.bin)?.end.slice(0, 10) ?? "" : "",
      firstToLast: first && last && first !== last ? last.deltaMag - first.deltaMag : null,
      firstToLastErr: first && last && first !== last ? Math.hypot(first.error, last.error) : null,
      peakToPeak: range,
    };
  });
}

/** Plain-language summary of the largest change. Positive magnitudes are fainter. */
export function summary(b: Brightness): string {
  const rows = changeRows(b).filter((r) => r.firstToLast !== null);
  if (!rows.length) return "Not enough repeated exposures at the same wavelength to measure a change in brightness at this point yet.";
  const notable = rows.filter((r) => Math.abs(r.firstToLast as number) >= Math.max(0.1, 3 * (r.firstToLastErr ?? 0)));
  if (!notable.length) return `No change larger than 0.1 magnitude between ${rows[0].firstDate} and ${rows[0].lastDate} at any wavelength.`;
  const top = [...notable].sort((a, c) => Math.abs(c.firstToLast as number) - Math.abs(a.firstToLast as number))[0];
  const word = (top.firstToLast as number) > 0 ? "faded" : "brightened";
  const many = rows.some((r) => r.bins > 3);
  const extra = many ? ` Across all dates it varied by up to ${Math.max(...rows.map((r) => r.peakToPeak)).toFixed(1)} magnitudes.` : "";
  return `Between ${top.firstDate} and ${top.lastDate} it ${word} by ${Math.abs(top.firstToLast as number).toFixed(2)} magnitude at ${top.rangeUm[0].toFixed(2)}–${top.rangeUm[1].toFixed(2)} µm (detector ${top.detector}).${extra}`;
}

export function toCsv(b: Brightness): string {
  const head = "date_utc,mjd,detector,wavelength_um,bandwidth_um,flux_ujy,flux_err_ujy,saturated_core_pixels,time_bin";
  const rows = b.exposures.map((e) => [e.date, e.mjd.toFixed(6), e.detector, e.wavelengthUm, e.bandwidthUm, e.flux ?? "", e.fluxErr ?? "", e.saturatedPixels, e.bin].join(","));
  return [`# SEDNA brightness at RA ${b.point.ra.toFixed(5)} Dec ${b.point.dec.toFixed(5)}; method: ${b.method}. ${b.methodNote} Data: ${b.release}.`, head, ...rows].join("\n");
}
