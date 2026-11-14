// Parallax ruler: how far a body seen at one point would move between two visits, at 50-500 au and at 2 pc.
// It shows why comparing fixed frames cannot catch a distant world, and why the distance focus follows one instead.
// Code written with AI assistance (Claude); see AI_USAGE.md.
import { dayLabel, formatAngle, offFieldDirection, rulerSummary, type Ruler } from "./lib/prediction";

export type RulerState = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; data: Ruler };

/** Marks drawn on the stage, in grid units (the stage's SVG viewBox). */
export function RulerMarks({ ruler, anchor, size, scale }: { ruler: Ruler; anchor: { x: number; y: number }; size: number; scale: number }) {
  const inside = ruler.marks.filter((m) => m.inField && m.shiftArcsec / scale > 1.5);
  const dir = offFieldDirection(ruler);
  // the edge of the field along the off-field direction
  let edge: { x: number; y: number } | null = null;
  if (dir) {
    const tx = dir.x > 0 ? (size - 2 - anchor.x) / dir.x : dir.x < 0 ? (2 - anchor.x) / dir.x : Infinity;
    const ty = dir.y > 0 ? (size - 2 - anchor.y) / dir.y : dir.y < 0 ? (2 - anchor.y) / dir.y : Infinity;
    const t = Math.min(tx, ty);
    edge = { x: anchor.x + dir.x * t, y: anchor.y + dir.y * t };
  }
  return (
    <g stroke="var(--ice)" fill="none" strokeWidth={0.18}>
      <circle cx={anchor.x} cy={anchor.y} r={1.8} />
      {edge && dir && (
        <>
          <line x1={anchor.x + dir.x * 2.2} y1={anchor.y + dir.y * 2.2} x2={edge.x} y2={edge.y} strokeDasharray="0.8 0.8" />
          <path d={`M${edge.x - dir.x * 2 - dir.y * 1.1},${edge.y - dir.y * 2 + dir.x * 1.1} L${edge.x},${edge.y} L${edge.x - dir.x * 2 + dir.y * 1.1},${edge.y - dir.y * 2 - dir.x * 1.1}`} />
        </>
      )}
      {inside.map((m) => {
        const x = anchor.x - m.eastArcsec / scale;
        const y = anchor.y - m.northArcsec / scale;
        return <circle key={m.distanceAu} cx={x} cy={y} r={1.2} />;
      })}
    </g>
  );
}

export default function RulerPanel({ state, fromLabel, toLabel, onFocus }: { state: RulerState; fromLabel: string; toLabel: string; onFocus: () => void }) {
  if (state.kind === "loading") return <p className="note-line" role="status">Working out where bodies at 50 to 500 au would move between {fromLabel} and {toLabel}…</p>;
  if (state.kind === "error") return <p className="note-line error">{state.message}</p>;
  const r = state.data;
  const fov = r.fovArcmin * 60;
  return (
    <section className="lens ruler" aria-label="Parallax ruler">
      <div className="lens-head">
        <span className="eyebrow">Parallax ruler</span>
        <span className="mono">{dayLabel(r.anchor.date)} → {dayLabel(r.to.date)}</span>
      </div>
      <p className="lens-summary">{rulerSummary(r)}</p>
      <table className="ruler-table">
        <caption className="sr">Shift between the two visits for each distance</caption>
        <thead>
          <tr><th>Distance</th><th>Shift</th><th>Fields of view away</th></tr>
        </thead>
        <tbody>
          {r.marks.map((m) => (
            <tr key={m.distanceAu} className={m.inField ? "in" : ""}>
              <td>{m.label}</td>
              <td className="mono">{formatAngle(m.shiftArcsec)}</td>
              <td className="mono">{m.inField ? "inside the field" : `${(m.shiftArcsec / fov).toFixed(m.shiftArcsec / fov >= 10 ? 0 : 1)}×`}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="note-line">
        The dashed line on the sky points where they went. A nearby star barely shifts: its parallax is under an arcsecond. A world beyond Neptune leaves the frame, so a blink of fixed coordinates only shows a point that vanished. {r.assumption}
      </p>
      <div className="focus-actions">
        <button type="button" className="text ice" onClick={onFocus}>Follow a body through single exposures instead: the distance focus</button>
      </div>
    </section>
  );
}
