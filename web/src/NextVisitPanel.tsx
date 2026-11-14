// The last step of the distance focus: predict where the body will be at the next visit, and look for it there.
// Code written with AI assistance (Claude); see AI_USAGE.md.
import { useEffect, useRef, useState } from "react";
import { ApiError } from "./lib/api";
import { skyToGrid } from "./lib/coords";
import { crop, fetchNextVisit, nextVisitSummary, type NextVisit, type NextVisitQuery } from "./lib/prediction";
import { renderFrame } from "./lib/render";

const LIMITS = { lo: -0.5, hi: 4 };
const ZOOM_HALF = 12; // 25 x 25 pixels, 2.6 arcmin

function Crop({ img, label }: { img: Float32Array; label: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const n = 2 * ZOOM_HALF + 1;
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    c.width = n;
    c.height = n;
    const ctx = c.getContext("2d")!;
    const out = ctx.createImageData(n, n);
    renderFrame(img, n, out, { limits: LIMITS, softening: 4, invert: false });
    ctx.putImageData(out, 0, 0);
  }, [img, n]);
  return (
    <figure className="zoom">
      <div className="zoom-frame">
        <canvas ref={ref} />
        <svg viewBox={`0 0 ${n} ${n}`} aria-hidden="true">
          <g stroke="var(--red-text)" strokeWidth={0.18} strokeLinecap="round">
            <line x1={ZOOM_HALF + 0.5 - 4} y1={ZOOM_HALF + 0.5} x2={ZOOM_HALF + 0.5 - 2} y2={ZOOM_HALF + 0.5} />
            <line x1={ZOOM_HALF + 0.5 + 2} y1={ZOOM_HALF + 0.5} x2={ZOOM_HALF + 0.5 + 4} y2={ZOOM_HALF + 0.5} />
            <line x1={ZOOM_HALF + 0.5} y1={ZOOM_HALF + 0.5 - 4} x2={ZOOM_HALF + 0.5} y2={ZOOM_HALF + 0.5 - 2} />
            <line x1={ZOOM_HALF + 0.5} y1={ZOOM_HALF + 0.5 + 2} x2={ZOOM_HALF + 0.5} y2={ZOOM_HALF + 0.5 + 4} />
          </g>
        </svg>
      </div>
      <figcaption>{label}</figcaption>
    </figure>
  );
}

