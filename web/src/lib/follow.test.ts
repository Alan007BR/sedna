// Find Sedna: contract and wording, against the recorded service response.
// Code written with AI assistance (Claude); see AI_USAGE.md.
import { describe, expect, it } from "vitest";
import recorded from "./__fixtures__/follow-sedna.json";
import { FollowSchema, followSummary, noiseLimits, visitLabel, type Follow } from "./follow";

const parsed = FollowSchema.parse(recorded);
const asFollow = (r: typeof parsed): Follow => ({
  ...r,
  visits: r.visits.map(({ stack: _s, ...v }) => ({ ...v, image: null })),
  combined: { ...r.combined, image: null },
  single: null,
});

describe("find Sedna", () => {
  it("accepts the recorded response: three visits stacked in D1-D3", () => {
    expect(parsed.body).toBe("sedna");
    expect(parsed.visits).toHaveLength(3);
    expect(parsed.detectors).toEqual([1, 2, 3]);
    expect(parsed.combined.exposures).toBe(161);
  });

  it("calls it seen only with S/N 5 or more and no control track as high", () => {
    const f = asFollow(parsed);
    expect(followSummary(f)).toMatch(/^Stacked along its orbit, Sedna appears as a point at S\/N 9\.8, from 161 exposures\. None of 200 control tracks/);
    const weak = { ...f, combined: { ...f.combined, snr: 3.1, controlsAtOrAbove: 4 } };
    expect(followSummary(weak)).toMatch(/reaches only S\/N 3\.1 .* 4 of 200 control tracks reach it too, so this is not a detection\.$/);
  });

  it("labels each visit with its month, exposures and S/N", () => {
    expect(visitLabel(asFollow(parsed).visits[0])).toBe("Aug 2025 · 52 exposures · S/N 4.8");
  });

  it("stretches a stamp against its own noise", () => {
    const n = 21;
    const img = new Float32Array(n * n).map((_, i) => ((i * 7919) % 13) / 13 - 0.5); // deterministic noise
    img[10 * n + 10] = 9;
    const { lo, hi } = noiseLimits(img, n);
    expect(lo).toBeLessThan(0);
    expect(hi).toBeGreaterThan(0);
    expect(hi).toBeLessThan(9); // the source at the centre does not set the scale
  });
});
