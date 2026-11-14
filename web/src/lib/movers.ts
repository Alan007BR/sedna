// Known Solar System bodies that crossed the field: contract, client and display definitions.
// The service decides which bodies crossed and where; this file only validates and labels.
// Code written with AI assistance (Claude); see AI_USAGE.md.
import { z } from "zod";
import { ApiError } from "./api";

const TrackPoint = z.object({ mjd: z.number(), ra: z.number(), dec: z.number() });
const MoverSchema = z.object({
  name: z.string(),
  number: z.number().int().nullable(),
  category: z.string(),
  vMag: z.number().nullable(),
  visible: z.boolean(),
  rateArcsecPerHour: z.number(),
  distanceAu: z.number().nullable(),
  visit: z.number().int(),
  firstInField: z.string(),
  lastInField: z.string(),
  closestDate: z.string(),
  closestMjd: z.number(),
  closestArcsec: z.number(),
  track: z.array(TrackPoint),
});
export const MoversSchema = z.object({
  schemaVersion: z.literal(1),
  release: z.string(),
  center: z.object({ ra: z.number(), dec: z.number() }),
  fovArcmin: z.number(),
  status: z.enum(["ok", "partial", "unavailable"]),
  queries: z.number().int(),
  failedQueries: z.number().int(),
  visibleV: z.number(),
  maxRateArcsecPerHour: z.number(),
  visits: z.array(z.object({ index: z.number().int(), start: z.string(), end: z.string() })),
  movers: z.array(MoverSchema),
  fainter: z.number().int(),
  method: z.string(),
  seconds: z.number(),
  source: z.enum(["archive", "cache"]),
});
export type Mover = z.infer<typeof MoverSchema>;
export type Movers = z.infer<typeof MoversSchema>;

export async function fetchMovers(ra: number, dec: number, fov: number, signal?: AbortSignal): Promise<Movers> {
  let response: Response;
  try {
    response = await fetch(`/api/movers?ra=${ra.toFixed(5)}&dec=${dec.toFixed(5)}&fov=${fov}`, { signal });
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    throw new ApiError("SERVICE_UNREACHABLE", "The SEDNA data service did not answer.");
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(body?.detail?.code ?? "ERROR", body?.detail?.message ?? `The data service returned an error (${response.status}).`);
  const parsed = MoversSchema.safeParse(body);
  if (!parsed.success) throw new ApiError("BAD_RESPONSE", "The known-object list came back in an unexpected shape.");
  return parsed.data;
}

const DWARF_PLANETS = new Set(["Ceres", "Pluto", "Haumea", "Makemake", "Eris"]);
const CATEGORY_LABELS: [string, string][] = [
  ["NEA", "near-Earth asteroid"],
  ["MB", "main-belt asteroid"],
  ["Mars-Crosser", "Mars-crossing asteroid"],
  ["Hungaria", "Hungaria asteroid"],
  ["Trojan", "Jupiter trojan"],
  ["Centaur", "centaur"],
  ["KBO", "trans-Neptunian object"],
  ["TNO", "trans-Neptunian object"],
  ["Comet", "comet"],
  ["Planet", "planet"],
];

export function categoryLabel(m: Pick<Mover, "name" | "category">): string {
  if (DWARF_PLANETS.has(m.name)) return "dwarf planet";
  const hit = CATEGORY_LABELS.find(([prefix]) => m.category.startsWith(prefix));
  return hit ? hit[1] : m.category.toLowerCase() || "Solar System object";
}

const day = (iso: string) => new Date(iso.replace(" ", "T").replace(/Z?$/, "Z"));
export function spanLabel(m: Pick<Mover, "firstInField" | "lastInField">): string {
  const a = day(m.firstInField);
  const b = day(m.lastInField);
  const dm = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  const year = (d: Date) => d.getUTCFullYear();
  if (dm(a) === dm(b) && year(a) === year(b)) return `${dm(a)} ${year(a)}`;
  return year(a) === year(b) ? `${dm(a)} – ${dm(b)} ${year(b)}` : `${dm(a)} ${year(a)} – ${dm(b)} ${year(b)}`;
}

/** The service's track point for an exposure taken at ``mjd``, if the body was in the field then. */
export function trackPointAt(m: Mover, mjd: number, toleranceDays = 0.01) {
  let best: Mover["track"][number] | null = null;
  for (const p of m.track) if (Math.abs(p.mjd - mjd) <= toleranceDays && (!best || Math.abs(p.mjd - mjd) < Math.abs(best.mjd - mjd))) best = p;
  return best;
}
