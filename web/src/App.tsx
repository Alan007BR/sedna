// SEDNA: type coordinates, watch the SPHEREx sky change over time.
// Code written with AI assistance (Claude); see AI_USAGE.md.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import FilmPanel, { type Seed } from "./FilmPanel";
import FocusPanel from "./FocusPanel";
import MoversNote, { type MoversState } from "./MoversNote";
import { ApiError, fetchFocus, fetchGaia, fetchHealth, fetchStack, fetchTargets, type GaiaSource, type Stack, type Target } from "./lib/api";
import { formatSexagesimal, gridToSky, mjdToYear, parseTarget, skyToGrid } from "./lib/coords";
import { fetchMovers } from "./lib/movers";
import { differenceLimit, mean, renderDifference, renderFrame, sharedLimits, subtract } from "./lib/render";

type Mode = "blink" | "diff" | "sum" | "film" | "focus";
const MODES: { id: Mode; label: string }[] = [
  { id: "blink", label: "Blink" },
  { id: "diff", label: "Difference" },
  { id: "sum", label: "Sum" },
  { id: "film", label: "Single exposures" },
  { id: "focus", label: "Distance focus" },
];
// fv: single-exposure visit (0-based; 1-based in the URL); ft: open the single exposures at this MJD
type View = { ra: number; dec: number; fov: number; det: number; mode: Mode; target: string | null; gaia: boolean; invert: boolean; fps: number; fv: number; ft: number | null };
const VIEW_DEFAULTS = { fov: 6, det: 2, mode: "blink" as Mode, gaia: true, invert: false, fps: 2, fv: 0, ft: null };

const DETECTORS = [
  { id: 1, range: "0.75–1.09 µm" },
  { id: 2, range: "1.10–1.62 µm" },
  { id: 3, range: "1.63–2.41 µm" },
  { id: 4, range: "2.42–3.82 µm" },
  { id: 5, range: "3.83–4.41 µm" },
  { id: 6, range: "4.42–5.00 µm" },
];
const FOVS = [4, 6, 10, 15];

function readView(): View | null {
  const p = new URLSearchParams(location.search);
  const ra = Number(p.get("ra"));
  const dec = Number(p.get("dec"));
  if (!p.has("ra") || !p.has("dec") || !Number.isFinite(ra) || !Number.isFinite(dec) || ra < 0 || ra >= 360 || Math.abs(dec) > 90) return null;
  const fov = FOVS.includes(Number(p.get("fov"))) ? Number(p.get("fov")) : 6;
  const det = Number(p.get("band")) >= 1 && Number(p.get("band")) <= 6 ? Number(p.get("band")) : 2;
  const mode = MODES.some((m) => m.id === p.get("mode")) ? (p.get("mode") as Mode) : "blink";
  const fv = Math.max(0, Math.min(20, Math.round(Number(p.get("visit")) || 1) - 1));
  const ft = p.has("t") && Number.isFinite(Number(p.get("t"))) ? Number(p.get("t")) : null;
  return { ra, dec, fov, det, mode, target: p.get("target"), gaia: p.get("gaia") !== "0", invert: p.get("invert") === "1", fps: Number(p.get("speed")) || 2, fv, ft };
}

function writeView(v: View, push: boolean) {
  const p = new URLSearchParams();
  p.set("ra", v.ra.toFixed(5));
  p.set("dec", v.dec.toFixed(5));
  p.set("fov", String(v.fov));
  p.set("band", String(v.det));
  p.set("mode", v.mode);
  if (v.target) p.set("target", v.target);
  if (!v.gaia) p.set("gaia", "0");
  if (v.invert) p.set("invert", "1");
  if (v.fps !== 2) p.set("speed", String(v.fps));
  if (v.mode === "film" && v.fv > 0) p.set("visit", String(v.fv + 1));
  if (v.mode === "film" && v.ft !== null) p.set("t", v.ft.toFixed(5));
  const url = `${location.pathname}?${p}`;
  if (push) history.pushState(null, "", url);
  else history.replaceState(null, "", url);
}

const dateLabel = (iso: string) => new Date(iso.replace(" ", "T")).toLocaleDateString("en", { month: "short", year: "numeric", timeZone: "UTC" });

