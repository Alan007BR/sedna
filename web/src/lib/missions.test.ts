// Guided missions: steps advance only on the right action, in order, and never go back.
// Code written with AI assistance (Claude); see AI_USAGE.md.
import { describe, expect, it } from "vitest";
import { advance, missionById, MISSIONS, type MissionContext } from "./missions";

const base: MissionContext = { mode: "blink", det: 2, target: "barnard", seenAllVisits: false, pickedMotionArcsecYr: null, focusStep: null, focusRevealed: false };

describe("missions", () => {
  it("has three missions on built-in targets, each with three steps", () => {
    expect(MISSIONS.map((m) => m.id)).toEqual(["walk", "infrared", "distance"]);
    for (const m of MISSIONS) expect(m.steps).toHaveLength(3);
    expect(missionById("nope")).toBeNull();
  });

  it("walks Barnard's Star step by step", () => {
    const m = missionById("walk")!;
    expect(advance(m, 0, base)).toBe(0);
    expect(advance(m, 0, { ...base, seenAllVisits: true })).toBe(1);
    expect(advance(m, 1, { ...base, mode: "diff" })).toBe(2);
    expect(advance(m, 2, { ...base, pickedMotionArcsecYr: 0.02 })).toBe(2); // a slow star is not Barnard's
    expect(advance(m, 2, { ...base, pickedMotionArcsecYr: 10.39 })).toBe(3);
  });

  it("does not skip ahead: choosing Difference first does not finish step 1", () => {
    expect(advance(missionById("walk")!, 0, { ...base, mode: "diff" })).toBe(0);
  });

  it("needs a second play in D6 for the infrared mission", () => {
    const m = missionById("infrared")!;
    const c = { ...base, target: "wise0855", det: 1, seenAllVisits: true };
    expect(advance(m, 0, c)).toBe(1);
    expect(advance(m, 1, { ...c, det: 6, seenAllVisits: false })).toBe(2);
    expect(advance(m, 2, { ...c, det: 6, seenAllVisits: true })).toBe(3);
  });

  it("follows the distance focus to the check", () => {
    const m = missionById("distance")!;
    const c = { ...base, target: "makemake", mode: "focus" };
    expect(advance(m, 0, { ...c, focusStep: "watch" })).toBe(0);
    expect(advance(m, 0, { ...c, focusStep: "focus" })).toBe(1);
    expect(advance(m, 1, { ...c, focusStep: "focus", focusRevealed: true })).toBe(2);
    expect(advance(m, 0, { ...c, focusStep: "check", focusRevealed: true })).toBe(3);
  });
});
