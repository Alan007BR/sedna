// Searching one visit of a field for moving bodies, with no starting point: contract, client and the words for it.
// Code written with AI assistance (Claude); see AI_USAGE.md.
import { z } from "zod";
import { decode } from "./api";
import { ApiError } from "./api-error";
import { categoryLabel } from "./movers";
import { request } from "./transport";

const KnownSchema = z.object({
  status: z.enum(["known", "none", "unavailable"]),
  message: z.string(),
  name: z.string().optional(),
  number: z.number().nullable().optional(),
  class: z.string().optional(),
  vMag: z.number().nullable().optional(),
  separationArcsec: z.number().optional(),
});

const CandidateSchema = z.object({
  rank: z.number().int(),
  ra: z.number(),
  dec: z.number(),
  mjd: z.number(),
  date: z.string(),
  x: z.number().int(),
  y: z.number().int(),
  snr: z.number(),
  halves: z.tuple([z.number(), z.number()]),
  distanceAu: z.number(),
  motionArcsec: z.number(),
  aboveNoise: z.boolean(),
  known: KnownSchema.nullable(),
  track: z.array(z.object({ mjd: z.number(), ra: z.number(), dec: z.number() })),
});

export const SearchSchema = z.object({
  schemaVersion: z.literal(1),
  release: z.string(),
  center: z.object({ ra: z.number(), dec: z.number() }),
  fovArcmin: z.number(),
  grid: z.object({ size: z.number().int(), pixelScaleArcsec: z.number() }),
  visit: z.number().int(),
  visits: z.number().int(),
  window: z.object({ start: z.string(), end: z.string(), exposures: z.number().int() }),
  templates: z.number().int(),
  distancesAu: z.tuple([z.number(), z.number()]),
  threshold: z.number(),
  candidates: z.array(CandidateSchema),
  noisePeaks: z.array(z.number()),
  map: z.string(),
  method: z.string(),
  limit: z.string(),
  seconds: z.number(),
  source: z.enum(["archive", "cache"]),
});

type Raw = z.infer<typeof SearchSchema>;
export type Candidate = Raw["candidates"][number];
export type Search = Omit<Raw, "map"> & { map: Float32Array };

export async function fetchSearch(ra: number, dec: number, fov: number, visit: number, signal?: AbortSignal): Promise<Search> {
  const body = await request(`/api/search?ra=${ra.toFixed(5)}&dec=${dec.toFixed(5)}&fov=${fov}&visit=${visit}`, signal);
  const parsed = SearchSchema.safeParse(body);
  if (!parsed.success) throw new ApiError("BAD_RESPONSE", "The field search came back in an unexpected shape.");
  return { ...parsed.data, map: decode(parsed.data.map) };
}

const days = (s: Search) => {
  const ms = Date.parse(s.window.end.replace(" ", "T")) - Date.parse(s.window.start.replace(" ", "T"));
  return Math.max(1, Math.round(ms / 86400000));
};

/** One line per candidate: how strong, how far, how much it moved, and what it is if SkyBoT knows it. */
export function candidateLine(c: Candidate): string {
  const moved = c.motionArcsec >= 60 ? `${(c.motionArcsec / 60).toFixed(1)}′` : `${Math.round(c.motionArcsec)}″`;
  return `S/N ${c.snr.toFixed(1)} · ${c.distanceAu.toFixed(1)} au · moved ${moved}`;
}

export function knownLine(c: Candidate): string | null {
  const k = c.known;
  if (!k) return null;
  if (k.status === "known" && k.name) return `${k.name}, a known ${categoryLabel({ name: k.name, category: k.class ?? "" })} (IMCCE SkyBoT, ${Number(k.separationArcsec ?? 0).toFixed(1)}″ away)`;
  if (k.status === "none") return "No known asteroid or comet there (IMCCE SkyBoT): worth a second look, not a discovery.";
  return "The known-object check (IMCCE SkyBoT) did not answer.";
}

/** What the search found, in one sentence. */
export function searchSummary(s: Search): string {
  const n = s.candidates.length;
  const d = days(s);
  const span = `${s.window.exposures} exposures over ${d} day${d === 1 ? "" : "s"}`;
  if (n === 0) return `No moving body stands out in this visit. SEDNA shifted and stacked ${span} for every trial distance from ${s.distancesAu[0]} to ${s.distancesAu[1]} au.`;
  return `${n === 1 ? "One moving body stands out" : `${n} moving bodies stand out`} in ${span}, searched at every trial distance from ${s.distancesAu[0]} to ${s.distancesAu[1]} au.`;
}

/** How strong noise alone gets in this field, so a candidate can be weighed against it. */
export function noiseLine(s: Search): string {
  if (s.noisePeaks.length === 0) return `Noise alone gives no peak of S/N ${s.threshold} or more here (the same search on the negated exposures).`;
  const top = Math.max(...s.noisePeaks);
  return `Noise alone reaches S/N ${top.toFixed(1)} here (the same search on the negated exposures): a candidate below that is not reliable.`;
}
