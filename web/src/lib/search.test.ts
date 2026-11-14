// Code written with AI assistance (Claude); see AI_USAGE.md.
import { describe, expect, it } from "vitest";
import { decode } from "./api";
import fixture from "./__fixtures__/search-makemake.json";
import { candidateLine, knownLine, noiseLine, SearchSchema, searchSummary, type Search } from "./search";

const raw = SearchSchema.parse(fixture);
const search: Search = { ...raw, map: decode(raw.map) };

describe("field search", () => {
  it("parses the service's answer for Makemake's field", () => {
    expect(search.candidates).toHaveLength(1);
    expect(search.map.length).toBe(search.grid.size * search.grid.size);
    expect(search.candidates[0].track).toHaveLength(search.window.exposures);
  });

  it("finds Makemake on its own, near its distance, and SkyBoT names it", () => {
    const c = search.candidates[0];
    expect(c.snr).toBeGreaterThan(20);
    expect(Math.abs(c.distanceAu - 52.4) / 52.4).toBeLessThan(0.1); // JPL Horizons: 52.4 au
    expect(c.aboveNoise).toBe(true);
    expect(knownLine(c)).toMatch(/^Makemake, a known dwarf planet \(IMCCE SkyBoT, 0\.\d″ away\)$/);
  });

  it("says what it found and how strong noise gets, in plain words", () => {
    expect(searchSummary(search)).toBe("One moving body stands out in 39 exposures over 4 days, searched at every trial distance from 25 to 293.2 au.");
    expect(candidateLine(search.candidates[0])).toBe("S/N 33.3 · 48.9 au · moved 2.3′");
    expect(noiseLine(search)).toMatch(/^Noise alone gives no peak of S\/N 5 or more here/);
    expect(noiseLine({ ...search, noisePeaks: [5.4, 6.1] })).toMatch(/^Noise alone reaches S\/N 6\.1 here/);
    expect(searchSummary({ ...search, candidates: [] })).toMatch(/^No moving body stands out in this visit\./);
  });
});
