// Full screen: the stack as a sky map you pan and zoom, the data window inside a smoked-glass reflection of
// itself, and every control as a glass HUD widget at the edges (sedna-ui, references/sky-view.md).
// It shares all state with the void view; only the layout differs.
// Code written with AI assistance (Claude); see AI_USAGE.md.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { defaultSpectrumBin, detectorColor, fetchBrightness, spectrumPoints, type Brightness } from "./lib/brightness";
import { formatSexagesimal, gridToSky } from "./lib/coords";
import { mean, mirrorTiles, paintStack, renderFrame, type Limits, type ViewMode } from "./lib/render";
import { clampView, fieldInView, gridToScreen, mapSpan, openingView, REACH, scaleBar, screenToWindow, SHARP_FROM, zoomAt, type MapView, type Viewport } from "./lib/skymap";

export type SkyTick = { key: string; label: string; left: number; current: boolean; onClick: () => void };
type GridPoint = { x: number; y: number };

type Props = {
  size: number;
  pixelArcsec: number;
  center: { ra: number; dec: number };
  frames: Float32Array[];
  epoch: number;
  mode: ViewMode;
  limits: Limits;
  invert: boolean;
  title: string;
  caption: string[];
  windowLabel: string;
  det: number;
  detectors: { id: number; range: string }[];
  gaia: { id: string; x: number; y: number; fast: boolean }[] | null;
  predicted: { pts: GridPoint[]; now: GridPoint } | null;
  ticks: SkyTick[];
  playing: boolean;
  fps: number;
  spectrumQuery: { ra: number; dec: number; target: string | null };
  onPlay: () => void;
  onSpeed: () => void;
  onMode: (m: ViewMode) => void;
  onDet: (d: number) => void;
  onGaia: () => void;
  onCopyLink: () => void;
  onExit: () => void;
};

const CLOSE_HALF = 10; // close-up of 21 x 21 pixels, 2.2 arcmin
const BASE = import.meta.env.BASE_URL;

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
  hide: "M2 8s2.2-4 6-4 6 4 6 4-2.2 4-6 4-6-4-6-4zM2.5 2.5l11 11",
  exit: "M6 2.5v3.5H2.5M10 2.5v3.5h3.5M6 13.5V10H2.5M10 13.5V10h3.5",
  layers: "M8 2.5l5.5 3-5.5 3-5.5-3zM2.5 8.5l5.5 3 5.5-3",
};

