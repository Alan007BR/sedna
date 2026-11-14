// The name lookup: contract, motion to SPHEREx's dates, one request per name, and the words for misses.
// Code written with AI assistance (Claude); see AI_USAGE.md.
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "./api-error";
import { notFoundMessage, positionAt, ResolveSchema, unavailableMessage } from "./resolve";

// as /api/resolve answered for "Barnard's star" (SIMBAD through the CfA mirror of Sesame)
const barnard = ResolveSchema.parse({
  schemaVersion: 1,
  query: "Barnard's star",
  found: true,
  name: "Barnard's star",
  ra: 269.45208,
  dec: 4.69336,
  pmRa: -801.551,
  pmDec: 10362.394,
  epoch: 2000,
  type: "BY*",
  resolver: "Simbad",
  source: "Simbad via Sesame (CfA mirror)",
});

describe("name lookup", () => {
  it("moves a fast star to SPHEREx's dates, landing where the prepared case is centred", () => {
    const p = positionAt(barnard);
    expect(p.ra).toBeCloseTo(269.44629, 4);
    expect(p.dec).toBeCloseTo(4.76792, 4);
  });

  it("leaves objects without proper motion where the catalogue puts them", () => {
    const m31 = ResolveSchema.parse({ schemaVersion: 1, query: "Andromeda Galaxy", found: true, name: "M 31", ra: 10.68471, dec: 41.26875, pmRa: null, pmDec: null, epoch: 2000 });
    expect(positionAt(m31)).toEqual({ ra: 10.68471, dec: 41.26875 });
  });

  it("explains misses and an offline service in plain words", () => {
    expect(notFoundMessage("Ceres")).toMatch(/do not know "Ceres".*Asteroids and comets move/);
    expect(unavailableMessage(new ApiError("NOT_PREPARED", "x"))).toMatch(/needs the live data service/);
  });

  it("asks the service once per name, whatever the case and spacing", async () => {
    vi.resetModules();
    const request = vi.fn().mockResolvedValue({ ...barnard });
    vi.doMock("./transport", () => ({ request }));
    const { fetchResolve } = await import("./resolve");
    await fetchResolve("Barnard's star");
    await fetchResolve("  barnard's   STAR ");
    expect(request).toHaveBeenCalledTimes(1);
    vi.doUnmock("./transport");
  });
});
