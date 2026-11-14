// The ways of looking at a field, in words a non-astronomer can follow, and the caption that ties
// the blink's dates to the visits the single exposures are numbered by.
// Code written with AI assistance (Claude); see AI_USAGE.md.

export type Mode = "blink" | "diff" | "sum" | "film" | "focus" | "follow";

export const MODES: { id: Mode; label: string; help: string }[] = [
  { id: "blink", label: "Blink", help: "One picture per visit, months apart, shown in turn: what changed between visits?" },
  { id: "diff", label: "Difference", help: "The last visit minus the first. Dark: there before. Bright: there now." },
  { id: "sum", label: "Sum", help: "Every visit added together: the deepest, least noisy picture." },
  { id: "film", label: "Single exposures", help: "Every picture of one visit, minutes to days apart: what moves? SEDNA can search them." },
  { id: "focus", label: "Distance focus", help: "Shifts and stacks one visit for trial distances, to find how far a moving body is." },
];

export const DETECTOR_HELP = "Each detector sees its own band of infrared, from D1 (shortest) to D6 (longest).";

export const modeHelp = (id: Mode): string | null => MODES.find((m) => m.id === id)?.help ?? null;

/** "Visit 2 of 3 · Jan 2026": the same numbering the single exposures use. */
export const visitTitle = (visitIndex: number, visitCount: number, date: string) => `Visit ${visitIndex + 1} of ${visitCount} · ${date}`;

/** What a frame is made of: one visit's mean, or every visit's exposures. */
export const exposuresLabel = (n: number, mean: boolean) => (mean ? `mean of ${n} exposure${n === 1 ? "" : "s"}` : `${n} exposure${n === 1 ? "" : "s"}`);
