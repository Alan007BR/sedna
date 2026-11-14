// What the start page shows, as data: the Makemake film, the cards of the challenge targets and missions,
// and when the brand intro plays. The images are rendered from real SPHEREx data by scripts/render-landing.py.
// Code written with AI assistance (Claude); see AI_USAGE.md.
import film from "./landing-film.json";

export type FilmFrame = { date: string; mjd: number; detector: number; obsid: string };
export const LANDING_FILM: { body: string; number: number; distanceAu: number; vMag: number; fovArcmin: number; sprite: string; frames: FilmFrame[] } = film;

/** Each pass's place on the film's timeline, in percent of the time between the first and last pass. */
export function filmTicks(frames: FilmFrame[]): number[] {
  if (frames.length < 2) return frames.map(() => 50);
  const first = frames[0].mjd;
  const span = frames[frames.length - 1].mjd - first;
  return frames.map((f) => (100 * (f.mjd - first)) / span);
}

/** CSS background-position of frame i in a horizontal sprite of n frames (background-size n × 100%). */
export function spritePosition(i: number, n: number): string {
  return n > 1 ? `${((100 * i) / (n - 1)).toFixed(4)}% 0%` : "0% 0%";
}

/** How long frame i stays on screen: the last pass holds a little before the film starts again. */
export function frameHold(i: number, n: number, ms = 650): number {
  return i === n - 1 ? Math.max(1600, ms * 2.5) : ms;
}

/** Short lines for the target cards; the full notes stay in the viewer. */
export const TARGET_CARDS: Record<string, { image: string; fact: string }> = {
  barnard: { image: "landing/target-barnard.png", fact: "Fastest-moving star: 10″ a year" },
  wise0855: { image: "landing/target-wise0855.png", fact: "Coldest brown dwarf, seen only at 4–5 µm" },
  epsindib: { image: "landing/target-epsindib.png", fact: "Brown-dwarf pair; matches Gaia to 0.1″" },
  rwaur: { image: "landing/target-rwaur.png", fact: "Young star; faded 0.5–0.75 mag in a year" },
  rdra: { image: "landing/target-rdra.png", fact: "Mira variable; a 246-day pulsation" },
};
export const KIND_LABEL: Record<string, string> = { motion: "Motion", brightness: "Brightness" };

/** The missions' cards: two lines each, so the start page fits one screen. */
export const MISSION_CARDS: Record<string, { image: string; text: string }> = {
  walk: { image: "landing/mission-walk.png", text: "Barnard's Star moves 10″ a year. Watch it shift." },
  infrared: { image: "landing/mission-infrared.png", text: "The coldest brown dwarf: nothing at 1 µm, a point at 5 µm." },
  distance: { image: "landing/mission-distance.png", text: "Turn one knob and find how far away Makemake is." },
};
export const SEDNA_CARD = {
  image: "landing/sedna-stack.png",
  title: "Find 90377 Sedna",
  text: "Invisible in one exposure. Stack 161 and it appears.",
};

export type IntroVariant = "arrival" | "convergence";
/** When the lockup has finished drawing and starts to leave, and how long leaving takes (the motion kit's timings). */
export const INTRO_TIMING: Record<IntroVariant, number> = { arrival: 3200, convergence: 3700 };
export const INTRO_LEAVE_MS = 900;

/**
 * The intro plays once per browser session, never under reduced motion, and not when the link says
 * intro=0. intro=arrival or intro=convergence choose the variant (and play it even if it was seen).
 */
export function introPlan(opts: { reducedMotion: boolean; seen: boolean; param: string | null }): IntroVariant | null {
  if (opts.reducedMotion || opts.param === "0") return null;
  if (opts.param === "arrival" || opts.param === "convergence") return opts.param;
  return opts.seen ? null : "arrival";
}
