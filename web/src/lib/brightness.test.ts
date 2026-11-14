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

  it("exports every exposure as CSV with units in the header", () => {
    const lines = toCsv(data).split("\n");
    expect(lines[1]).toContain("flux_ujy");
    expect(lines.length).toBe(data.exposures.length + 2);
  });
});
