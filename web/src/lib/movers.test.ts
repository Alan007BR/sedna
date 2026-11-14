// Contract and labels of the known-mover list, checked against a recorded service response.
// Code written with AI assistance (Claude); see AI_USAGE.md.
import { describe, expect, it } from "vitest";
import recorded from "./__fixtures__/movers-makemake.json";
import { categoryLabel, MoversSchema, spanLabel, trackPointAt } from "./movers";

describe("known movers", () => {
  const data = MoversSchema.parse(recorded);
  const makemake = data.movers[0];

  it("accepts the recorded response for Makemake's field", () => {
    expect(data.status).toBe("ok");
    expect(makemake.name).toBe("Makemake");
    expect(makemake.visit).toBe(0);
    expect(makemake.closestDate).toBe("2025-06-08 09:19Z");
  });

  it("rejects a response with a missing field", () => {
    const { movers: _dropped, ...broken } = recorded as Record<string, unknown>;
    expect(MoversSchema.safeParse(broken).success).toBe(false);
  });

  it("labels categories in plain words", () => {
    expect(categoryLabel(makemake)).toBe("dwarf planet");
    expect(categoryLabel({ name: "2001 AB", category: "MB>Inner" })).toBe("main-belt asteroid");
    expect(categoryLabel({ name: "C/2025 X", category: "Comet" })).toBe("comet");
    expect(categoryLabel({ name: "Odd", category: "Something>Else" })).toBe("something>else");
  });

  it("writes the crossing dates as one range", () => {
    expect(spanLabel(makemake)).toBe("2 Jun – 12 Jun 2025");
    expect(spanLabel({ firstInField: "2025-12-30 10:00Z", lastInField: "2026-01-02 10:00Z" })).toBe("30 Dec 2025 – 2 Jan 2026");
    expect(spanLabel({ firstInField: "2025-06-08 09:19Z", lastInField: "2025-06-08 09:25Z" })).toBe("8 Jun 2025");
  });

  it("finds the track point of an exposure and nothing far from it", () => {
    const p = trackPointAt(makemake, makemake.closestMjd + 0.0003); // exposures are 2 minutes (0.0015 d) apart
    expect(p?.mjd).toBe(makemake.closestMjd);
    expect(trackPointAt(makemake, makemake.closestMjd + 3)).toBeNull();
  });
});
