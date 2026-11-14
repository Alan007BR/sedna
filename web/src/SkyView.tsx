// Full screen: the stack as a sky map you pan and zoom, the data window inside a smoked-glass reflection of
// itself, and every control as a glass HUD widget at the edges (sedna-ui, references/sky-view.md).
// It is the whole tool, not a reduced one: every mode, toggle and detail of the void view is here, the
// details in a drawer beside the sky. It shares all state with the void view; only the layout differs.
// Code written with AI assistance (Claude); see AI_USAGE.md.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { defaultSpectrumBin, detectorColor, fetchBrightness, spectrumPoints, type Brightness } from "./lib/brightness";
import { formatSexagesimal, gridToSky } from "./lib/coords";
import { mean, mirrorTiles, paintStack, renderFrame, type Limits, type ViewMode } from "./lib/render";
import {
  clampView,
  fieldInView,
  gridToScreen,
  mapSpan,
  openingView,
  openingViewIn,
  REACH,
  scaleBar,
  screenToWindow,
  SHARP_FROM,
  zoomAt,
  type Area,
  type MapView,
  type Viewport,
} from "./lib/skymap";

export type SkyTick = { key: string; label: string; left: number; current: boolean; onClick: () => void };
type GridPoint = { x: number; y: number };

type Props = {
  size: number;
  pixelArcsec: number;
  center: { ra: number; dec: number };
  frames: Float32Array[];
  epoch: number;
  mode: ViewMode;
  appMode: string;
  modes: { id: string; label: string; help?: string }[];
  limits: Limits;
  invert: boolean;
  status: string | null;
  title: string;
  caption: string[];
  windowLabel: string;
  det: number;
  detectors: { id: number; range: string }[];
  fov: number;
  fovs: number[];
  gaia: { id: string; x: number; y: number; fast: boolean }[] | null;
  pickedId: string | null;
  measured: GridPoint | null;
  predicted: { pts: GridPoint[]; now: GridPoint } | null;
  rulerMarks: ReactNode | null;
  ticks: SkyTick[];
  playing: boolean;
  fps: number;
  spectrumQuery: { ra: number; dec: number; target: string | null };
  details: ReactNode;
  attention: string;
  overlays: { invert: boolean; ruler: boolean; wiseview: string };
  copied: "link" | "embed" | null;
  onPick: (col: number, rowScreen: number) => void;
  onPlay: () => void;
  onSpeed: () => void;
  onMode: (m: string) => void;
  onDet: (d: number) => void;
  onFov: (f: number) => void;
  onGaia: () => void;
  onInvert: () => void;
  onRuler: () => void;
  onCopyLink: () => void;
  onCopyEmbed: () => void;
  onExit: () => void;
};

const CLOSE_HALF = 10; // close-up of 21 x 21 pixels, 2.2 arcmin
const NARROW = 860;
const LEFT_RESERVE = 340; // the left widgets (target, caption, compare and layers, scale) are at most 320 px wide
const BASE = import.meta.env.BASE_URL;
const SKY_MODES = new Set(["blink", "diff", "sum"]);

