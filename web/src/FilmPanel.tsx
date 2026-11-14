// Single exposures of one visit, in time order. Nothing is averaged, so a body that moves
// within the visit is still there. Pause, click a point, and send it to the distance focus.
// Code written with AI assistance (Claude); see AI_USAGE.md.
import { useEffect, useRef, useState } from "react";
import { ApiError, fetchFilm, type Film } from "./lib/api";
import { formatSexagesimal, gridToSky } from "./lib/coords";
import { renderFrame } from "./lib/render";

export type Seed = { ra: number; dec: number; mjd: number };
type Props = { ra: number; dec: number; fov: number; onFocus: (seed: Seed) => void };

const LIMITS = { lo: -0.8, hi: 12 };

export default function FilmPanel({ ra, dec, fov, onFocus }: Props) {
  const [visit, setVisit] = useState(0);
  const [film, setFilm] = useState<Film | null>(null);
  const [status, setStatus] = useState<{ kind: "loading" | "ready" | "error"; message?: string }>({ kind: "loading" });
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [pick, setPick] = useState<{ col: number; row: number; frame: number } | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => setVisit(0), [ra, dec, fov]);

  useEffect(() => {
    const ctrl = new AbortController();
    setStatus({ kind: "loading" });
    setFilm(null);
    setPick(null);
    fetchFilm(ra, dec, fov, visit, ctrl.signal)
      .then((f) => {
        setFilm(f);
        setFrame(0);
        setPlaying(!matchMedia("(prefers-reduced-motion: reduce)").matches);
        setStatus({ kind: "ready" });
      })
      .catch((err) => {
        if (err.name === "AbortError") return;
        setStatus({ kind: "error", message: err instanceof ApiError ? err.message : "The single exposures could not be loaded." });
      });
    return () => ctrl.abort();
  }, [ra, dec, fov, visit]);

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
            <span>visit {film.visit + 1} of {film.visits}</span>
          </>
        ) : (
          <span>&nbsp;</span>
        )}
      </div>
      <div className="stage" role="img" aria-label="Single SPHEREx exposures of this field, in time order" onClick={onClick}>
        {status.kind === "loading" && <p className="stage-msg" role="status">Reading every single exposure of this visit…</p>}
        {status.kind === "error" && <p className="stage-msg error" role="alert">{status.message}</p>}
        <canvas ref={canvasRef} hidden={status.kind !== "ready"} />
        {film && pick && (
          <svg viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
            <g stroke="var(--red-text)" strokeLinecap="round" strokeWidth={0.22} transform={`translate(${pick.col + 0.5} ${size - 1 - pick.row + 0.5})`}>
              <line x1={-3.6} y1={0} x2={-1.8} y2={0} /><line x1={1.8} y1={0} x2={3.6} y2={0} />
              <line x1={0} y1={-3.6} x2={0} y2={-1.8} /><line x1={0} y1={1.8} x2={0} y2={3.6} />
            </g>
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
                  <button key={v} type="button" className="opt mono" aria-pressed={visit === v} onClick={() => setVisit(v)}>{v + 1}</button>
                ))}
              </div>
            )}
          </div>
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
