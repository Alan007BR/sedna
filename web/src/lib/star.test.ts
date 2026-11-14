// The clicked-star card: contract, wording and the one-request-per-star cache.
// Code written with AI assistance (Claude); see AI_USAGE.md.
import { describe, expect, it, vi } from "vitest";
import { StarSchema, starFacts, starName } from "./star";

const barnard = StarSchema.parse({
  schemaVersion: 1,
  gaiaId: "4472832130942575872",
  available: true,
  found: true,
  source: "SIMBAD (CfA mirror)",
  name: "Barnard's star",
  mainId: "Barnard's star",
  type: "BY Dra Variable",
  spType: "M4V",
  distancePc: 1.83,
  designations: ["HIP 87937", "GJ 699"],
  identifiers: 53,
  links: { simbad: "https://simbad.cfa.harvard.edu/simbad/sim-id?Ident=Gaia%20DR3%204472832130942575872", gaia: "https://vizier.cfa.harvard.edu/viz-bin/VizieR-5?-source=I/355/gaiadr3&Source=4472832130942575872" },
});

describe("star card", () => {
  it("names a famous star and says what it is and how far", () => {
    expect(starName(barnard)).toBe("Barnard's star");
    expect(starFacts(barnard)).toEqual(["BY Dra variable", "spectral type M4V", "1.83 pc (6.0 light-years)"]);
  });

  it("gives no name to a star SIMBAD does not have", () => {
    const anon = StarSchema.parse({ schemaVersion: 1, gaiaId: "4472833062943297024", available: true, found: false, source: "SIMBAD (CfA mirror)", links: barnard.links });
    expect(starName(anon)).toBeNull();
    expect(starFacts(anon)).toEqual([]);
  });

  it("asks the service once per star, however often the card opens", async () => {
    vi.resetModules();
    const request = vi.fn().mockResolvedValue({ ...barnard });
    vi.doMock("./transport", () => ({ request }));
    const { fetchStar } = await import("./star");
    await fetchStar("4472832130942575872");
    await fetchStar("4472832130942575872");
    expect(request).toHaveBeenCalledTimes(1);
    vi.doUnmock("./transport");
  });
});
