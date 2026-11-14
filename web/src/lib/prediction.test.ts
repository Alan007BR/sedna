// Parallax ruler and next-visit check, against recorded service responses.
// Code written with AI assistance (Claude); see AI_USAGE.md.
import { describe, expect, it } from "vitest";
import haumea from "./__fixtures__/next-visit-haumea.json";
import makemake from "./__fixtures__/next-visit-makemake.json";
import ruler from "./__fixtures__/ruler-makemake.json";
import { formatAngle, NextVisitSchema, nextVisitSummary, offFieldDirection, RulerSchema, rulerSummary, type NextVisit } from "./prediction";

const asVisit = (raw: unknown): NextVisit => ({ ...NextVisitSchema.parse(raw), tracked: null, static: null });

describe("parallax ruler", () => {
  const r = RulerSchema.parse(ruler);

  it("lists 50, 100, 300, 500 au and a star at 2 pc", () => {
    expect(r.marks.map((m) => m.label)).toEqual(["50 au", "100 au", "300 au", "500 au", "2 pc (a nearby star)"]);
    expect(r.marks.slice(0, 4).every((m) => !m.inField)).toBe(true);
    expect(r.marks[4].inField).toBe(true);
  });

  it("says how far bodies jump and which ones stay in the field", () => {
    const text = rulerSummary(r);
    expect(text).toMatch(/^Between 8 Jun 2025 and \d+ \w+ 202\d, a body seen here would move 2\.8° at 50 au/);
    expect(text).toMatch(/Only bodies farther than about [\d,]+ au stay inside this 6′ field\.$/);
  });

  it("points the off-field arrow the way the bodies went (east is left on screen)", () => {
    const dir = offFieldDirection(r)!;
    const m = r.marks[0];
    expect(Math.sign(dir.x)).toBe(-Math.sign(m.eastArcsec));
    expect(Math.hypot(dir.x, dir.y)).toBeCloseTo(1, 6);
  });

  it("formats angles in readable units", () => {
    expect(formatAngle(9936)).toBe("2.8°");
    expect(formatAngle(862)).toBe("14′");
    expect(formatAngle(90)).toBe("1.5′");
    expect(formatAngle(1.2)).toBe("1.2″");
  });
});

describe("next-visit check", () => {
  it("reports a confirmed body with its distance to JPL's position", () => {
    const text = nextVisitSummary(asVisit(makemake));
    expect(text).toMatch(/^Found again on .+, 20\d days later, 2\.8° from where it was and 16\.0′ from the prediction, at S\/N 9\. JPL Horizons puts Makemake 2\.5″ from that point\.$/);
  });

  it("says plainly when the body is not found", () => {
    const text = nextVisitSummary(asVisit(haumea));
    expect(text).toMatch(/^Haumea was not found in the predicted region on .+\. JPL Horizons puts Haumea 5′ from the prediction\. An unconfirmed focus stays a candidate\.$/);
  });

  it("handles a position SPHEREx has not observed again", () => {
    const raw = { ...(makemake as Record<string, unknown>), status: "not_observed", predicted: null, found: null, truth: null };
    expect(nextVisitSummary(asVisit(raw))).toMatch(/has not observed the predicted position again/);
  });
});
