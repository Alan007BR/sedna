// Plain words for every way of looking at a field, and the visit caption.
// Code written with AI assistance (Claude); see AI_USAGE.md.
import { describe, expect, it } from "vitest";
import { exposuresLabel, modeHelp, MODES, visitTitle } from "./modes";

describe("modes in plain words", () => {
  it("explains every mode in one short sentence", () => {
    for (const m of MODES) {
      expect(m.help.length).toBeGreaterThan(30);
      expect(m.help.length).toBeLessThanOrEqual(90); // fits three lines of the narrow control column
    }
    expect(modeHelp("film")).toMatch(/one visit/);
    expect(modeHelp("blink")).toMatch(/per visit/);
  });

  it("numbers visits the way the single exposures do", () => {
    expect(visitTitle(0, 3, "Jun 2025")).toBe("Visit 1 of 3 · Jun 2025");
    expect(exposuresLabel(21, true)).toBe("mean of 21 exposures");
    expect(exposuresLabel(1, false)).toBe("1 exposure");
  });
});