export default function App() {
  const [view, setView] = useState<View | null>(readView);
  const [targets, setTargets] = useState<Target[]>([]);
  const [stack, setStack] = useState<Stack | null>(null);
  const [status, setStatus] = useState<{ kind: "idle" | "loading" | "ready" | "error"; message?: string }>({ kind: "idle" });
  const [gaia, setGaia] = useState<GaiaSource[]>([]);
  const [epoch, setEpoch] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [input, setInput] = useState("");
  const [inputError, setInputError] = useState<string | null>(null);
  const [readout, setReadout] = useState<string | null>(null);
  const [picked, setPicked] = useState<GaiaSource | null>(null);
  const [health, setHealth] = useState<string | null>(null);
  const [seed, setSeed] = useState<Seed | null>(null);
  const [movers, setMovers] = useState<MoversState>({ kind: "loading" });
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const update = useCallback((patch: Partial<View>, push = false) => {
    setView((v) => {
      if (!v) return v;
      const next = { ...v, ...patch };
      writeView(next, push);
      return next;
    });
  }, []);

  useEffect(() => {
    fetchTargets().then(setTargets).catch(() => setTargets([]));
    fetchHealth().then((h) => setHealth(h.dataThrough.slice(0, 10))).catch(() => setHealth(null));
    const onPop = () => setView(readView());
    addEventListener("popstate", onPop);
    return () => removeEventListener("popstate", onPop);
  }, []);

  // load the stack whenever the position or field changes
  const queryKey = view ? `${view.ra.toFixed(5)}|${view.dec.toFixed(5)}|${view.fov}` : "";
  useEffect(() => {
    if (!view) return;
    const ctrl = new AbortController();
    setStatus({ kind: "loading" });
    setStack(null);
    setGaia([]);
    setInput((cur) => cur || (targets.find((t) => t.id === view.target)?.name ?? `${view.ra.toFixed(5)} ${view.dec.toFixed(5)}`));
    setPicked(null);
    fetchStack(view.ra, view.dec, view.fov, ctrl.signal)
      .then((s) => {
        setStack(s);
        setStatus({ kind: "ready" });
        setEpoch(0);
      })
      .catch((err) => {
        if (err.name === "AbortError") return;
        setStatus({ kind: "error", message: err instanceof ApiError ? err.message : "Something went wrong while loading this field." });
      });
    fetchGaia(view.ra, view.dec, view.fov, ctrl.signal).then((g) => setGaia(g.sources)).catch(() => setGaia([]));
    setMovers({ kind: "loading" });
    fetchMovers(view.ra, view.dec, view.fov, ctrl.signal)
      .then((data) => setMovers({ kind: "ready", data }))
      .catch((err) => {
        if (err.name === "AbortError") return;
        setMovers({ kind: "error", message: "Known asteroids and comets could not be checked for this field." });
      });
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryKey]);

  const target = useMemo(() => targets.find((t) => t.id === view?.target) ?? null, [targets, view?.target]);
  const frames = useMemo(() => (stack && view ? stack.frames.filter((f) => f.detector === view.det).sort((a, b) => a.visit - b.visit) : []), [stack, view]);
  const limits = useMemo(() => (frames.length ? sharedLimits(frames.map((f) => f.image)) : null), [frames]);
  const current = frames[Math.min(epoch, frames.length - 1)];
  const visitOf = (visit: number) => stack?.visits.find((v) => v.index === visit);

  // playback
  useEffect(() => {
    if (!playing || view?.mode !== "blink" || frames.length < 2) return;
    const id = setInterval(() => setEpoch((e) => (e + 1) % frames.length), 1000 / (view?.fps ?? 2));
    return () => clearInterval(id);
  }, [playing, view?.mode, view?.fps, frames.length]);

  // draw
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !stack || !view || !frames.length || !limits) return;
    const size = stack.grid.size;
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    const out = ctx.createImageData(size, size);
    if (view.mode === "diff" && frames.length >= 2) {
      const diff = subtract(frames[frames.length - 1].image, frames[0].image);
      renderDifference(diff, size, out, differenceLimit(diff));
    } else if (view.mode === "sum") {
      renderFrame(mean(frames.map((f) => f.image)), size, out, { limits, softening: 10, invert: view.invert });
    } else if (current) {
      renderFrame(current.image, size, out, { limits, softening: 10, invert: view.invert });
    }
    ctx.putImageData(out, 0, 0);
  }, [stack, view, frames, limits, current]);

  // keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || !frames.length) return;
      if (e.key === " ") { e.preventDefault(); setPlaying((p) => !p); }
      else if (e.key === "ArrowRight") setEpoch((v) => (v + 1) % frames.length);
      else if (e.key === "ArrowLeft") setEpoch((v) => (v + frames.length - 1) % frames.length);
      else if (e.key === "1") update({ mode: "blink" });
      else if (e.key === "2") update({ mode: "diff" });
      else if (e.key === "3") update({ mode: "sum" });
      else if (e.key === "4") update({ mode: "focus" });
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [frames.length, update]);

  function go(ra: number, dec: number, targetId: string | null) {
    const base = view ?? VIEW_DEFAULTS;
    const next: View = { ...base, mode: base.mode === "focus" ? "blink" : base.mode, ra, dec, target: targetId, fv: 0, ft: null };
    writeView(next, true);
    setView(next);
    setInputError(null);
  }

  async function openTarget(t: Target) {
    setInput(t.name);
    if (t.kind === "distance") {
      // a distant body has no fixed field: centre on where it was when the focus is seeded
      let ra = t.ra;
      let dec = t.dec;
      try {
        const f = await fetchFocus(t.id, 0);
        ra = f.seed.ra;
        dec = f.seed.dec;
      } catch {
        /* fall back to the approximate position; the focus panel reports the error */
      }
      const next: View = { ...(view ?? VIEW_DEFAULTS), ra, dec, target: t.id, mode: "focus", fv: 0, ft: null };
      writeView(next, true);
      setView(next);
      setInputError(null);
      return;
    }
    // centre on the catalogue position moved to mid-2025 so fast movers stay in the field
    const years = 2025.9 - t.epoch;
    const dec = t.dec + ((t.pmDec ?? 0) * years) / 3600;
    const ra = t.ra + ((t.pmRa ?? 0) * years) / 3600 / Math.cos((t.dec * Math.PI) / 180);
    go(ra, dec, t.id);
    if (t.id === "wise0855") update({ det: 6 });
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = parseTarget(input);
    if (parsed.kind === "coords") return go(parsed.ra, parsed.dec, null);
    if (parsed.kind === "invalid") return setInputError(parsed.reason);
    const q = parsed.query.toLowerCase().replace(/[^a-z0-9]/g, "");
    const found = targets.find((t) => t.id === q || t.name.toLowerCase().replace(/[^a-z0-9]/g, "").includes(q));
    if (found) return openTarget(found);
    setInputError(`"${parsed.query}" is not one of the built-in names. Type coordinates, or pick an example below.`);
  }

  const size = stack?.grid.size ?? 1;
  const scale = stack?.grid.pixelScaleArcsec ?? 6.15;
  const toSvg = (ra: number, dec: number) => {
    const p = skyToGrid(ra, dec, stack!.center, size, scale);
    return { x: p.x + 0.5, y: size - 1 - p.y + 0.5 };
  };
  const yearNow = current ? mjdToYear(visitOf(current.visit)?.midMjd ?? 61000) : 2026;
  const propagate = (ra: number, dec: number, pmRa: number, pmDec: number, epoch0: number, year: number) => ({
    ra: ra + (pmRa * (year - epoch0)) / 3600 / Math.cos((dec * Math.PI) / 180),
    dec: dec + (pmDec * (year - epoch0)) / 3600,
  });

  const gaiaMarks = useMemo(() => {
    if (!stack || !view?.gaia) return [];
    return gaia
      .map((s) => {
        const pos = propagate(s.ra, s.dec, (s.pmRa ?? 0) / 1000, (s.pmDec ?? 0) / 1000, 2016.0, yearNow);
        return { s, ...toSvg(pos.ra, pos.dec) };
      })
      .filter((m) => m.x > 0 && m.y > 0 && m.x < size && m.y < size);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gaia, stack, view?.gaia, yearNow]);

  const predicted = useMemo(() => {
    if (!stack || !target || target.pmRa === undefined) return null;
    const pts = stack.visits.map((v) => {
      const pos = propagate(target.ra, target.dec, target.pmRa ?? 0, target.pmDec ?? 0, target.epoch, mjdToYear(v.midMjd));
      return { visit: v.index, ...toSvg(pos.ra, pos.dec) };
    });
    const now = pts.find((p) => p.visit === current?.visit) ?? pts[0];
    return { pts, now };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stack, target, current?.visit]);

  function onPointer(e: React.PointerEvent<HTMLDivElement>, pick: boolean) {
    if (!stack || !current) return;
    const r = e.currentTarget.getBoundingClientRect();
    const col = Math.floor(((e.clientX - r.left) / r.width) * size);
    const rowScreen = Math.floor(((e.clientY - r.top) / r.height) * size);
    const row = size - 1 - rowScreen;
    if (col < 0 || row < 0 || col >= size || row >= size) return;
    const sky = gridToSky(col, row, stack.center, size, scale);
    const v = current.image[row * size + col];
    setReadout(`${formatSexagesimal(sky.ra, sky.dec)}  ·  ${Number.isFinite(v) ? v.toFixed(2) + " MJy/sr" : "no data"}`);
    if (pick) {
      const near = gaiaMarks
        .map((m) => ({ m, d: Math.hypot(m.x - (col + 0.5), m.y - (rowScreen + 0.5)) }))
        .sort((a, b) => a.d - b.d)[0];
      setPicked(near && near.d < 2 ? near.m.s : null);
    }
  }

  const span = stack && stack.visits.length > 1 ? stack.visits[stack.visits.length - 1].midMjd - stack.visits[0].midMjd : 0;
  const shiftPx = (s: GaiaSource) => (Math.hypot(s.pmRa ?? 0, s.pmDec ?? 0) / 1000) * (span / 365.25) / scale;

  return (
    <div className="app">
      <header className="top">
        <div className="brand" aria-label="SEDNA">
          <svg width="34" height="14" viewBox="0 0 34 14" aria-hidden="true">
            <ellipse cx="15" cy="7" rx="14" ry="4.6" fill="none" stroke="var(--line-strong)" strokeWidth="1" />
            <circle cx="28.4" cy="5.6" r="2.2" fill="var(--red)" />
            <circle cx="9" cy="7" r="1.2" fill="var(--muted-strong)" />
          </svg>
          <span>SEDNA</span>
        </div>
        <form className="target" onSubmit={submit}>
          <label htmlFor="target-input" className="sr">Object name or coordinates (Right Ascension and Declination)</label>
          <input
            id="target-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Name or RA Dec — e.g. 133.795 -7.245"
            autoComplete="off"
            spellCheck={false}
            aria-invalid={inputError ? true : undefined}
            aria-describedby="target-help"
          />
          <button type="submit" className="primary">Load sky</button>
          <p id="target-help" className={inputError ? "help error" : "help"}>
            {inputError ?? (view ? `${formatSexagesimal(view.ra, view.dec)}  ·  ${view.fov}′ field` : "Decimal degrees or hh:mm:ss ±dd:mm:ss")}
          </p>
        </form>
        <div className="top-actions">
          {view && (
            <button type="button" className="text" onClick={() => navigator.clipboard?.writeText(location.href).catch(() => undefined)}>
              Copy link
            </button>
          )}
        </div>
      </header>

      {!view && (
        <section className="start">
          <h1>Watch the infrared sky change.</h1>
          <p>SEDNA shows NASA SPHEREx images of any patch of sky as a short sequence in time, so anything that moved or changed stands out. Type coordinates above, or start with one of these.</p>
          <ul className="examples">
            {targets.map((t) => (
              <li key={t.id}>
                <button type="button" onClick={() => openTarget(t)}>
                  <strong>{t.name}</strong>
                  <span>{t.note}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {view && (
        <main className="viewer">
          <aside className="rail left">
            <div className="group" role="group" aria-label="Compare mode">
              <span className="eyebrow">Compare</span>
              {MODES.map((m) => (
                <button key={m.id} type="button" className="opt" aria-pressed={view.mode === m.id} onClick={() => update({ mode: m.id })}>
                  <span className="dot" />
                  {m.label}
                </button>
              ))}
            </div>
            {view.mode !== "focus" && (
            <div className="group" role="group" aria-label="Field of view">
              <span className="eyebrow">Field of view</span>
              <div className="chips">
                {FOVS.map((f) => (
                  <button key={f} type="button" className="opt mono" aria-pressed={view.fov === f} onClick={() => update({ fov: f }, true)} title={f > 6 ? "Larger fields take longer to load" : undefined}>
                    {f}′
                  </button>
                ))}
              </div>
            </div>
            )}
          </aside>

          {view.mode === "focus" ? (
            <FocusPanel body={target?.kind === "distance" ? target : null} seed={target?.kind === "distance" ? null : seed} controls={targets.filter((t) => t.kind === "distance")} onOpen={openTarget} />
          ) : view.mode === "film" ? (
            <FilmPanel
              ra={view.ra}
              dec={view.dec}
              fov={view.fov}
              visit={view.fv}
              startMjd={view.ft}
              movers={movers.kind === "ready" ? movers.data.movers.filter((m) => m.visible) : []}
              onVisit={(v) => update({ fv: v, ft: null }, true)}
              onFocus={(s) => { setSeed(s); update({ mode: "focus", target: null }, true); }}
            />
          ) : (
          <section className="stage-wrap">
            <div className="caption mono">
              {status.kind === "ready" && current ? (
                <>
                  <span className="now">
                    {view.mode === "diff" && frames.length > 1
                      ? `${dateLabel(frames[frames.length - 1].start)} − ${dateLabel(frames[0].start)}`
                      : view.mode === "sum"
                        ? `Sum of ${frames.length} visits`
                        : dateLabel(current.start)}
                  </span>
                  <span>D{view.det} · {DETECTORS[view.det - 1].range}</span>
                  <span>{view.mode === "blink" ? `${current.exposures} exp.` : `${frames.reduce((s, f) => s + f.exposures, 0)} exp.`}</span>
                </>
              ) : (
                <span>&nbsp;</span>
              )}
            </div>
            <div
              className="stage"
              role="img"
              aria-label={current ? `SPHEREx image, detector ${view.det}, ${dateLabel(current.start)}` : "SPHEREx image"}
              onPointerMove={(e) => onPointer(e, false)}
              onPointerLeave={() => setReadout(null)}
              onClick={(e) => onPointer(e as unknown as React.PointerEvent<HTMLDivElement>, true)}
            >
              {status.kind === "loading" && <p className="stage-msg" role="status">Reading SPHEREx exposures from the archive…</p>}
              {status.kind === "error" && <p className="stage-msg error" role="alert">{status.message}</p>}
              {status.kind === "ready" && !frames.length && <p className="stage-msg">No exposures of this field in detector {view.det}. Try another detector.</p>}
              <canvas ref={canvasRef} hidden={status.kind !== "ready" || !frames.length} />
              {status.kind === "ready" && frames.length > 0 && stack && (
                <svg viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
                  {gaiaMarks.map((m) => (
                    <circle key={m.s.id} cx={m.x} cy={m.y} r={1.5} fill="none" stroke={picked?.id === m.s.id ? "var(--fg)" : "var(--ice)"} strokeWidth={shiftPx(m.s) > 0.3 ? 0.2 : 0.1} opacity={shiftPx(m.s) > 0.3 ? 0.95 : 0.55} />
                  ))}
                  {predicted && (
                    <g stroke="var(--red-text)" strokeLinecap="round">
                      <polyline points={predicted.pts.map((p) => `${p.x},${p.y}`).join(" ")} fill="none" strokeWidth={0.14} strokeDasharray="0.6 0.6" />
                      {[[-3.2, 0, -1.8, 0], [1.8, 0, 3.2, 0], [0, -3.2, 0, -1.8], [0, 1.8, 0, 3.2]].map(([a, b, c, d], i) => (
                        <line key={i} x1={predicted.now.x + a} y1={predicted.now.y + b} x2={predicted.now.x + c} y2={predicted.now.y + d} strokeWidth={0.24} />
                      ))}
                    </g>
                  )}
                </svg>
              )}
            </div>
            <div className="readout mono">
              <span>{readout ?? "Point at the sky to read its position and value"}</span>
              <span>North up, east left · asinh, one stretch for all dates</span>
            </div>
            {picked && (
              <p className="verdict" role="status">
                <strong>Known star.</strong> Gaia DR3 {picked.id}, G = {picked.g?.toFixed(1) ?? "?"}. Catalogue motion {(Math.hypot(picked.pmRa ?? 0, picked.pmDec ?? 0) / 1000).toFixed(2)}″ per year:
                about {shiftPx(picked).toFixed(2)} pixel over the dates shown.
              </p>
            )}
            <MoversNote state={movers} onShow={(m) => update({ mode: "film", fv: m.visit, ft: m.closestMjd }, true)} />
            {target && <p className="note-line">{target.note}</p>}
          </section>
          )}

          <aside className="rail right" hidden={view.mode === "focus" || view.mode === "film"}>
            <div className="group" role="group" aria-label="Detector">
              <span className="eyebrow">Detector</span>
              {DETECTORS.map((d) => (
                <button key={d.id} type="button" className="opt" aria-pressed={view.det === d.id} onClick={() => update({ det: d.id })}>
                  <span className="dot" />
                  <span className="mono">D{d.id}</span>
                  <span className="sub mono">{d.range}</span>
                </button>
              ))}
            </div>
            <div className="group" role="group" aria-label="Overlays and display">
              <span className="eyebrow">Overlays</span>
              <button type="button" className="opt" aria-pressed={view.gaia} onClick={() => update({ gaia: !view.gaia })}>
                <span className="dot" />Gaia DR3 stars
              </button>
              <button type="button" className="opt" aria-pressed={view.invert} onClick={() => update({ invert: !view.invert })}>
                <span className="dot" />Invert
              </button>
              <a className="opt link" href={`http://byw.tools/wiseview#ra=${view.ra.toFixed(5)}&dec=${view.dec.toFixed(5)}&size=${Math.round(view.fov * 60)}&band=2`} target="_blank" rel="noopener">
                Same sky in WiseView ↗<span className="sr"> (opens in new tab)</span>
              </a>
            </div>
          </aside>

          <footer className="timeline" hidden={view.mode === "focus" || view.mode === "film"}>
            <button type="button" className="play" onClick={() => setPlaying((p) => !p)} aria-label={playing ? "Pause" : "Play"} disabled={view.mode !== "blink" || frames.length < 2}>
              <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
                {playing ? <path d="M3 2h2.6v10H3zM8.4 2H11v10H8.4z" fill="currentColor" /> : <path d="M4 2l8 5-8 5z" fill="currentColor" />}
              </svg>
            </button>
            <div className="track" role="group" aria-label="Visits">
              {frames.map((f, i) => {
                const v = visitOf(f.visit);
                const first = visitOf(frames[0].visit)?.midMjd ?? 0;
                const last = visitOf(frames[frames.length - 1].visit)?.midMjd ?? 1;
                const left = frames.length > 1 ? 6 + (88 * ((v?.midMjd ?? first) - first)) / (last - first) : 50;
                return (
                  <button key={f.visit} type="button" className="tick" style={{ left: `${left}%` }} aria-current={i === epoch && view.mode === "blink"} onClick={() => { setEpoch(i); update({ mode: "blink" }); }}>
                    <i />
                    <span className="mono">{dateLabel(f.start)}</span>
                  </button>
                );
              })}
            </div>
            <button type="button" className="speed mono" onClick={() => update({ fps: view.fps === 1 ? 2 : view.fps === 2 ? 4 : 1 })} aria-label="Blink speed">
              {view.fps} fps
            </button>
          </footer>
        </main>
      )}

      <footer className="credits">
        <span>
          Data: NASA SPHEREx Level-2 spectral images (DR1 and QR3), read from the public archive bucket{health ? `, through ${health}` : ""}. Star positions: ESA Gaia DR3.
        </span>
        {stack && status.kind === "ready" && (
          <span className="mono">
            {stack.exposuresRead} exposures · {stack.source === "cache" ? "prepared result" : `read in ${stack.seconds}s`}
          </span>
        )}
      </footer>
    </div>
  );
}