function MiniSpectrum({ query }: { query: Props["spectrumQuery"] }) {
  const [state, setState] = useState<{ kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; data: Brightness }>({ kind: "loading" });
  useEffect(() => {
    const ctrl = new AbortController();
    setState({ kind: "loading" });
    fetchBrightness(query.ra, query.dec, query.target, ctrl.signal)
      .then((data) => setState({ kind: "ready", data }))
      .catch((err) => { if (err.name !== "AbortError") setState({ kind: "error", message: err.message ?? "No spectrum here." }); });
    return () => ctrl.abort();
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
  const [view, setView] = useState<MapView>(() => openingView(size, { w: innerWidth, h: innerHeight }));
  const [hud, setHud] = useState<"shown" | "faded" | "hidden">("shown");
  const [tab, setTab] = useState<"pixels" | "spectrum">("pixels");
  const [layers, setLayers] = useState(false);
  const [showPredicted, setShowPredicted] = useState(true);
  const [readout, setReadout] = useState<string | null>(null);
  const drag = useRef<{ id: number; x: number; y: number } | null>(null);
  const pinch = useRef<Map<number, { x: number; y: number }>>(new Map());
  const wasFull = useRef(false);

  // viewport size, and back to the opening view when the stack changes size
  useEffect(() => {
    const onResize = () => setVp({ w: innerWidth, h: innerHeight });
    addEventListener("resize", onResize);
    return () => removeEventListener("resize", onResize);
  }, []);
  useEffect(() => setView(openingView(size, vp)), [size]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => setView((v) => clampView(v, size, vp)), [vp, size]);

  // browser full screen when allowed; leaving it leaves the sky view
  useEffect(() => {
    const el = rootRef.current;
    el?.requestFullscreen?.().then(() => { wasFull.current = true; }).catch(() => undefined);
    const onChange = () => { if (!document.fullscreenElement && wasFull.current) p.onExit(); };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const exit = useCallback(() => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined);
    p.onExit();
  }, [p]);

  // the data window: the same pixels as the void view
  useEffect(() => {
    const c = windowRef.current;
    if (!c || !p.frames.length) return;
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
  }, [p.frames, p.epoch, p.mode, p.limits, p.invert, size, tab]);

  // the smoked glass: the mean of the epochs mirrored outward; static, never blinks
  useEffect(() => {
    const c = glassRef.current;
    if (!c || !p.frames.length) return;
    const tile = new ImageData(size, size);
    renderFrame(mean(p.frames), size, tile, { limits: p.limits, softening: 10, invert: p.invert });
    const span = mapSpan(size);
    c.width = span;
    c.height = span;
    c.getContext("2d")!.putImageData(new ImageData(mirrorTiles(tile.data, size, REACH), span, span), 0, 0);
  }, [p.frames, p.limits, p.invert, size]);

  // the HUD fades while the sky plays and comes back on any input
  useEffect(() => {
    const calm = matchMedia("(prefers-reduced-motion: reduce)").matches || matchMedia("(prefers-contrast: more)").matches;
    let timer = 0;
    const wake = () => {
      setHud((h) => (h === "faded" ? "shown" : h));
      clearTimeout(timer);
      if (p.playing && !calm) timer = window.setTimeout(() => setHud((h) => (h === "shown" ? "faded" : h)), 2600);
    };
    wake();
    const events = ["pointermove", "pointerdown", "keydown", "wheel", "touchstart"] as const;
    events.forEach((e) => addEventListener(e, wake, { passive: true }));
    return () => { clearTimeout(timer); events.forEach((e) => removeEventListener(e, wake)); };
  }, [p.playing]);

  // keys that only the sky view knows
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      const mid = { x: vp.w / 2, y: vp.h / 2 };
      if (e.key === "Escape" || e.key === "f" || e.key === "F") { e.preventDefault(); exit(); }
      else if (e.key === "+" || e.key === "=") setView((v) => zoomAt(v, 1.4, mid.x, mid.y, size, vp));
      else if (e.key === "-" || e.key === "_") setView((v) => zoomAt(v, 1 / 1.4, mid.x, mid.y, size, vp));
      else if (e.key === "0") setView(openingView(size, vp));
      else if (e.key === "h" || e.key === "H") setHud((h) => (h === "hidden" ? "shown" : "hidden"));
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [vp, size, exit]);

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
    pinch.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
  }
  function onPointerMove(e: React.PointerEvent) {
    const pts = pinch.current;
    if (pts.has(e.pointerId)) {
      const prev = pts.get(e.pointerId)!;
      if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        const before = Math.hypot(a.x - b.x, a.y - b.y);
        pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
        const [c, d] = [...pts.values()];
        const after = Math.hypot(c.x - d.x, c.y - d.y);
        if (before > 0) setView((v) => zoomAt(v, after / before, (c.x + d.x) / 2, (c.y + d.y) / 2, size, vp));
        return;
      }
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (drag.current?.id === e.pointerId) {
        const dx = e.clientX - prev.x;
        const dy = e.clientY - prev.y;
        setView((v) => clampView({ ...v, tx: v.tx + dx, ty: v.ty + dy }, size, vp));
      }
    }
    const hit = screenToWindow(view, size, e.clientX, e.clientY);
    if (!hit) {
      setReadout("Outside the data · reflection only, no values");
    } else {
      const row = size - 1 - hit.rowScreen;
      const sky = gridToSky(hit.col, row, p.center, size, p.pixelArcsec);
      const v = p.mode === "blink" ? p.frames[Math.min(p.epoch, p.frames.length - 1)]?.[row * size + hit.col] : NaN;
      setReadout(`${formatSexagesimal(sky.ra, sky.dec)}${Number.isFinite(v) ? ` · ${v.toFixed(2)} MJy/sr` : ""}`);
    }
  }
  function onPointerUp(e: React.PointerEvent) {
    pinch.current.delete(e.pointerId);
    if (drag.current?.id === e.pointerId) drag.current = null;
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
    return { gap, pred, gaia: (p.gaia ?? []).map((g) => ({ ...g, ...toS(g) })), r: Math.max(7, 1.5 * view.s) };
  }, [p.predicted, p.gaia, showPredicted, view, size]);

  const zoomButton = (factor: number, label: string, icon: string) => (
    <button type="button" className="hud-icon" onClick={() => setView((v) => zoomAt(v, factor, vp.w / 2, vp.h / 2, size, vp))} aria-label={label} title={label}>
      <Icon d={icon} label={label} />
    </button>
  );
  const compare = (
    <div className="hud-group" role="group" aria-label="Compare">
      <span className="eyebrow">Compare</span>
      {(["blink", "diff", "sum"] as const).map((m) => (
        <button key={m} type="button" className="opt" aria-pressed={p.mode === m} onClick={() => p.onMode(m)}>
          <span className="dot" />{m === "blink" ? "Blink" : m === "diff" ? "Difference" : "Sum"}
        </button>
      ))}
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
      <div className="hud-group" role="group" aria-label="Overlays">
        <span className="eyebrow">Overlays</span>
        {p.predicted && (
          <button type="button" className="opt" aria-pressed={showPredicted} onClick={() => setShowPredicted((s) => !s)}>
            <svg width="10" height="10" aria-hidden="true"><path d="M0 5h3M7 5h3M5 0v3M5 7v3" stroke="var(--red-text)" strokeWidth="1.4" /></svg>Predicted
          </button>
        )}
        <button type="button" className="opt" aria-pressed={p.gaia !== null} onClick={p.onGaia}>
          <svg width="10" height="10" aria-hidden="true"><circle cx="5" cy="5" r="4" fill="none" stroke="var(--ice)" strokeWidth="1.2" /></svg>Gaia DR3
        </button>
      </div>
    </>
  );

  return (
    <div ref={rootRef} className={`sky hud-${hud}`} role="dialog" aria-modal="true" aria-label={`Full-screen sky view of ${p.title}`}>
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
          <canvas ref={glassRef} className={`sky-glass${p.mode === "diff" ? " dim" : ""}`} style={{ width: mapSpan(size), height: mapSpan(size) }} aria-hidden="true" />
          <canvas ref={windowRef} className="sky-window" style={{ left: REACH * size, top: REACH * size, width: size, height: size, imageRendering: sharp ? "pixelated" : "auto" }} aria-hidden="true" />
        </div>
        <div className="sky-frame" style={{ left: win.x, top: win.y, width: winSize, height: winSize }} aria-hidden="true" />
        <p className="sky-label mono" style={{ left: win.x, top: win.y - 22 }}>{p.windowLabel}</p>
        <svg className="sky-marks" width={vp.w} height={vp.h} aria-hidden="true">
          <defs>
            <clipPath id="sky-window-clip"><rect x={win.x} y={win.y} width={winSize} height={winSize} /></clipPath>
          </defs>
          <g clipPath="url(#sky-window-clip)">
            {marks.gaia.map((g) => (
              <circle key={g.id} cx={g.x} cy={g.y} r={marks.r} fill="none" stroke="var(--ice)" strokeWidth={g.fast ? 1.4 : 1} opacity={g.fast ? 0.95 : 0.6} />
            ))}
            {marks.pred && (
              <g stroke="var(--red-text)" strokeLinecap="round" fill="none">
                <polyline points={marks.pred.pts.map((q) => `${q.x},${q.y}`).join(" ")} strokeWidth={1.2} strokeDasharray="4 4" />
                {[[-1, 0], [1, 0], [0, -1], [0, 1]].map(([dx, dy], i) => (
                  <line key={i} x1={marks.pred!.now.x + dx * marks.gap} y1={marks.pred!.now.y + dy * marks.gap} x2={marks.pred!.now.x + dx * (marks.gap + 9)} y2={marks.pred!.now.y + dy * (marks.gap + 9)} strokeWidth={1.8} />
                ))}
              </g>
            )}
          </g>
        </svg>
      </div>

      {/* HUD: glass widgets at the edges, never over the target */}
      <header className="hud hud-tl">
        <img src={`${BASE}brand/sedna-wordmark-on-dark.svg`} width={120} height={28} alt="SEDNA" />
        <strong>{p.title}</strong>
        <span className="mono">{formatSexagesimal(p.center.ra, p.center.dec)}  {Math.round(fov.w)}′ × {Math.round(fov.h)}′ in view</span>
      </header>
      <p className="hud hud-caption mono">
        <span className="now">{p.caption[0]}</span> {p.caption.slice(1).join(" · ")}
      </p>

      <nav className="hud hud-tr" aria-label="View">
        {zoomButton(1 / 1.4, "Zoom out", ICONS.minus)}
        <span className="mono hud-zoom" aria-live="polite">{view.s.toFixed(1)}×</span>
        {zoomButton(1.4, "Zoom in", ICONS.plus)}
        <button type="button" className="hud-icon wide-only" onClick={() => setView(openingView(size, vp))} aria-label="Back to the target" title="Back to the target (0)"><Icon d={ICONS.target} label="Back to the target" /></button>
        <button type="button" className="hud-icon wide-only" onClick={p.onCopyLink} aria-label="Copy link" title="Copy link"><Icon d={ICONS.link} label="Copy link" /></button>
        <button type="button" className="hud-icon wide-only" onClick={() => setHud("hidden")} aria-label="Hide the controls" title="Hide the controls (H)"><Icon d={ICONS.hide} label="Hide the controls" /></button>
        <button type="button" className="hud-icon narrow-only" onClick={() => setLayers((l) => !l)} aria-expanded={layers} aria-label="Layers" title="Layers"><Icon d={ICONS.layers} label="Layers" /></button>
        <button type="button" className="hud-icon" onClick={exit} aria-label="Leave full screen" title="Leave full screen (Esc)"><Icon d={ICONS.exit} label="Leave full screen" /></button>
      </nav>

      <aside className="hud hud-right">{layersPanel}</aside>
      <aside className="hud hud-left">{compare}</aside>
      {layers && <div className="hud hud-sheet">{compare}{layersPanel}</div>}

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
        <p className="mono hud-readout">{readout ?? "Drag to pan · wheel to zoom · 0 to recentre"}</p>
      </footer>

      <div className="hud hud-bc" role="group" aria-label="Visits">
        <button type="button" className="play" onClick={p.onPlay} aria-label={p.playing ? "Pause" : "Play"} disabled={p.mode !== "blink" || p.frames.length < 2}>
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

      {hud === "hidden" && (
        <button type="button" className="hud-restore" onClick={() => setHud("shown")}>Show controls</button>
      )}
    </div>
  );
}
