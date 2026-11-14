// The start page's definitions: the film's timing and sprite, the cards, and when the intro plays.
// Code written with AI assistance (Claude); see AI_USAGE.md.
import { describe, expect, it } from "vitest";
import { filmTicks, frameHold, introPlan, LANDING_FILM, MISSION_CARDS, SEDNA_CARD, spritePosition, TARGET_CARDS } from "./landing";
import { MISSIONS } from "./missions";

describe("start page", () => {
  it("shows Makemake's passes in time order, placed on a real time axis", () => {
    const f = LANDING_FILM.frames;
    expect(f.length).toBeGreaterThanOrEqual(5);
    expect(f.map((x) => x.mjd)).toEqual([...f.map((x) => x.mjd)].sort((a, b) => a - b));
    const ticks = filmTicks(f);
    expect(ticks[0]).toBe(0);
    expect(ticks[ticks.length - 1]).toBeCloseTo(100);
    expect(ticks.every((t, i) => i === 0 || t >= ticks[i - 1])).toBe(true);
  });

  it("steps the sprite one whole frame at a time and holds the last pass", () => {
    expect(spritePosition(0, 10)).toBe("0.0000% 0%");
    expect(spritePosition(9, 10)).toBe("100.0000% 0%");
    expect(frameHold(3, 10)).toBe(650);
    expect(frameHold(9, 10)).toBeGreaterThan(1500);
  });

  it("has an image and a short line for every challenge target and mission", () => {
    for (const id of ["barnard", "wise0855", "epsindib", "rwaur", "rdra"]) {
      expect(TARGET_CARDS[id]?.image).toMatch(/^landing\/target-.+\.png$/);
      expect(TARGET_CARDS[id].fact.length).toBeLessThanOrEqual(48);
    }
    for (const m of MISSIONS) {
      expect(MISSION_CARDS[m.id]?.image).toMatch(/^landing\/mission-.+\.png$/);
      expect(MISSION_CARDS[m.id].text.length).toBeLessThanOrEqual(60);
    }
    expect(SEDNA_CARD.text.length).toBeLessThanOrEqual(60);
  });

  it("plays the intro once a session, never under reduced motion, and on request", () => {
    expect(introPlan({ reducedMotion: false, seen: false, param: null })).toBe("arrival");
    expect(introPlan({ reducedMotion: false, seen: true, param: null })).toBeNull();
    expect(introPlan({ reducedMotion: true, seen: false, param: "convergence" })).toBeNull();
    expect(introPlan({ reducedMotion: false, seen: false, param: "0" })).toBeNull();
    expect(introPlan({ reducedMotion: false, seen: true, param: "convergence" })).toBe("convergence");
  });
});
