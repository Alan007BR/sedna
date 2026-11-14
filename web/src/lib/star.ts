// What SIMBAD knows about a Gaia DR3 star the person clicked: contract, client and wording.
// Code written with AI assistance (Claude); see AI_USAGE.md.
import { z } from "zod";
import { ApiError } from "./api-error";
import { request } from "./transport";

export const StarSchema = z.object({
  schemaVersion: z.literal(1),
  gaiaId: z.string(),
  available: z.boolean(),
  found: z.boolean(),
  source: z.string().nullable(),
  name: z.string().nullable().optional(),
  mainId: z.string().nullable().optional(),
  type: z.string().nullable().optional(),
  spType: z.string().nullable().optional(),
  distancePc: z.number().nullable().optional(),
  designations: z.array(z.string()).optional(),
  identifiers: z.number().optional(),
  links: z.object({ simbad: z.string(), gaia: z.string() }),
});
export type Star = z.infer<typeof StarSchema>;

// one request per star for the whole session: reopening a card never asks again
const cache = new Map<string, Promise<Star>>();

export function fetchStar(gaiaId: string): Promise<Star> {
  let p = cache.get(gaiaId);
  if (!p) {
    p = request(`/api/star?gaia=${encodeURIComponent(gaiaId)}`).then((body) => {
      const parsed = StarSchema.safeParse(body);
      if (!parsed.success) throw new ApiError("BAD_RESPONSE", "The star's record came back in an unexpected shape.");
      return parsed.data;
    });
    p.catch(() => cache.delete(gaiaId));
    cache.set(gaiaId, p);
  }
  return p;
}

/** Links that open even when the service cannot be asked (the CfA mirror stayed up when CDS went offline). */
export const fallbackLinks = (gaiaId: string) => ({
  simbad: `https://simbad.cfa.harvard.edu/simbad/sim-id?Ident=Gaia%20DR3%20${gaiaId}`,
  gaia: `https://vizier.cfa.harvard.edu/viz-bin/VizieR-5?-source=I/355/gaiadr3&Source=${gaiaId}`,
});

const LIGHT_YEARS_PER_PC = 3.26156;

/** The facts line: what it is, its spectral type, how far. */
export function starFacts(s: Star): string[] {
  const out: string[] = [];
  if (s.type) out.push(s.type.replace(/\bvariable\b/i, "variable").replace(/^(\w)/, (c) => c.toUpperCase()));
  if (s.spType) out.push(`spectral type ${s.spType}`);
  if (s.distancePc) {
    const ly = s.distancePc * LIGHT_YEARS_PER_PC;
    out.push(s.distancePc < 100 ? `${s.distancePc.toFixed(s.distancePc < 10 ? 2 : 1)} pc (${ly.toFixed(ly < 10 ? 1 : 0)} light-years)` : `${Math.round(s.distancePc).toLocaleString("en")} pc`);
  }
  return out;
}

/** The name to show: SIMBAD's usual name, else its main identifier, else nothing. */
export const starName = (s: Star) => s.name ?? (s.found ? s.mainId ?? null : null);
