// Parallax ruler and next-visit check: contracts, clients and display helpers.
// The service computes every position; these functions only validate, format and lay out.
// Code written with AI assistance (Claude); see AI_USAGE.md.
import { z } from "zod";
import { ApiError, decode } from "./api";

const Dated = z.object({ ra: z.number(), dec: z.number(), mjd: z.number(), date: z.string() });

export const RulerSchema = z.object({
  schemaVersion: z.literal(1),
  anchor: Dated,
  to: Dated,
  fovArcmin: z.number(),
  marks: z.array(
    z.object({
      distanceAu: z.number(),
      label: z.string(),
      ra: z.number(),
      dec: z.number(),
      eastArcsec: z.number(),
      northArcsec: z.number(),
      shiftArcsec: z.number(),
      inField: z.boolean(),
    }),
  ),
  staysInFieldBeyondAu: z.number().nullable(),
  assumption: z.string(),
});
export type Ruler = z.infer<typeof RulerSchema>;

export const NextVisitSchema = z.object({
  schemaVersion: z.literal(1),
  release: z.string(),
  status: z.enum(["found", "not_found", "not_observed"]),
  body: z.string().nullable(),
  name: z.string(),
  seed: Dated,
  distanceAu: z.number(),
  spread: z.number(),
  predicted: Dated.nullable(),
  daysAhead: z.number().nullable(),
  jumpDeg: z.number().nullable(),
  arc: z.array(z.object({ distanceAu: z.number(), ra: z.number(), dec: z.number() })),
  window: z.object({ start: z.string(), end: z.string(), exposures: z.number().int() }).nullable(),
  grid: z.object({ size: z.number().int(), pixelScaleArcsec: z.number(), center: z.object({ ra: z.number(), dec: z.number() }) }).nullable(),
  tracked: z.string().nullable(),
  static: z.string().nullable(),
  found: z.object({ ra: z.number(), dec: z.number(), snr: z.number(), halves: z.tuple([z.number(), z.number()]), offsetArcmin: z.number() }).nullable(),
  truth: z.object({ ra: z.number(), dec: z.number(), predictionErrorArcmin: z.number(), foundErrorArcsec: z.number().nullable(), source: z.string() }).nullable(),
  known: z.object({ status: z.string(), message: z.string(), name: z.string().optional(), separationArcsec: z.number().optional() }).passthrough().nullable(),
  method: z.string(),
  seconds: z.number(),
  source: z.enum(["archive", "cache"]),
});
export type NextVisitRaw = z.infer<typeof NextVisitSchema>;
export type NextVisit = Omit<NextVisitRaw, "tracked" | "static"> & { tracked: Float32Array | null; static: Float32Array | null };