const Icon = ({ d, label }: { d: string; label: string }) => (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
    <title>{label}</title>
    <path d={d} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const ICONS = {
  minus: "M3.5 8h9",
  plus: "M3.5 8h9M8 3.5v9",
  target: "M8 1.5v3M8 11.5v3M1.5 8h3M11.5 8h3M8 6a2 2 0 1 0 0 4a2 2 0 1 0 0-4",
  link: "M6.5 9.5l3-3M5 7.5l-1.5 1.5a2.1 2.1 0 0 0 3 3L8 10.5M11 8.5l1.5-1.5a2.1 2.1 0 0 0-3-3L8 5.5",
  embed: "M5.5 4.5L2 8l3.5 3.5M10.5 4.5L14 8l-3.5 3.5",
  details: "M2.5 2.5h11v11h-11zM9.5 2.5v11",
  hide: "M2 8s2.2-4 6-4 6 4 6 4-2.2 4-6 4-6-4-6-4zM2.5 2.5l11 11",
  exit: "M6 2.5v3.5H2.5M10 2.5v3.5h3.5M6 13.5V10H2.5M10 13.5V10h3.5",
  layers: "M8 2.5l5.5 3-5.5 3-5.5-3zM2.5 8.5l5.5 3 5.5-3",
  close: "M4 4l8 8M12 4l-8 8",
};

/** Whether the person asked for something the drawer shows: a picked point, the lens, a panel mode, a mission, the ruler. */
function wantsDrawer(attention: string): boolean {
  const [picked, click, bp, mode, mission, ruler] = attention.split("|");
  return Boolean(picked || click || bp || mission || ruler === "true" || (mode && !SKY_MODES.has(mode)));
}

function MiniSpectrum({ query }: { query: Props["spectrumQuery"] }) {
  const [state, setState] = useState<{ kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; data: Brightness }>({ kind: "loading" });
  useEffect(() => {
    let live = true;
    setState({ kind: "loading" });
    fetchBrightness(query.ra, query.dec, query.target) // shared with the lens: one measurement per point
      .then((data) => live && setState({ kind: "ready", data }))
      .catch((err) => live && setState({ kind: "error", message: err.message ?? "No spectrum here." }));
    return () => { live = false; };
  }, [query.ra, query.dec, query.target]);
  if (state.kind === "loading") return <p className="hud-note">Measuring the spectrum…</p>;
  if (state.kind === "error") return <p className="hud-note">{state.message}</p>;
  if (state.data.method === "wing") return <p className="hud-note">Saturated star: measured in its wings, so no spectrum is drawn.</p>;
  const bin = defaultSpectrumBin(state.data);
  const pts = bin === null ? [] : spectrumPoints(state.data, bin);
  if (!pts.length) return <p className="hud-note">Not enough exposures for a spectrum here yet.</p>;
  const lo = Math.log10(Math.min(...pts.map((p) => p.y)));
  const hi = Math.log10(Math.max(...pts.map((p) => p.y)));
  const W = 200;
  const H = 120;
  const x = (um: number) => 6 + ((um - 0.7) / 4.4) * (W - 12);
  const y = (f: number) => H - 14 - ((Math.log10(f) - lo) / Math.max(hi - lo, 0.1)) * (H - 26);
  return (
    <svg className="mini-spectrum" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Spectrum from ${pts.length} exposures, 0.7 to 5 micrometres, flux on a log scale`}>
      {[1, 2, 3, 4, 5].map((um) => (
        <text key={um} x={x(um)} y={H - 2} textAnchor="middle">{um}</text>
      ))}
      <line x1={6} x2={W - 6} y1={H - 12} y2={H - 12} stroke="var(--line-strong)" strokeWidth={0.6} />
      {pts.map((p, i) => (
        <circle key={i} cx={x(p.x)} cy={y(p.y)} r={1.6} fill={detectorColor(p.det)} />
      ))}
    </svg>
  );
}

export default function SkyView(p: Props) {
  const { size } = p;
  const rootRef = useRef<HTMLDivElement>(null);
  const windowRef = useRef<HTMLCanvasElement>(null);
  const glassRef = useRef<HTMLCanvasElement>(null);
  const closeRef = useRef<HTMLCanvasElement>(null);
  const [vp, setVp] = useState<Viewport>({ w: innerWidth, h: innerHeight });
  const [drawer, setDrawer] = useState(() => wantsDrawer(p.attention));
  const narrow = vp.w < NARROW;
  const drawerW = Math.min(420, Math.round(vp.w * 0.36));
  // the part of the screen the sky keeps when the drawer is open: right of the left widgets (desktop) or
  // between the top widgets and the bottom sheet (phones)
  const free: Area | null = useMemo(() => {
    if (!drawer) return null;
    if (narrow) return { x: 0, y: 124, w: vp.w, h: Math.max(120, vp.h - 76 - 0.48 * vp.h - 124 - 10) };
    const room = vp.w - drawerW - 28;
    const left = room - LEFT_RESERVE >= 280 ? LEFT_RESERVE : 0;
    return { x: left, y: 0, w: room - left, h: vp.h };
  }, [drawer, narrow, vp.w, vp.h, drawerW]);
  const fit = useCallback(() => (free ? openingViewIn(size, vp, free, narrow ? 0 : undefined) : openingView(size, vp)), [size, vp, free?.w, free?.h, narrow]); // eslint-disable-line react-hooks/exhaustive-deps
  const [view, setView] = useState<MapView>(() => openingView(size, { w: innerWidth, h: innerHeight }));
  const [hud, setHud] = useState<"shown" | "faded" | "hidden">("shown");
  const [tab, setTab] = useState<"pixels" | "spectrum">("pixels");
  const [layers, setLayers] = useState(false);
  const [showPredicted, setShowPredicted] = useState(true);
  const [readout, setReadout] = useState<string | null>(null);
  const pointers = useRef<Map<number, { x: number; y: number }>>(new Map());
  const press = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const wasFull = useRef(false);
  const firstAttention = useRef(true);

  useEffect(() => {
    const onResize = () => setVp({ w: innerWidth, h: innerHeight });
    addEventListener("resize", onResize);
    return () => removeEventListener("resize", onResize);
  }, []);
  // a new field, or the drawer opening or closing, frames the window again in the free part of the screen
  useEffect(() => setView(fit()), [size, drawer, narrow]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => setView((v) => clampView(v, size, vp)), [vp, size]);
  // anything the person asks for opens the drawer
  useEffect(() => {
    if (firstAttention.current) { firstAttention.current = false; return; }
    if (wantsDrawer(p.attention)) setDrawer(true);
  }, [p.attention]);

  // browser full screen when allowed; leaving it leaves the sky view
  useEffect(() => {
    rootRef.current?.requestFullscreen?.().then(() => { wasFull.current = true; }).catch(() => undefined);
    const onChange = () => { if (!document.fullscreenElement && wasFull.current) p.onExit(); };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const exit = useCallback(() => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined);
    p.onExit();
  }, [p]);

  const ready = p.frames.length > 0;

  // the data window: the same pixels as the void view, and its close-up
  useEffect(() => {
    const c = windowRef.current;
    if (!c || !ready) return;
    c.width = size;
    c.height = size;
    const ctx = c.getContext("2d")!;
    const out = ctx.createImageData(size, size);
    paintStack(p.frames, p.epoch, p.mode, size, out, p.limits, p.invert);
    ctx.putImageData(out, 0, 0);
    const close = closeRef.current;
    if (close) {
      const n = 2 * CLOSE_HALF + 1;
      close.width = n;
      close.height = n;
      const cc = close.getContext("2d")!;
      cc.imageSmoothingEnabled = false;
      const c0 = Math.round((size - 1) / 2) - CLOSE_HALF;
      cc.drawImage(c, c0, c0, n, n, 0, 0, n, n);
    }
  }, [p.frames, p.epoch, p.mode, p.limits, p.invert, size, tab, ready, drawer]);

  // the smoked glass: the mean of the epochs mirrored outward; static, never blinks
  useEffect(() => {
    const c = glassRef.current;
    if (!c || !ready) return;
    const tile = new ImageData(size, size);
    renderFrame(mean(p.frames), size, tile, { limits: p.limits, softening: 10, invert: p.invert });
    const span = mapSpan(size);
    c.width = span;
    c.height = span;
    c.getContext("2d")!.putImageData(new ImageData(mirrorTiles(tile.data, size, REACH), span, span), 0, 0);
  }, [p.frames, p.limits, p.invert, size, ready]);

  // the HUD fades while the sky plays and comes back on any input
  useEffect(() => {
    const calm = matchMedia("(prefers-reduced-motion: reduce)").matches || matchMedia("(prefers-contrast: more)").matches;
    let timer = 0;
    const wake = () => {
      setHud((h) => (h === "faded" ? "shown" : h));
      clearTimeout(timer);
      if (p.playing && !calm && !drawer) timer = window.setTimeout(() => setHud((h) => (h === "shown" ? "faded" : h)), 2600);
    };
    wake();
    const events = ["pointermove", "pointerdown", "keydown", "wheel", "touchstart"] as const;
    events.forEach((e) => addEventListener(e, wake, { passive: true }));
    return () => { clearTimeout(timer); events.forEach((e) => removeEventListener(e, wake)); };
  }, [p.playing, drawer]);

  // keys that only the sky view knows
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      const mid = { x: (free ? free.x + free.w / 2 : vp.w / 2), y: (free ? free.y + free.h / 2 : vp.h / 2) };
      if (e.key === "Escape" || e.key === "f" || e.key === "F") { e.preventDefault(); exit(); }
      else if (e.key === "+" || e.key === "=") setView((v) => zoomAt(v, 1.4, mid.x, mid.y, size, vp));
      else if (e.key === "-" || e.key === "_") setView((v) => zoomAt(v, 1 / 1.4, mid.x, mid.y, size, vp));
      else if (e.key === "0") setView(fit());
      else if (e.key === "h" || e.key === "H") setHud((h) => (h === "hidden" ? "shown" : "hidden"));
      else if (e.key === "i" || e.key === "I") setDrawer((d) => !d);
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [vp, size, exit, fit, free]);

  // wheel zoom around the pointer (a native listener, so the page itself never scrolls)
  const surfaceRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = surfaceRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setView((v) => zoomAt(v, Math.exp(-e.deltaY * 0.0015), e.clientX, e.clientY, size, vp));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [size, vp]);

  function onPointerDown(e: React.PointerEvent) {
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    press.current = pointers.current.size === 1 ? { x: e.clientX, y: e.clientY, moved: false } : null;
  }
  function onPointerMove(e: React.PointerEvent) {
    const pts = pointers.current;
    const prev = pts.get(e.pointerId);
    if (prev) {
      if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        const before = Math.hypot(a.x - b.x, a.y - b.y);
        pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
        const [c, d] = [...pts.values()];
        const after = Math.hypot(c.x - d.x, c.y - d.y);
        if (before > 0) setView((v) => zoomAt(v, after / before, (c.x + d.x) / 2, (c.y + d.y) / 2, size, vp));
        press.current = null;
        return;
      }
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (press.current && Math.hypot(e.clientX - press.current.x, e.clientY - press.current.y) > 5) press.current.moved = true;
      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;
      setView((v) => clampView({ ...v, tx: v.tx + dx, ty: v.ty + dy }, size, vp));
    }
    const hit = ready ? screenToWindow(view, size, e.clientX, e.clientY) : null;
    if (!hit) {
      setReadout(ready ? "Outside the data · reflection only, no values" : null);
    } else {
      const row = size - 1 - hit.rowScreen;
      const sky = gridToSky(hit.col, row, p.center, size, p.pixelArcsec);
      const v = p.mode === "blink" ? p.frames[Math.min(p.epoch, p.frames.length - 1)]?.[row * size + hit.col] : NaN;
      setReadout(`${formatSexagesimal(sky.ra, sky.dec)}${Number.isFinite(v) ? ` · ${v.toFixed(2)} MJy/sr` : ""} · click to identify`);
    }
  }
  function onPointerUp(e: React.PointerEvent) {
    pointers.current.delete(e.pointerId);
    const click = press.current;
    press.current = null;
    if (click && !click.moved && ready) {
      const hit = screenToWindow(view, size, e.clientX, e.clientY);
      if (hit) p.onPick(hit.col, hit.rowScreen);
    }
  }

  const sharp = view.s >= SHARP_FROM;
  const win = gridToScreen(view, size, 0, 0);
  const winSize = size * view.s;
  const bar = scaleBar(view.s, p.pixelArcsec);
  const fov = fieldInView(view.s, vp, p.pixelArcsec);
  const marks = useMemo(() => {
    const toS = (g: GridPoint) => gridToScreen(view, size, g.x, g.y);
    const gap = Math.max(9, 1.6 * view.s);
    const pred = p.predicted && showPredicted ? { pts: p.predicted.pts.map(toS), now: toS(p.predicted.now) } : null;
    return { gap, pred, measured: p.measured ? toS(p.measured) : null, gaia: (p.gaia ?? []).map((g) => ({ ...g, ...toS(g) })), r: Math.min(12, Math.max(7, 1.5 * view.s)) };
  }, [p.predicted, p.gaia, p.measured, showPredicted, view, size]);
  const tick = (c: { x: number; y: number }, gap: number) =>
    [[-1, 0], [1, 0], [0, -1], [0, 1]].map(([dx, dy], i) => <line key={i} x1={c.x + dx * gap} y1={c.y + dy * gap} x2={c.x + dx * (gap + 9)} y2={c.y + dy * (gap + 9)} />);

  const zoomButton = (factor: number, label: string, icon: string) => (
    <button type="button" className="hud-icon" onClick={() => setView((v) => zoomAt(v, factor, free ? free.x + free.w / 2 : vp.w / 2, free ? free.y + free.h / 2 : vp.h / 2, size, vp))} aria-label={label} title={label}>
      <Icon d={icon} label={label} />
    </button>
  );
  const compare = (
    <div className="hud-group" role="group" aria-label="Compare">
      <span className="eyebrow">Compare</span>
      {p.modes.map((m) => (
        <button key={m.id} type="button" className="opt" aria-pressed={p.appMode === m.id} onClick={() => p.onMode(m.id)} aria-describedby="sky-mode-help">
          <span className="dot" />{m.label}
        </button>
      ))}
      {p.modes.find((m) => m.id === p.appMode)?.help && <p className="mode-help" id="sky-mode-help">{p.modes.find((m) => m.id === p.appMode)?.help}</p>}
    </div>
  );
  const layersPanel = (
    <>
      <div className="hud-group" role="group" aria-label="Detector">
        <span className="eyebrow">Detector</span>
        <div className="hud-chips">
          {p.detectors.map((d) => (
            <button key={d.id} type="button" className="opt mono" aria-pressed={p.det === d.id} onClick={() => p.onDet(d.id)} title={d.range}>D{d.id}</button>
          ))}
        </div>
      </div>
      <div className="hud-group" role="group" aria-label="Field of view">
        <span className="eyebrow">Field of view</span>
        <div className="hud-chips">
          {p.fovs.map((f) => (
            <button key={f} type="button" className="opt mono" aria-pressed={p.fov === f} onClick={() => p.onFov(f)} title={f > 6 ? "Larger fields take longer to load" : undefined}>{f}′</button>
          ))}
        </div>
      </div>
      <div className="hud-group" role="group" aria-label="Overlays">
        <span className="eyebrow">Overlays</span>
        {p.predicted && (
          <button type="button" className="opt" aria-pressed={showPredicted} onClick={() => setShowPredicted((s) => !s)}>
            <span className="dot" />Predicted position
          </button>
        )}
        <button type="button" className="opt" aria-pressed={p.gaia !== null} onClick={p.onGaia}><span className="dot" />Gaia DR3 stars</button>
        <button type="button" className="opt" aria-pressed={p.overlays.invert} onClick={p.onInvert}><span className="dot" />Invert</button>
        <button type="button" className="opt" aria-pressed={p.overlays.ruler} onClick={p.onRuler}><span className="dot" />Parallax ruler</button>
        <a className="opt link" href={p.overlays.wiseview} target="_blank" rel="noopener">Same sky in WiseView ↗<span className="sr"> (opens in new tab)</span></a>
      </div>
    </>
  );

  return (
    <div
      ref={rootRef}
      className={`sky hud-${hud}${drawer ? " drawer-open" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-label={`Full-screen sky view of ${p.title}`}
      style={{
        ["--drawer-w" as string]: `${drawerW}px`,
        ["--free-cx" as string]: free ? `${free.x + free.w / 2}px` : "50%",
        ["--free-w" as string]: free ? `${Math.min(520, free.w)}px` : "520px",
      }}
    >
      <div
        ref={surfaceRef}
        className="sky-surface"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => setReadout(null)}
        onDoubleClick={(e) => setView((v) => zoomAt(v, 2, e.clientX, e.clientY, size, vp))}
      >
        <div className="sky-map" style={{ width: mapSpan(size), height: mapSpan(size), transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.s})` }}>
          <canvas ref={glassRef} className={`sky-glass${p.mode === "diff" ? " dim" : ""}`} style={{ width: mapSpan(size), height: mapSpan(size), visibility: ready ? "visible" : "hidden" }} aria-hidden="true" />
          <canvas ref={windowRef} className="sky-window" style={{ left: REACH * size, top: REACH * size, width: size, height: size, imageRendering: sharp ? "pixelated" : "auto", visibility: ready ? "visible" : "hidden" }} aria-hidden="true" />
        </div>
        <div className="sky-frame" style={{ left: win.x, top: win.y, width: winSize, height: winSize }} aria-hidden="true" />
        {ready && <p className="sky-label mono" style={{ left: win.x, top: win.y - 22 }}>{p.windowLabel}</p>}
        {p.status && (
          <p className="sky-status" role="status" style={{ left: win.x, top: win.y, width: winSize, height: winSize }}>{p.status}</p>
        )}
        {ready && p.rulerMarks && (
          <svg className="sky-ruler" viewBox={`0 0 ${size} ${size}`} style={{ left: win.x, top: win.y, width: winSize, height: winSize }} aria-hidden="true">
            {p.rulerMarks}
          </svg>
        )}
        {ready && (
          <svg className="sky-marks" width={vp.w} height={vp.h} aria-hidden="true">
            <defs>
              <clipPath id="sky-window-clip"><rect x={win.x} y={win.y} width={winSize} height={winSize} /></clipPath>
            </defs>
            <g clipPath="url(#sky-window-clip)">
              {marks.gaia.map((g) => (
                <circle key={g.id} cx={g.x} cy={g.y} r={marks.r} fill="none" stroke={g.id === p.pickedId ? "var(--fg)" : "var(--ice)"} strokeWidth={g.id === p.pickedId ? 1.8 : g.fast ? 1.4 : 1} opacity={g.id === p.pickedId || g.fast ? 0.95 : 0.6} />
              ))}
              {marks.measured && <g stroke="var(--ice)" strokeWidth={1.6} strokeLinecap="round">{tick(marks.measured, marks.gap)}</g>}
              {marks.pred && (
                <g stroke="var(--red-text)" strokeLinecap="round" fill="none">
                  <polyline points={marks.pred.pts.map((q) => `${q.x},${q.y}`).join(" ")} strokeWidth={1.2} strokeDasharray="4 4" />
                  <g strokeWidth={1.8}>{tick(marks.pred.now, marks.gap)}</g>
                </g>
              )}
            </g>
          </svg>
        )}
      </div>

      {/* HUD: glass widgets at the edges, never over the target */}
      <header className="hud hud-tl">
        <img src={`${BASE}brand/sedna-wordmark-on-dark.svg`} width={120} height={28} alt="SEDNA" />
        <strong>{p.title}</strong>
        <span className="mono">{formatSexagesimal(p.center.ra, p.center.dec)}  {Math.round(fov.w)}′ × {Math.round(fov.h)}′ in view</span>
      </header>
      {ready && (
        <p className="hud hud-caption mono">
          <span className="now">{p.caption[0]}</span>
          {p.caption.length > 1 && <span>{p.caption.slice(1).join(" · ")}</span>}
        </p>
      )}

      <nav className="hud hud-tr" aria-label="View">
        {zoomButton(1 / 1.4, "Zoom out", ICONS.minus)}
        <span className="mono hud-zoom" aria-live="polite">{view.s.toFixed(1)}×</span>
        {zoomButton(1.4, "Zoom in", ICONS.plus)}
        <button type="button" className="hud-icon wide-only" onClick={() => setView(fit())} aria-label="Back to the target" title="Back to the target (0)"><Icon d={ICONS.target} label="Back to the target" /></button>
        <button type="button" className="hud-icon wide-only" onClick={p.onCopyLink} aria-label={p.copied === "link" ? "Link copied" : "Copy link"} title={p.copied === "link" ? "Copied" : "Copy link"}><Icon d={ICONS.link} label="Copy link" /></button>
        <button type="button" className="hud-icon wide-only" onClick={p.onCopyEmbed} aria-label={p.copied === "embed" ? "Embed code copied" : "Copy embed code"} title={p.copied === "embed" ? "Copied" : "Copy embed code"}><Icon d={ICONS.embed} label="Copy embed code" /></button>
        <button type="button" className="hud-icon" onClick={() => setDrawer((d) => !d)} aria-expanded={drawer} aria-label="Details" title="Details (I)"><Icon d={ICONS.details} label="Details" /></button>
        <button type="button" className="hud-icon wide-only" onClick={() => setHud("hidden")} aria-label="Hide the controls" title="Hide the controls (H)"><Icon d={ICONS.hide} label="Hide the controls" /></button>
        <button type="button" className="hud-icon narrow-only" onClick={() => setLayers((l) => !l)} aria-expanded={layers} aria-label="Layers" title="Layers"><Icon d={ICONS.layers} label="Layers" /></button>
        <button type="button" className="hud-icon" onClick={exit} aria-label="Leave full screen" title="Leave full screen (Esc)"><Icon d={ICONS.exit} label="Leave full screen" /></button>
      </nav>

      {!drawer && <aside className="hud hud-right">{layersPanel}</aside>}
      <aside className="hud hud-left">{compare}{drawer && !narrow && <div className="hud-left-layers">{layersPanel}</div>}</aside>
      {layers && <div className="hud hud-sheet">{compare}{layersPanel}</div>}

      {drawer && (
        <aside className="hud sky-drawer" aria-label="Details">
          <div className="sky-drawer-head">
            <span className="eyebrow">Details</span>
            <button type="button" className="hud-icon narrow-only" onClick={exit} aria-label="Leave full screen" title="Leave full screen"><Icon d={ICONS.exit} label="Leave full screen" /></button>
            <button type="button" className="hud-icon" onClick={() => setDrawer(false)} aria-label="Close the details" title="Close (I)"><Icon d={ICONS.close} label="Close" /></button>
          </div>
          <div className="sky-drawer-body">{p.details}</div>
        </aside>
      )}

      <footer className="hud hud-bl">
        <div className="hud-scale">
          <svg width="28" height="28" viewBox="0 0 28 28" aria-label="North up, east left">
            <path d="M22 26V6M22 26H2" stroke="var(--muted-strong)" strokeWidth="1" fill="none" />
            <text x="22" y="5" textAnchor="middle">N</text>
            <text x="0" y="24">E</text>
          </svg>
          <div>
            <span className="hud-bar" style={{ width: bar.px }} />
            <span className="mono">{bar.arcmin}′ · {sharp ? "pixels" : "smoothed"}</span>
          </div>
        </div>
        <p className="mono hud-readout">{readout ?? "Drag to pan · wheel to zoom · click a star to identify it"}</p>
      </footer>

      {ready && (
        <div className="hud hud-bc" role="group" aria-label="Visits">
          <button type="button" className="play" onClick={p.onPlay} aria-label={p.playing ? "Pause" : "Play"} disabled={p.mode !== "blink" || p.frames.length < 2 || p.appMode !== "blink"}>
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
              {p.playing ? <path d="M3 2h2.6v10H3zM8.4 2H11v10H8.4z" fill="currentColor" /> : <path d="M4 2l8 5-8 5z" fill="currentColor" />}
            </svg>
          </button>
          <div className="track">
            {p.ticks.map((t) => (
              <button key={t.key} type="button" className="tick" style={{ left: `${t.left}%` }} aria-current={t.current} onClick={t.onClick}>
                <i />
                <span className="mono">{t.label}</span>
              </button>
            ))}
          </div>
          <button type="button" className="speed mono" onClick={p.onSpeed} aria-label="Blink speed">{p.fps} fps</button>
        </div>
      )}

      {ready && !drawer && (
        <section className="hud hud-br" aria-label="Target close-up">
          <div className="hud-tabs" role="tablist">
            <button type="button" role="tab" className="opt" aria-selected={tab === "pixels"} aria-pressed={tab === "pixels"} onClick={() => setTab("pixels")}><span className="dot" />Pixels</button>
            <button type="button" role="tab" className="opt wide-only" aria-selected={tab === "spectrum"} aria-pressed={tab === "spectrum"} onClick={() => setTab("spectrum")}><span className="dot" />Spectrum</button>
            <span className="mono hud-sub">{tab === "pixels" ? `${(((2 * CLOSE_HALF + 1) * p.pixelArcsec) / 60).toFixed(1)}′ · raw` : "µJy · log"}</span>
          </div>
          {tab === "pixels" ? (
            <div className="hud-close">
              <canvas ref={closeRef} aria-label="The target's pixels, fixed on the sky, so motion shows as the visits play" />
              <svg viewBox="0 0 21 21" aria-hidden="true">
                <g stroke="var(--red-text)" strokeWidth="0.22" strokeLinecap="round">
                  <path d="M7 10.5h2M12 10.5h2M10.5 7v2M10.5 12v2" />
                </g>
              </svg>
            </div>
          ) : (
            <MiniSpectrum query={p.spectrumQuery} />
          )}
        </section>
      )}

      {hud === "hidden" && (
        <button type="button" className="hud-restore" onClick={() => setHud("shown")}>Show controls</button>
      )}
    </div>
  );
}
