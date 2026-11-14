// Single exposures of one visit, in time order. Nothing is averaged, so a body that moves
// within the visit is still there. Pause, click a point, and send it to the distance focus,
// or let SEDNA search the whole field for moving bodies and pick one of its candidates.
// Code written with AI assistance (Claude); see AI_USAGE.md.
import { useEffect, useMemo, useRef, useState } from "react";
import { OrbitalLoader } from "./Brand";
import { ApiError, fetchFilm, type Film } from "./lib/api";
import { formatSexagesimal, gridToSky, skyToGrid } from "./lib/coords";
import { categoryLabel, trackPointAt, type Mover } from "./lib/movers";
import { renderFrame } from "./lib/render";
import { candidateLine, fetchSearch, knownLine, noiseLine, searchSummary, type Search } from "./lib/search";

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
const MAP_LIMITS = { lo: 2, hi: 12 }; // S/N: noise stays dark, a candidate (5 and up) stands out
type SearchState = { kind: "idle" | "loading" | "ready" | "error"; data?: Search; message?: string };

export default function FilmPanel({ ra, dec, fov, visit, visitLabels, startMjd, movers, onVisit, onFocus }: Props) {
  const [film, setFilm] = useState<Film | null>(null);
  const [status, setStatus] = useState<{ kind: "loading" | "ready" | "error"; message?: string }>({ kind: "loading" });
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [pick, setPick] = useState<{ col: number; row: number; frame: number } | null>(null);
  const [showKnown, setShowKnown] = useState(true);
  const [search, setSearch] = useState<SearchState>({ kind: "idle" });
  const [showMap, setShowMap] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const searchCtrl = useRef<AbortController | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    setStatus({ kind: "loading" });
    setFilm(null);
    setPick(null);
    searchCtrl.current?.abort();
    setSearch({ kind: "idle" });
    setShowMap(false);
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

  useEffect(() => () => searchCtrl.current?.abort(), []);

  const found = search.kind === "ready" ? search.data! : null;
  const mapShown = showMap && !!found && !!film && found.map.length === film.grid.size * film.grid.size;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !film) return;
    const size = film.grid.size;
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    const out = ctx.createImageData(size, size);
    if (mapShown) renderFrame(found!.map, size, out, { limits: MAP_LIMITS, softening: 3, invert: false });
    else renderFrame(film.images[Math.min(frame, film.images.length - 1)], size, out, { limits: LIMITS, softening: 4, invert: false });
    ctx.putImageData(out, 0, 0);
  }, [film, frame, mapShown, found]);

  function runSearch() {
    if (!film) return;
    searchCtrl.current?.abort();
    const ctrl = new AbortController();
    searchCtrl.current = ctrl;
    setSearch({ kind: "loading" });
    fetchSearch(ra, dec, fov, film.visit, ctrl.signal)
      .then((data) => {
        setSearch({ kind: "ready", data });
        setShowMap(data.candidates.length > 0);
        setPlaying(false);
      })
      .catch((err) => {
        if (err.name === "AbortError") return;
        setSearch({ kind: "error", message: err instanceof ApiError ? err.message : "The field search could not be run." });
      });
  }

  // back to the exposures, at the first one the search used, so the candidates' rings are in view
  function showExposures() {
    setShowMap(false);
    const start = found?.candidates[0]?.track[0]?.mjd;
    if (!film || start === undefined || !mapShown) return;
    const first = film.frames.findIndex((f) => f.mjd >= start - 0.01);
    if (first >= 0) {
      setPlaying(false);
      setFrame(first);
    }
  }

  const size = film?.grid.size ?? 1;
  const current = film?.frames[Math.min(frame, (film?.frames.length ?? 1) - 1)];
  const labels = film && visitLabels && visitLabels.length === film.visits ? visitLabels : null;
  const inVisit = useMemo(() => (film ? movers.filter((m) => m.visit === film.visit) : []), [film, movers]);
  const marks = useMemo(() => {
    if (!film || !current || !showKnown || mapShown) return [];
    return inVisit.flatMap((m) => {
      const p = trackPointAt(m, current.mjd);
      if (!p) return [];
      const g = skyToGrid(p.ra, p.dec, film.center, size, film.grid.pixelScaleArcsec);
      return [{ m, x: g.x + 0.5, y: size - 1 - g.y + 0.5 }];
    });
  }, [film, current, showKnown, inVisit, size, mapShown]);
  // the search's candidates: on the map where it found them, in the exposures where it assumed each one was
  const hits = useMemo(() => {
    if (!film || !found) return [];
    if (mapShown) return found.candidates.map((c) => ({ c, x: c.x + 0.5, y: size - 1 - c.y + 0.5 }));
    if (!current) return [];
    return found.candidates.flatMap((c) => {
      const p = trackPointAt(c, current.mjd);
      if (!p) return [];
      const g = skyToGrid(p.ra, p.dec, film.center, size, film.grid.pixelScaleArcsec);
      return [{ c, x: g.x + 0.5, y: size - 1 - g.y + 0.5 }];
    });
  }, [film, found, mapShown, current, size]);

  function onClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!film || mapShown) return;
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
    setShowMap(false);
    setFrame((f) => (f + delta + film.frames.length) % film.frames.length);
  }

  const picked = film && pick ? gridToSky(pick.col, pick.row, film.center, size, film.grid.pixelScaleArcsec) : null;
  const pickedFrame = film && pick ? film.frames[pick.frame] : null;

  return (
    <section className="stage-wrap focus">
      <div className="caption mono">
        {film && current && mapShown ? (
          <>
            <span className="now">Search map</span>
            <span>best S/N over {found!.distancesAu[0]}–{found!.distancesAu[1]} au</span>
            <span>{found!.window.exposures} exposures · {found!.window.start.slice(0, 10)}</span>
          </>
        ) : film && current ? (
          <>
            <span className="now">{current.date.slice(0, 16)}</span>
            <span>exposure {frame + 1} of {film.frames.length} · D{current.detector}</span>
            <span>visit {film.visit + 1} of {film.visits}{labels ? ` · ${labels[film.visit]}` : ""}</span>
          </>
        ) : (
          <span>&nbsp;</span>
        )}
      </div>
      <div
        className="stage" role="img" onClick={onClick}
        aria-label={mapShown ? "Search map: where a body moving at some trial distance adds up, brightest where it stands out most" : "Single SPHEREx exposures of this field, in time order"}
      >
        {status.kind === "loading" && <div className="stage-msg"><OrbitalLoader>Reading every single exposure of this visit…</OrbitalLoader></div>}
        {status.kind === "error" && <p className="stage-msg error" role="alert">{status.message}</p>}
        <canvas ref={canvasRef} hidden={status.kind !== "ready"} />
        {film && (pick || marks.length > 0 || hits.length > 0) && (
          <svg viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
            {/* rings only: names go in the legend so no text covers the data; numbers only when two or more share a frame */}
            {marks.map(({ m, x, y }, i) => (
              <g key={m.number ?? m.name} stroke="var(--ice)" fill="none">
                <circle cx={x} cy={y} r={2.6} strokeWidth={0.16} />
                {marks.length > 1 && <text x={x + 2.4} y={y - 2.4} fill="var(--ice)" stroke="none" fontSize={1.6} fontFamily="var(--font-data)">{i + 1}</text>}
              </g>
            ))}
            {/* search candidates: a wider dashed ring, numbered like the list below */}
            {hits.map(({ c, x, y }) => (
              <g key={`c${c.rank}`} stroke="var(--red-text)" fill="none">
                <circle cx={x} cy={y} r={3.8} strokeWidth={0.2} strokeDasharray="0.9 0.6" />
                <text x={x + 3.4} y={y + 4.6} fill="var(--red-text)" stroke="none" fontSize={1.8} fontFamily="var(--font-data)">{c.rank}</text>
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
            <button type="button" className="text" onClick={() => { setShowMap(false); setPlaying((p) => !p); }}>{playing ? "Pause" : "Play"}</button>
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
          <div className="focus-actions search-actions">
            {search.kind !== "ready" ? (
              <button type="button" className={pick ? "text ice" : "primary"} onClick={runSearch} disabled={search.kind === "loading"}>
                Search this visit for moving bodies
              </button>
            ) : (
              <div className="chips" role="group" aria-label="Show">
                <button type="button" className="opt" aria-pressed={!mapShown} onClick={showExposures}>Exposures</button>
                <button type="button" className="opt" aria-pressed={mapShown} onClick={() => { setPlaying(false); setShowMap(true); }}>Search map</button>
              </div>
            )}
          </div>
          {search.kind === "loading" && (
            <p className="note-line" role="status">Searching the whole field: shifting and stacking every exposure for 72 trial distances…</p>
          )}
          {search.kind === "error" && <p className="note-line error" role="alert">{search.message}</p>}
          {found && (
            <div className="search-result">
              <p><strong>{searchSummary(found)}</strong></p>
              {found.candidates.length > 0 && (
                <ol className="candidates">
                  {found.candidates.map((c) => (
                    <li key={c.rank}>
                      <span className="rank mono">{c.rank}</span>
                      <div>
                        <p className="mono">{candidateLine(c)}{!c.aboveNoise && <> <span className="chip uncertain">As strong as noise</span></>}</p>
                        {knownLine(c) && <p>{knownLine(c)}</p>}
                      </div>
                      <button type="button" className="text ice" onClick={() => onFocus({ ra: c.ra, dec: c.dec, mjd: c.mjd })}>Measure its distance</button>
                    </li>
                  ))}
                </ol>
              )}
              <p className="note-line">{noiseLine(found)}</p>
              <p className="note-line">{found.limit}</p>
              <details className="method">
                <summary>How the search works</summary>
                <p className="note-line">{found.method}</p>
              </details>
            </div>
          )}
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
              click such a point to measure how far away it is, or let SEDNA search the whole field for you.
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
