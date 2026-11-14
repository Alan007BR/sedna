// Chart definitions of the brightness lens, checked against a recorded response for RW Aurigae.
// Code written with AI assistance (Claude); see AI_USAGE.md.
import { describe, expect, it } from "vitest";
import recorded from "./__fixtures__/brightness-rwaur.json";
import { BrightnessSchema, changeRows, defaultSpectrumBin, detectorColor, lightCurveSeries, spectrumBins, spectrumPoints, summary, toCsv } from "./brightness";

const data = BrightnessSchema.parse(recorded);

describe("brightness lens", () => {
  it("accepts the recorded response and rejects a broken one", () => {
    expect(data.method).toBe("aperture");
    const { change: _dropped, ...broken } = recorded as Record<string, unknown>;
    expect(BrightnessSchema.safeParse(broken).success).toBe(false);
  });

  it("keeps one light-curve series per detector, in time order", () => {
    const series = lightCurveSeries(data);
    expect(series.map((s) => s.detector)).toEqual([1, 2, 3, 4, 5, 6]);
    for (const s of series) expect(s.points.map((p) => p.t)).toEqual([...s.points.map((p) => p.t)].sort((a, b) => a - b));
  });

  it("sorts a spectrum by wavelength and drops unmeasured exposures", () => {
    const bin = defaultSpectrumBin(data);
    expect(bin).not.toBeNull();
    const pts = spectrumPoints(data, bin as number);
    expect(pts.length).toBeGreaterThan(50);
    expect(pts.map((p) => p.x)).toEqual([...pts.map((p) => p.x)].sort((a, b) => a - b));
    expect(pts.every((p) => p.y > 0)).toBe(true);
  });

  it("offers only well-covered bins for the spectrum", () => {
    expect(spectrumBins(data).every((b) => b.measured >= 12)).toBe(true);
  });

  it("maps detectors to stable colour tokens", () => {
    expect(detectorColor(1)).toBe("var(--chart-d1)");
    expect(detectorColor(6)).toBe("var(--chart-d6)");
  });

  it("summarises RW Aurigae's fading at long wavelengths", () => {
    const rows = changeRows(data);
    const d5 = rows.find((r) => r.detector === 5);
    expect(d5?.firstToLast).toBeGreaterThan(0.5); // fainter by more than half a magnitude
    expect(summary(data)).toMatch(/^Between 2025-09-\d\d and 2026-09-\d\d it faded by 0\.\d\d magnitude at 3\.80–4\.44 µm \(detector 5\)\.$/);
  });

  it("does not report a jump seen in one detector only, or one below the method's floor", () => {
    const point = (bin: number, deltaMag: number) => ({ bin, midMjd: 60900 + bin * 180, deltaMag, error: 0.01, channels: 12, exposures: 30, reliable: true });
    const flat = (detector: number, last: number) => ({ detector, rangeUm: [1, 2] as [number, number], points: [point(0, 0), point(2, last)] });
    const lonely = { ...data, method: "wing" as const, neighbours: [], change: [flat(1, 0.02), flat(2, -0.27), flat(3, 0.01)] };
    expect(summary(lonely)).toMatch(/^No change larger than 0\.3 magnitude, seen in more than one detector/);
    const real = { ...data, method: "aperture" as const, neighbours: [], change: [flat(5, 0.7), flat(6, 0.6), flat(1, 0.0)] };
    expect(summary(real)).toMatch(/faded by 0\.70 magnitude .* \(detector 5\)\.$/);
  });

  it("warns when a bright neighbour shares the measuring ring", () => {
    const crowded = { ...data, neighbours: [{ separationArcsec: 4.8, g: 16.3, share: 0.93 }] };
    expect(summary(crowded)).toMatch(/A Gaia star \(G 16\.3\) lies 5″ from the point, inside the measuring ring and about 93% of the light measured here, so part of any change may come from it\.$/);
  });

  it("exports every exposure as CSV with units in the header", () => {
    const lines = toCsv(data).split("\n");
    expect(lines[1]).toContain("flux_ujy");
    expect(lines.length).toBe(data.exposures.length + 2);
  });
});

describe("brightness lens requests", () => {
  it("measures a point once per session: hiding and reopening asks nothing again", async () => {
    const { vi } = await import("vitest");
    vi.resetModules();
    const request = vi.fn().mockResolvedValue(recorded);
    vi.doMock("./transport", () => ({ request }));
    const { fetchBrightness } = await import("./brightness");
    await fetchBrightness(76.9566, 30.40129, "rwaur");
    await fetchBrightness(76.9566, 30.40129, "rwaur");
    expect(request).toHaveBeenCalledTimes(1);
    vi.doUnmock("./transport");
  });
});