export default function NextVisitPanel({ query, name }: { query: NextVisitQuery; name: string }) {
  const [state, setState] = useState<{ kind: "idle" } | { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; data: NextVisit }>({ kind: "idle" });
  const [follow, setFollow] = useState(true);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const queryKey = JSON.stringify(query);

  useEffect(() => setState({ kind: "idle" }), [queryKey]);

  function run() {
    setState({ kind: "loading" });
    fetchNextVisit(query)
      .then((data) => setState({ kind: "ready", data }))
      .catch((err) => setState({ kind: "error", message: err instanceof ApiError ? err.message : "The next visit could not be checked." }));
  }

  const data = state.kind === "ready" ? state.data : null;
  const size = data?.grid?.size ?? 1;
  useEffect(() => {
    const canvas = canvasRef.current;
    const img = data ? (follow ? data.tracked : data.static) : null;
    if (!canvas || !img) return;
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    const out = ctx.createImageData(size, size);
    renderFrame(img, size, out, { limits: LIMITS, softening: 4, invert: false });
    ctx.putImageData(out, 0, 0);
  }, [data, follow, size]);

  const toSvg = (ra: number, dec: number) => {
    const p = skyToGrid(ra, dec, data!.grid!.center, size, data!.grid!.pixelScaleArcsec);
    return { x: p.x + 0.5, y: size - 1 - p.y + 0.5 };
  };
  const ticks = (x: number, y: number, r1: number, r2: number) =>
    [[-r2, 0, -r1, 0], [r1, 0, r2, 0], [0, -r2, 0, -r1], [0, r1, 0, r2]].map(([a, b, c, d], i) => <line key={i} x1={x + a} y1={y + b} x2={x + c} y2={y + d} />);

  return (
    <div className="next-visit">
      <h3 className="lens-title">Next visit <span>predict where it will be months later, then look</span></h3>
      {state.kind === "idle" && (
        <div className="focus-actions">
          <button type="button" className="text ice" onClick={run}>Predict the next visit and look for {name}</button>
        </div>
      )}
      {state.kind === "loading" && <p className="note-line" role="status">Predicting the position and reading the next visit&rsquo;s exposures. This takes about 10 seconds the first time.</p>}
      {state.kind === "error" && <p className="note-line error" role="alert">{state.message}</p>}
      {data && (
        <>
          <p>
            <span className={`chip ${data.status === "found" ? "clear" : data.status === "not_found" ? "uncertain" : ""}`}>
              {data.status === "found" ? "Found again" : data.status === "not_found" ? "Not found" : "Not observed yet"}
            </span>{" "}
            {nextVisitSummary(data)}
          </p>
          {data.grid && data.tracked && data.static && data.found && (() => {
            const p = skyToGrid(data.found.ra, data.found.dec, data.grid.center, size, data.grid.pixelScaleArcsec);
            return (
              <div className="zooms" role="group" aria-label="Close-up of the detection">
                <Crop img={crop(data.tracked, size, p.x, p.y, ZOOM_HALF)} label={`Following at ${data.distanceAu} au: a sharp point`} />
                <Crop img={crop(data.static, size, p.x, p.y, ZOOM_HALF)} label="Fixed on the sky: fainter and smeared" />
              </div>
            );
          })()}
          {data.grid && data.tracked && (
            <>
              <div className="stage small" role="img" aria-label={`The predicted region in the next visit, ${follow ? `followed at ${data.distanceAu} au` : "fixed on the sky"}. ${nextVisitSummary(data)}`}>
                <canvas ref={canvasRef} />
                <svg viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
                  <polyline
                    points={data.arc.map((p) => { const s = toSvg(p.ra, p.dec); return `${s.x},${s.y}`; }).join(" ")}
                    fill="none" stroke="var(--ice)" strokeWidth={1.6} strokeDasharray="5 4"
                  />
                  {data.predicted && (() => { const p = toSvg(data.predicted.ra, data.predicted.dec); return <g stroke="var(--fg)" strokeWidth={1.6}>{ticks(p.x, p.y, 5, 12)}</g>; })()}
                  {data.truth && (() => { const t = toSvg(data.truth.ra, data.truth.dec); return <circle cx={t.x} cy={t.y} r={11} fill="none" stroke="var(--ice)" strokeWidth={1.6} />; })()}
                  {data.found && (() => { const f = toSvg(data.found.ra, data.found.dec); return <g stroke="var(--red-text)" strokeWidth={2} strokeLinecap="round">{ticks(f.x, f.y, 5, 13)}</g>; })()}
                </svg>
              </div>
              <div className="focus-actions">
                <div className="chips" role="group" aria-label="Stack">
                  <button type="button" className="opt" aria-pressed={follow} onClick={() => setFollow(true)}><span className="dot" />Following at {data.distanceAu} au</button>
                  <button type="button" className="opt" aria-pressed={!follow} onClick={() => setFollow(false)}><span className="dot" />Fixed on the sky</button>
                </div>
              </div>
              <ul className="chart-legend" aria-label="Marks">
                <li><svg width="16" height="8" aria-hidden="true"><line x1="0" y1="4" x2="16" y2="4" stroke="var(--ice)" strokeDasharray="3 3" /></svg>predicted positions for ±{Math.round(data.spread * 100)}% in distance</li>
                <li><svg width="10" height="10" aria-hidden="true"><path d="M0 5h3M7 5h3M5 0v3M5 7v3" stroke="var(--fg)" /></svg>prediction at {data.distanceAu} au</li>
                {data.found && <li><svg width="10" height="10" aria-hidden="true"><path d="M0 5h3M7 5h3M5 0v3M5 7v3" stroke="var(--red-text)" /></svg>found</li>}
                {data.truth && <li><i className="hollow ice" />JPL Horizons</li>}
              </ul>
              <p className="note-line">
                {data.window ? `${data.window.exposures} exposures from ${data.window.start.slice(0, 10)} to ${data.window.end.slice(0, 10)}, ${Math.round((data.grid.size * data.grid.pixelScaleArcsec) / 60)}′ across. ` : ""}
                {data.method}
              </p>
            </>
          )}
        </>
      )}
    </div>
  );
}
