// Three one-minute guided missions: the validation cases, told as a first use.
// Pure definitions: each step says what to do and how to tell it was done.
// Every claim in the copy is measured in docs/target-matrix.md or docs/decision-tests.md.
// Code written with AI assistance (Claude); see AI_USAGE.md.

export type MissionContext = {
  mode: string;
  det: number;
  target: string | null;
  seenAllVisits: boolean; // every visit of the current detector has been shown in Blink
  pickedMotionArcsecYr: number | null; // catalogue motion of the Gaia star last clicked
  focusStep: "watch" | "focus" | "check" | null;
  focusRevealed: boolean;
};

export type MissionStep = {
  text: string;
  done: (c: MissionContext) => boolean;
  action?: { label: string; patch: { mode?: "blink" | "diff" | "sum"; det?: number } };
};

export type Mission = {
  id: string;
  title: string;
  teaser: string;
  target: string;
  start: { mode: "blink" | "diff" | "sum" | "focus"; det: number; fov: number };
  steps: MissionStep[];
  finale: string;
};

export const MISSIONS: Mission[] = [
  {
    id: "walk",
    title: "Watch a star walk",
    teaser: "Barnard's Star moves 10 arcseconds a year. See it shift against the stars behind it.",
    target: "barnard",
    start: { mode: "blink", det: 2, fov: 4 },
    steps: [
      {
        text: "Press Play. The red cross marks where Barnard's Star should be on each date. Watch it jump a little between visits while the other stars stay put.",
        done: (c) => c.mode === "blink" && c.seenAllVisits,
      },
      {
        text: "Now choose Difference: the last visit minus the first. The star left the dark spot and arrived at the bright one.",
        done: (c) => c.mode === "diff",
        action: { label: "Show the difference", patch: { mode: "diff" } },
      },
      {
        text: "Back in Blink, click the star. Gaia DR3 knows it, and says how fast it moves.",
        done: (c) => (c.pickedMotionArcsecYr ?? 0) > 5,
        action: { label: "Back to Blink", patch: { mode: "blink" } },
      },
    ],
    finale:
      "That is how a nearby object gives itself away: it shifts against the far-away stars. Barnard's Star needs a year to move 1.7 SPHEREx pixels. A world beyond Neptune moves that far in a day, which is how the third mission catches one.",
  },
  {
    id: "infrared",
    title: "See what only the infrared shows",
    teaser: "WISE 0855 is the coldest known brown dwarf. It is invisible at short wavelengths.",
    target: "wise0855",
    start: { mode: "blink", det: 1, fov: 4 },
    steps: [
      {
        text: "This is detector D1, near 1 µm. Press Play: at the red cross there is only a background star, and it does not move.",
        done: (c) => c.det === 1 && c.mode === "blink" && c.seenAllVisits,
      },
      {
        text: "Switch to detector D6, from 4.4 to 5.0 µm.",
        done: (c) => c.det === 6,
        action: { label: "Switch to D6", patch: { det: 6, mode: "blink" } },
      },
      {
        text: "Play again. Now a source at the cross moves with it, about 8 arcseconds a year: WISE 0855, at roughly 250 K, glowing only in the infrared.",
        done: (c) => c.det === 6 && c.mode === "blink" && c.seenAllVisits,
      },
    ],
    finale:
      "Cold bodies give off almost all their light in the infrared. SPHEREx sees the sky in 102 colours out to 5 µm, so it shows objects that visible-light surveys miss, and tells them apart from the stars beside them.",
  },
  {
    id: "distance",
    title: "Measure a dwarf planet's distance",
    teaser: "Turn one knob and find how far away Makemake is, from its motion alone.",
    target: "makemake",
    start: { mode: "focus", det: 2, fov: 6 },
    steps: [
      {
        text: "Step 1 plays single exposures taken over a few days. One point walks across the stars: Makemake, a dwarf planet beyond Neptune. When you have spotted it, go to step 2.",
        done: (c) => c.focusStep === "focus" || c.focusStep === "check",
      },
      {
        text: "Turn the knob. Each position assumes a distance and shifts the exposures to follow a body there. At the right distance the point becomes sharp.",
        done: (c) => c.focusRevealed,
      },
      {
        text: "Open step 3 to compare your distance with JPL Horizons.",
        done: (c) => c.focusStep === "check",
      },
    ],
    finale:
      "Distance from motion alone: the closer a body, the more it seems to move as the Earth goes round the Sun. A planet at 500 au would move about ten times more slowly than Makemake, and the same knob would measure it from deep enough images.",
  },
];

export const missionById = (id: string | null) => MISSIONS.find((m) => m.id === id) ?? null;

/** Index of the first step not yet done, never going back: steps already done stay done. */
export function advance(mission: Mission, reached: number, c: MissionContext): number {
  let i = reached;
  while (i < mission.steps.length && mission.steps[i].done(c)) i++;
  return i;
}