async function getJson(url: string, signal?: AbortSignal) {
  let response: Response;
  try {
    response = await fetch(url, { signal });
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    throw new ApiError("SERVICE_UNREACHABLE", "The SEDNA data service did not answer. Try again in a moment.");
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(body?.detail?.code ?? "ERROR", body?.detail?.message ?? `The data service returned an error (${response.status}).`);
  return body;
}

export async function fetchRuler(ra: number, dec: number, mjdA: number, mjdB: number, fov: number, signal?: AbortSignal): Promise<Ruler> {
  const body = await getJson(`/api/parallax-ruler?ra=${ra.toFixed(5)}&dec=${dec.toFixed(5)}&mjd_a=${mjdA.toFixed(4)}&mjd_b=${mjdB.toFixed(4)}&fov=${fov}`, signal);
  const parsed = RulerSchema.safeParse(body);
  if (!parsed.success) throw new ApiError("BAD_RESPONSE", "The parallax ruler came back in an unexpected shape.");
  return parsed.data;
}

export type NextVisitQuery = { body: string; visit: number } | { ra: number; dec: number; mjd: number; distance: number };

export async function fetchNextVisit(q: NextVisitQuery, signal?: AbortSignal): Promise<NextVisit> {
  const url =
    "body" in q
      ? `/api/next-visit?body=${encodeURIComponent(q.body)}&visit=${q.visit}`
      : `/api/next-visit-at?ra=${q.ra.toFixed(5)}&dec=${q.dec.toFixed(5)}&mjd=${q.mjd.toFixed(5)}&distance=${q.distance.toFixed(2)}`;
  const parsed = NextVisitSchema.safeParse(await getJson(url, signal));
  if (!parsed.success) throw new ApiError("BAD_RESPONSE", "The next-visit check came back in an unexpected shape.");
  const raw = parsed.data;
  return { ...raw, tracked: raw.tracked ? decode(raw.tracked) : null, static: raw.static ? decode(raw.static) : null };
}

/** An angle in the largest unit that reads well: degrees, arcminutes or arcseconds. */
export function formatAngle(arcsec: number): string {
  if (arcsec >= 3600) return `${(arcsec / 3600).toFixed(1)}°`;
  if (arcsec >= 60) return `${(arcsec / 60).toFixed(arcsec >= 600 ? 0 : 1)}′`;
  return `${arcsec.toFixed(arcsec >= 10 ? 0 : 1)}″`;
}

export const dayLabel = (iso: string) => new Date(iso.replace(" ", "T").replace(/Z?$/, "Z")).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** One sentence for the ruler: how far bodies at the ladder's distances would jump, and what stays in view. */
export function rulerSummary(r: Ruler): string {
  const bodies = r.marks.filter((m) => m.distanceAu < 1e5);
  const off = bodies.filter((m) => !m.inField);
  const parts = bodies.map((m) => `${formatAngle(m.shiftArcsec)} at ${m.label}`).join(", ");
  const stay =
    r.staysInFieldBeyondAu === null
      ? "No Solar System distance keeps a body inside this field."
      : `Only bodies farther than about ${Math.round(r.staysInFieldBeyondAu).toLocaleString("en")} au stay inside this ${r.fovArcmin}′ field.`;
  const lead = `Between ${dayLabel(r.anchor.date)} and ${dayLabel(r.to.date)}, a body seen here would move ${parts}.`;
  return off.length ? `${lead} ${stay}` : lead;
}

/** Unit direction (in screen pixels: x right, y down) in which the off-field marks lie, from the anchor. */
export function offFieldDirection(r: Ruler): { x: number; y: number } | null {
  const off = r.marks.filter((m) => !m.inField);
  if (!off.length) return null;
  const m = off[0];
  const len = Math.hypot(m.eastArcsec, m.northArcsec) || 1;
  return { x: -m.eastArcsec / len, y: -m.northArcsec / len }; // east is left, north is up
}

/** A square crop of a row-major image (row 0 south), centred on grid pixel (x, y); NaN outside. */
export function crop(img: Float32Array, size: number, x: number, y: number, half: number): Float32Array {
  const n = 2 * half + 1;
  const out = new Float32Array(n * n).fill(NaN);
  const cx = Math.round(x);
  const cy = Math.round(y);
  for (let j = 0; j < n; j++) {
    const row = cy - half + j;
    if (row < 0 || row >= size) continue;
    for (let i = 0; i < n; i++) {
      const col = cx - half + i;
      if (col >= 0 && col < size) out[j * n + i] = img[row * size + col];
    }
  }
  return out;
}

/** Plain-language result of the next-visit check. */
export function nextVisitSummary(nv: NextVisit): string {
  const name = nv.body ? nv.name : "The point";
  if (nv.status === "not_observed" || !nv.predicted) {
    return `SPHEREx has not observed the predicted position again in the indexed data, so ${nv.body ? nv.name : "this candidate"} cannot be checked yet.`;
  }
  const when = `${dayLabel(nv.predicted.date)}, ${Math.round(nv.daysAhead ?? 0)} days later`;
  const jump = `${(nv.jumpDeg ?? 0).toFixed(1)}° from where it was`;
  if (nv.status === "found" && nv.found) {
    const truth = nv.truth?.foundErrorArcsec != null ? ` JPL Horizons puts ${nv.name} ${nv.truth.foundErrorArcsec.toFixed(1)}″ from that point.` : "";
    const known = nv.known?.status === "known" && nv.known.name ? ` IMCCE SkyBoT identifies it as ${nv.known.name}.` : nv.known?.status === "none" ? " No known object is listed there: it remains a candidate for follow-up, not a discovery." : "";
    return `Found again on ${when}, ${jump} and ${nv.found.offsetArcmin.toFixed(1)}′ from the prediction, at S/N ${nv.found.snr.toFixed(0)}.${truth}${known}`;
  }
  const miss = nv.truth ? ` JPL Horizons puts ${nv.name} ${nv.truth.predictionErrorArcmin.toFixed(0)}′ from the prediction.` : "";
  return `${name === "The point" ? "The point was" : `${name} was`} not found in the predicted region on ${when}.${miss} An unconfirmed focus stays a candidate.`;
}
