// Which known asteroids, comets and dwarf planets crossed this field, under the visit view.
// Explains why a point seen in one exposure is missing from the visit averages, and opens it.
// Code written with AI assistance (Claude); see AI_USAGE.md.
import { categoryLabel, spanLabel, type Mover, type Movers } from "./lib/movers";

export type MoversState = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; data: Movers };
type Props = { state: MoversState; onShow: (m: Mover) => void };

const MAX_LISTED = 5;

export default function MoversNote({ state, onShow }: Props) {
  if (state.kind === "loading") {
    return <p className="note-line" role="status">Checking which known asteroids and comets crossed this field…</p>;
  }
  if (state.kind === "error") return <p className="note-line">{state.message}</p>;
  const { data } = state;
  if (data.status === "unavailable") {
    return <p className="note-line">The known-object service (IMCCE SkyBoT) did not answer, so moving bodies in this field are not identified.</p>;
  }
  const visible = data.movers.filter((m) => m.visible);
  const fainter = data.fainter + data.movers.length - visible.length;
  const partial = data.status === "partial" ? " Some searches failed, so the list may be incomplete." : "";
  if (!visible.length) {
    return (
      <p className="note-line">
        No known asteroid, comet or dwarf planet brighter than V {data.visibleV} crossed this field during these visits
        {fainter > 0 ? ` (${fainter} fainter ${fainter === 1 ? "one did" : "ones did"}, too faint for single exposures)` : ""}. Source: IMCCE SkyBoT.{partial}
      </p>
    );
  }
  return (
    <div className="movers" role="region" aria-label="Known moving bodies in this field">
      <p>
        <strong>Known moving bodies crossed this field.</strong> They smear out of the visit averages above. Single exposures show them.{partial}
      </p>
      <ul>
        {visible.slice(0, MAX_LISTED).map((m) => (
          <li key={`${m.number ?? m.name}-${m.visit}`}>
            <span className="name">{m.name}</span>
            <span className="sub">{categoryLabel(m)} · <span className="mono">V {m.vMag?.toFixed(1) ?? "?"}</span></span>
            <span className="sub mono">{spanLabel(m)}</span>
            <button type="button" className="text" onClick={() => onShow(m)}>Show in single exposures</button>
          </li>
        ))}
      </ul>
      <p className="sub">
        {visible.length > MAX_LISTED ? `${visible.length - MAX_LISTED} more listed in single exposures. ` : ""}
        {fainter > 0 ? `${fainter} fainter known ${fainter === 1 ? "body" : "bodies"} (V > ${data.visibleV}) also crossed. ` : ""}
        Source: IMCCE SkyBoT.
      </p>
    </div>
  );
}
