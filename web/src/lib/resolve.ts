// From a typed name to a sky position: contract, client, motion to SPHEREx's dates, and the words for misses.
// Code written with AI assistance (Claude); see AI_USAGE.md.
import { z } from "zod";
import { ApiError } from "./api-error";
import { request } from "./transport";

export const ResolveSchema = z.object({
  schemaVersion: z.literal(1),
  query: z.string(),
  found: z.boolean(),
  name: z.string().nullable().optional(),
  ra: z.number().nullable().optional(),
  dec: z.number().nullable().optional(),
  pmRa: z.number().nullable().optional(), // mas/yr, times cos(dec)
  pmDec: z.number().nullable().optional(),
  epoch: z.number(),
  type: z.string().nullable().optional(),
  resolver: z.string().nullable().optional(),
  source: z.string().nullable().optional(),
});
export type Resolved = z.infer<typeof ResolveSchema>;

/** The middle of SPHEREx's data so far: fast stars are moved here so they stay in the field (as the targets are). */
export const SPHEREX_EPOCH = 2025.9;

// one request per name for the session; a failed one may be asked again
const cache = new Map<string, Promise<Resolved>>();

export function fetchResolve(name: string, signal?: AbortSignal): Promise<Resolved> {
  const key = name.trim().replace(/\s+/g, " ").toLowerCase();
  let p = cache.get(key);
  if (!p) {
    p = request(`/api/resolve?name=${encodeURIComponent(name.trim())}`, signal).then((body) => {
      const parsed = ResolveSchema.safeParse(body);
      if (!parsed.success) throw new ApiError("BAD_RESPONSE", "The name lookup came back in an unexpected shape.");
      return parsed.data;
    });
    p.catch(() => cache.delete(key));
    cache.set(key, p);
  }
  return p;
}

/** Where a resolved object is at `year`, moved by its proper motion from the catalogue epoch. */
export function positionAt(r: Resolved, year = SPHEREX_EPOCH): { ra: number; dec: number } {
  const ra0 = r.ra ?? 0;
  const dec0 = r.dec ?? 0;
  const years = year - r.epoch;
  const dec = dec0 + ((r.pmDec ?? 0) * years) / 3.6e6;
  const ra = ra0 + ((r.pmRa ?? 0) * years) / 3.6e6 / Math.cos((dec0 * Math.PI) / 180);
  return { ra: ra < 0 ? ra + 360 : ra >= 360 ? ra - 360 : ra, dec };
}

/** What to say when no database knows the name. */
export function notFoundMessage(query: string): string {
  return `SIMBAD, NED and VizieR do not know "${query}". Asteroids and comets move and are not in them: type RA Dec, or use the distance focus.`;
}

/** What to say when the name lookup cannot be reached (offline service, or the resolver sites down). */
export function unavailableMessage(err: unknown): string {
  if (err instanceof ApiError && err.code === "NOT_PREPARED") return "Name search needs the live data service, which is not answering. Type RA Dec, or open a prepared case below.";
  if (err instanceof ApiError && err.message) return err.message;
  return "The name could not be looked up just now. Type RA Dec instead.";
}
