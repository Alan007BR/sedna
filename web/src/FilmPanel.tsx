// Single exposures of one visit, in time order. Nothing is averaged, so a body that moves
// within the visit is still there. Pause, click a point, and send it to the distance focus.
// Code written with AI assistance (Claude); see AI_USAGE.md.
import { useEffect, useMemo, useRef, useState } from "react";
import { OrbitalLoader } from "./Brand";
import { ApiError, fetchFilm, type Film } from "./lib/api";
import { formatSexagesimal, gridToSky, skyToGrid } from "./lib/coords";
import { categoryLabel, trackPointAt, type Mover } from "./lib/movers";
import { renderFrame } from "./lib/render";

export type Seed = { ra: number; dec: number; mjd: number };
type Props = {
  ra: number;
  dec: number;
  fov: number;
  visit: number;
  visitLabels?: string[] | null; // the blink's dates for the same visits, when both count them alike
  startMjd: number | null; // open at the exposure closest to this time, paused
  movers: Mover[];
  onVisit: (visit: number) => void;
  onFocus: (seed: Seed) => void;
};

const LIMITS = { lo: -0.8, hi: 12 };

export default function FilmPanel({ ra, dec, fov, visit, visitLabels, startMjd, movers, onVisit, onFocus }: Props) {
  const [film, setFilm] = useState<Film | null>(null);
  const [status, setStatus] = useState<{ kind: "loading" | "ready" | "error"; message?: string }>({ kind: "loading" });
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [pick, setPick] = useState<{ col: number; row: number; frame: number } | null>(null);
  const [showKnown, setShowKnown] = useState(true);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    setStatus({ kind: "loading" });
    setFilm(null);
    setPick(null);
    fetchFilm(ra, dec, fov, visit, ctrl.signal)
      .then((f) => {
        setFilm(f);
        setStatus({ kind: "ready" });
      })
      .catch((err) => {
        if (err.name === "AbortError") return;
        setStatus({ kind: "error", message: err instanceof ApiError ? err.message : "The single exposures could not be loaded." });
      });
    return () => ctrl.abort();
  }, [ra, dec, fov, visit]);

  // open at the requested moment, paused; otherwise play from the start
  useEffect(() => {
    if (!film) return;
    if (startMjd !== null) {
      let best = 0;
      film.frames.forEach((f, i) => { if (Math.abs(f.mjd - startMjd) < Math.abs(film.frames[best].mjd - startMjd)) best = i; });
      if (Math.abs(film.frames[best].mjd - startMjd) < 2) {
        setFrame(best);
        setPlaying(false);
        return;
      }
    }
    setFrame(0);
    setPlaying(!matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, [film, startMjd]);

  useEffect(() => {
    if (!playing || !film || film.frames.length < 2) return;
    const id = setInterval(() => setFrame((f) => (f + 1) % film.frames.length), 200);
    return () => clearInterval(id);
  }, [playing, film]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !film) return;
    const size = film.grid.size;
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    const out = ctx.createImageData(size, size);
    renderFrame(film.images[Math.min(frame, film.images.length - 1)], size, out, { limits: LIMITS, softening: 4, invert: false });
    ctx.putImageData(out, 0, 0);
  }, [film, frame]);

  const size = film?.grid.size ?? 1;
  const current = film?.frames[Math.min(frame, (film?.frames.length ?? 1) - 1)];
  const labels = film && visitLabels && visitLabels.length === film.visits ? visitLabels : null;
  const inVisit = useMemo(() => (film ? movers.filter((m) => m.visit === film.visit) : []), [film, movers]);
  const marks = useMemo(() => {
    if (!film || !current || !showKnown) return [];
    return inVisit.flatMap((m) => {
      const p = trackPointAt(m, current.mjd);
      if (!p) return [];
      const g = skyToGrid(p.ra, p.dec, film.center, size, film.grid.pixelScaleArcsec);
      return [{ m, x: g.x + 0.5, y: size - 1 - g.y + 0.5 }];
    });
  }, [film, current, showKnown, inVisit, size]);

  function onClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!film) return;
    const r = e.currentTarget.getBoundingClientRect();
    const col = Math.floor(((e.clientX - r.left) / r.width) * size);
    const row = size - 1 - Math.floor(((e.clientY - r.top) / r.height) * size);
    if (col < 0 || row < 0 || col >= size || row >= size) return;
    setPlaying(false);
    setPick({ col, row, frame });
  }

  function step(delta: number) {
    if (!film) return;
    setPlaying(false);
    setFrame((f) => (f + delta + film.frames.length) % film.frames.length);
  }

  const picked = film && pick ? gridToSky(pick.col, pick.row, film.center, size, film.grid.pixelScaleArcsec) : null;
  const pickedFrame = film && pick ? film.frames[pick.frame] : null;

  return (
    <section className="stage-wrap focus">
      <div className="caption mono">
        {film && current ? (
          <>
            <span className="now">{current.date.slice(0, 16)}</span>
            <span>exposure {frame + 1} of {film.frames.length} · D{current.detector}</span>
            <span>visit {film.visit + 1} of {film.visits}{labels ? ` · ${labels[film.visit]}` : ""}</span>
          </>
        ) : (
          <span>&nbsp;</span>
        )}
      </div>
      <div className="stage" role="img" aria-label="Single SPHEREx exposures of this field, in time order" onClick={onClick}>
        {status.kind === "loading" && <div className="stage-msg"><OrbitalLoader>Reading every single exposure of this visit…</OrbitalLoader></div>}
        {status.kind === "error" && <p className="stage-msg error" role="alert">{status.message}</p>}
        <canvas ref={canvasRef} hidden={status.kind !== "ready"} />
        {film && (pick || marks.length > 0) && (
          <svg viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
            {/* rings only: names go in the legend so no text covers the data; numbers only when two or more share a frame */}
            {marks.map(({ m, x, y }, i) => (
              <g key={m.number ?? m.name} stroke="var(--ice)" fill="none">
                <circle cx={x} cy={y} r={2.6} strokeWidth={0.16} />
                {marks.length > 1 && <text x={x + 2.4} y={y - 2.4} fill="var(--ice)" stroke="none" fontSize={1.6} fontFamily="var(--font-data)">{i + 1}</text>}
              </g>
            ))}
            {pick && (
              <g stroke="var(--red-text)" strokeLinecap="round" strokeWidth={0.22} transform={`translate(${pick.col + 0.5} ${size - 1 - pick.row + 0.5})`}>
                <line x1={-3.6} y1={0} x2={-1.8} y2={0} /><line x1={1.8} y1={0} x2={3.6} y2={0} />
                <line x1={0} y1={-3.6} x2={0} y2={-1.8} /><line x1={0} y1={1.8} x2={0} y2={3.6} />
              </g>
            )}
          </svg>
        )}
      </div>

      {film && status.kind === "ready" && (
        <div className="focus-result">
          <div className="focus-actions">
            <button type="button" className="text" onClick={() => step(-1)} aria-label="Previous exposure">◀</button>
            <button type="button" className="text" onClick={() => setPlaying((p) => !p)}>{playing ? "Pause" : "Play"}</button>
            <button type="button" className="text" onClick={() => step(1)} aria-label="Next exposure">▶</button>
            {film.visits > 1 && (
              <div className="chips" role="group" aria-label="Visit">
                <span className="eyebrow">Visit</span>
                {Array.from({ length: film.visits }, (_, v) => (
                  <button key={v} type="button" className="opt mono" aria-pressed={film.visit === v} onClick={() => onVisit(v)}>{v + 1}{labels ? ` · ${labels[v]}` : ""}</button>
                ))}
              </div>
            )}
            {inVisit.length > 0 && (
              <button type="button" className="opt" aria-pressed={showKnown} onClick={() => setShowKnown((s) => !s)}>
                <span className="dot" />Known objects
              </button>
            )}
          </div>
          {marks.length > 0 && (
            <p className="legend">
              <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><circle cx="6" cy="6" r="4.5" fill="none" stroke="var(--ice)" strokeWidth="1" /></svg>
              {marks.length === 1
                ? `${marks[0].m.name}, a known ${categoryLabel(marks[0].m)}, where IMCCE SkyBoT puts it at this moment.`
                : `Known bodies where IMCCE SkyBoT puts them at this moment: ${marks.map(({ m }, i) => `${i + 1}. ${m.name} (${categoryLabel(m)})`).join("; ")}.`}
            </p>
          )}
          {!pick ? (
            <p>
              <strong>Every single exposure of this visit, one after the other.</strong> Stars stay where they are. Anything that walks, or shows up in only a few exposures, is close to us. Pause and
              click such a point to measure how far away it is.
            </p>
          ) : (
            <>
              <p>
                <strong>Point picked</strong> in the exposure of <span className="mono">{pickedFrame?.date.slice(0, 16)}</span> at <span className="mono">{picked ? formatSexagesimal(picked.ra, picked.dec) : ""}</span>.
              </p>
              <div className="focus-actions">
                <button type="button" className="primary" onClick={() => picked && pickedFrame && onFocus({ ra: picked.ra, dec: picked.dec, mjd: pickedFrame.mjd })}>
                  Focus the distance on this point
                </button>
                <button type="button" className="text" onClick={() => setPick(null)}>Clear</button>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
