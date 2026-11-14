// Following a known faint body (90377 Sedna) along its orbit: contract, client and display helpers.
// Code written with AI assistance (Claude); see AI_USAGE.md.
import { z } from "zod";
import { decode } from "./api";
import { ApiError } from "./api-error";
import { request } from "./transport";

const StackSchema = z.object({
  label: z.string(),
  start: z.string().nullable(),
  end: z.string().nullable(),
  exposures: z.number().int(),
  snr: z.number(),
  controlSd: z.number(),
  controlMax: z.number(),
  controlsAtOrAbove: z.number().int(),
  controls: z.number().int(),
  stack: z.string().nullable(),
});
export const FollowSchema = z.object({
  schemaVersion: z.literal(1),
  release: z.string(),
  body: z.string(),
  name: z.string(),
  distanceAu: z.number(),
  vMag: z.number().nullable(),
  detectors: z.array(z.number().int()),
  wavelengthUm: z.tuple([z.number(), z.number()]),
  stampSize: z.number().int(),
  pixelScaleArcsec: z.number(),
  visits: z.array(StackSchema),
  combined: StackSchema,
  single: z.object({ date: z.string(), detector: z.number().int(), snr: z.number(), medianSnr: z.number(), stamp: z.string() }).nullable(),
  method: z.string(),
  seconds: z.number(),
  source: z.enum(["archive", "cache"]),
});
type Raw = z.infer<typeof FollowSchema>;
export type FollowStack = Omit<Raw["visits"][number], "stack"> & { image: Float32Array | null };
export type Follow = Omit<Raw, "visits" | "combined" | "single"> & {
  visits: FollowStack[];
  combined: FollowStack;
  single: (Omit<NonNullable<Raw["single"]>, "stamp"> & { image: Float32Array }) | null;
};

const unpack = ({ stack, ...s }: Raw["visits"][number]): FollowStack => ({ ...s, image: stack ? decode(stack) : null });

export async function fetchFollow(body: string, signal?: AbortSignal): Promise<Follow> {
  const parsed = FollowSchema.safeParse(await request(`/api/follow?body=${encodeURIComponent(body)}`, signal));
  if (!parsed.success) throw new ApiError("BAD_RESPONSE", "The stack along the orbit came back in an unexpected shape.");
  const r = parsed.data;
  return {
    ...r,
    visits: r.visits.map(unpack),
    combined: unpack(r.combined),
    single: r.single ? { ...r.single, image: decode(r.single.stamp) } : null,
  };
}

/**
 * Display limits for a stamp in units of its own noise: -2 to +6 sigma of the pixels away from the centre.
 * Each stamp is shown against its own noise, so what stands out is what is significant.
 */
export function noiseLimits(img: Float32Array, size: number): { lo: number; hi: number } {
  const c = (size - 1) / 2;
  const ring: number[] = [];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (Math.hypot(x - c, y - c) > 4 && Number.isFinite(img[y * size + x])) ring.push(img[y * size + x]);
  ring.sort((a, b) => a - b);
  const med = ring[Math.floor(ring.length / 2)] ?? 0;
  const dev = ring.map((v) => Math.abs(v - med)).sort((a, b) => a - b);
  const sigma = 1.4826 * (dev[Math.floor(dev.length / 2)] ?? 1) || 1;
  return { lo: med - 2 * sigma, hi: med + 6 * sigma };
}

const month = (iso: string | null) => (iso ? new Date(iso.replace(" ", "T").replace(/Z?$/, "Z")).toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" }) : "");
export const visitLabel = (s: FollowStack) => `${month(s.start)} · ${s.exposures} exposures · S/N ${s.snr.toFixed(1)}`;

/** The result in one sentence, with its control. */
export function followSummary(f: Follow): string {
  const c = f.combined;
  const detected = c.snr >= 5 && c.controlsAtOrAbove === 0;
  const control =
    c.controlsAtOrAbove === 0
      ? `None of ${c.controls} control tracks, with the same motion shifted 1 to 4 arcminutes, comes close: the highest reaches ${c.controlMax.toFixed(1)}.`
      : `${c.controlsAtOrAbove} of ${c.controls} control tracks reach it too, so this is not a detection.`;
  const name = f.name.replace(/^\d+\s/, "");
  return detected
    ? `Stacked along its orbit, ${name} appears as a point at S/N ${c.snr.toFixed(1)}, from ${c.exposures} exposures. ${control}`
    : `Stacked along its orbit, ${name} reaches only S/N ${c.snr.toFixed(1)} from ${c.exposures} exposures, not enough to call it seen. ${control}`;
}
