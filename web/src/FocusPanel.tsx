// The distance focus, told in three steps: watch a point walk among the stars,
// turn one knob until it snaps into focus, then check the distance against JPL Horizons.
// Code written with AI assistance (Claude); see AI_USAGE.md.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { OrbitalLoader } from "./Brand";
import { ApiError, fetchFocus, fetchFocusAt, type Focus, type Target } from "./lib/api";
import { renderFrame } from "./lib/render";
import NextVisitPanel from "./NextVisitPanel";

export type FocusStep = "watch" | "focus" | "check";
type Step = FocusStep;
type Props = {
  body: Target | null;
  seed: { ra: number; dec: number; mjd: number } | null;
  controls: Target[];
  onOpen: (t: Target) => void;
  onProgress?: (p: { step: FocusStep; revealed: boolean }) => void; // for guided missions
  header?: ReactNode; // shown above the steps, e.g. a mission coach
};

const CONFIDENCE = { clear: "Clear focus", uncertain: "Uncertain focus", none: "No focus" } as const;
const STEPS: { id: Step; label: string }[] = [
  { id: "watch", label: "1 · Watch" },
  { id: "focus", label: "2 · Focus" },
  { id: "check", label: "3 · Check" },
];
const FILM_LIMITS = { lo: -0.8, hi: 12 };

export default function FocusPanel({ body, seed, controls, onOpen, onProgress, header }: Props) {
  const [visit, setVisit] = useState(0);
  const [data, setData] = useState<Focus | null>(null);
  const [status, setStatus] = useState<{ kind: "idle" | "loading" | "ready" | "error"; message?: string }>({ kind: "idle" });
  const [step, setStep] = useState<Step>("watch");
  const [di, setDi] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(true);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sweep = useRef<number | null>(null);

  useEffect(() => setVisit(0), [body?.id]);
  useEffect(() => onProgress?.({ step, revealed }), [step, revealed, onProgress]);

  useEffect(() => {
    if (!body && !seed) return;
    const ctrl = new AbortController();
    setStatus({ kind: "loading" });
    setData(null);
    (body ? fetchFocus(body.id, visit, ctrl.signal) : fetchFocusAt(seed!, ctrl.signal))
      .then((f) => {
        setData(f);
        setDi(f.distancesAu.length - 1); // the knob starts at infinity: fixed stars, no body in sight
        setRevealed(false);
        setStep("watch");
        setFrame(0);
        setPlaying(!matchMedia("(prefers-reduced-motion: reduce)").matches);
        setStatus({ kind: "ready" });
      })
      .catch((err) => {
        if (err.name === "AbortError") return;
        setStatus({ kind: "error", message: err instanceof ApiError ? err.message : "The distance focus could not be computed." });
      });
    return () => ctrl.abort();
  }, [body, seed, visit]);

  const film = data ? (step === "check" ? data.film.follow : data.film.static) : [];
  const isFilm = step !== "focus";

  // film playback
  useEffect(() => {
    if (!isFilm || !playing || film.length < 2) return;
    const id = setInterval(() => setFrame((f) => (f + 1) % film.length), 220);
    return () => clearInterval(id);
  }, [isFilm, playing, film.length]);

  const stackLimits = useMemo(() => {
    if (!data) return null;
    const best = data.stacks[data.best];
    let hi = 10;
    for (let i = 0; i < best.length; i++) if (best[i] > hi) hi = best[i];
    return { lo: -0.4, hi };
  }, [data]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !data || !stackLimits) return;
    const size = data.stampSize;
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    const out = ctx.createImageData(size, size);
    if (isFilm) renderFrame(film[Math.min(frame, film.length - 1)], size, out, { limits: FILM_LIMITS, softening: 4, invert: false });
    else renderFrame(data.stacks[di], size, out, { limits: stackLimits, softening: 3, invert: false });
    ctx.putImageData(out, 0, 0);
  }, [data, di, stackLimits, isFilm, film, frame]);

  useEffect(() => () => { if (sweep.current) cancelAnimationFrame(sweep.current); }, []);

  function snap() {
    if (!data) return;
    setRevealed(true);
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return setDi(data.best);
    const from = di;
    const t0 = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - t0) / 1400);
      setDi(Math.round(from + (data.best - from) * (1 - Math.pow(1 - t, 3))));
      if (t < 1) sweep.current = requestAnimationFrame(tick);
    };
    sweep.current = requestAnimationFrame(tick);
  }

  function go(next: Step) {
    setStep(next);
    setFrame(0);
    setPlaying(!matchMedia("(prefers-reduced-motion: reduce)").matches);
  }

  const label = body?.name ?? "the point you picked";
  if (!body && !seed) {
    return (
      <section className="stage-wrap focus">
        <div className="focus-intro">
          <h2>Focus the sky by distance</h2>
          <p>
            A world in the outer Solar System does not creep like a nearby star. Between two SPHEREx visits it jumps right out of the frame, so comparing images of fixed coordinates only shows a point
            that was there and then was not.
          </p>
          <p>How it moves from day to day depends almost entirely on how far away it is. SEDNA turns that distance into a focus knob. Try it on a world whose distance is known:</p>
          <ul className="examples">
            {controls.map((t) => (
              <li key={t.id}>
                <button type="button" onClick={() => onOpen(t)}>
                  <strong>{t.name}</strong>
                  <span>{t.note}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </section>
    );
  }

  const n = data?.distancesAu.length ?? 0;
  const trial = data?.distancesAu[di] ?? null;
  const maxScore = data ? Math.max(...data.scores.slice(0, -1).map((s) => s ?? 0), 1) : 1;
  const xOf = (i: number) => (i / Math.max(1, n - 2)) * 100;
  let trueIndex = 0;
  if (data) {
    let closest = Infinity;
    data.distancesAu.forEach((d, i) => {
      if (d === null) return;
      const gap = Math.abs(Math.log(d / (data.trueDistanceAu ?? 1e12)));
      if (gap < closest) {
        closest = gap;
        trueIndex = i;
      }
    });
  }
  const truth = data?.trueDistanceAu ?? null;
  const offPercent = data && truth ? Math.round((Math.abs(data.bestDistanceAu - truth) / truth) * 100) : 0;
  const ready = status.kind === "ready" && data;
  const frameDate = data && isFilm ? data.film.dates[Math.min(frame, data.film.dates.length - 1)] : null;

  return (
    <section className="stage-wrap focus">
      {header}
      <div className="steps" role="tablist" aria-label="Steps">
        {STEPS.map((s) => (
          <button key={s.id} type="button" role="tab" className="opt" aria-selected={step === s.id} aria-pressed={step === s.id} disabled={!ready || (s.id === "check" && !revealed)} onClick={() => go(s.id)}>
            <span className="dot" />
            {s.label}
          </button>
        ))}
      </div>

      <div className="caption mono">
        {data ? (
          <>
            <span className="now">{body?.name ?? "Picked point"}</span>
            <span>
              {isFilm ? `exposure ${Math.min(frame, film.length - 1) + 1} of ${film.length}` : `${data.exposures} exposures stacked`} · detectors {data.detectors[0]}–{data.detectors[data.detectors.length - 1]}
            </span>
            <span>{frameDate ? frameDate.slice(0, 16) : `${data.spanDays} days`}</span>
          </>
        ) : (
          <span>&nbsp;</span>
        )}
      </div>

      <div className="stage" role="img" aria-label={isFilm ? "Single SPHEREx exposures shown in sequence" : trial ? `Stack shifted for ${trial} astronomical units` : "Stack with no shift"}>
        {status.kind === "loading" && <div className="stage-msg"><OrbitalLoader>Reading single exposures and stacking them for 73 trial distances…</OrbitalLoader></div>}
        {status.kind === "error" && <p className="stage-msg error" role="alert">{status.message}</p>}
        <canvas ref={canvasRef} hidden={!ready} />
        {ready && (
          <svg viewBox={`0 0 ${data.stampSize} ${data.stampSize}`} aria-hidden="true">
            <g stroke="var(--red-text)" strokeLinecap="round" strokeWidth={0.16} transform={`translate(${data.stampSize / 2} ${data.stampSize / 2})`}>
              <line x1={-4.6} y1={0} x2={-2.6} y2={0} /><line x1={2.6} y1={0} x2={4.6} y2={0} />
              <line x1={0} y1={-4.6} x2={0} y2={-2.6} /><line x1={0} y1={2.6} x2={0} y2={4.6} />
            </g>
          </svg>
        )}
      </div>

      {ready && step === "watch" && (
        <div className="focus-result">
          <p>
            <strong>The stars stay put. One point walks.</strong> These are {film.length} single SPHEREx exposures of the same patch of sky, taken over {data.spanDays} days. The cross marks where
            {" "}{label} was {body ? "in the first one" : "when you picked it"}. A star would not move at all in a few days; anything that walks is inside our Solar System.
          </p>
          <p className="note-line">Months later it is degrees away, far outside this frame. Comparing fixed coordinates would only show a point that vanished.</p>
          <div className="focus-actions">
            <button type="button" className="text" onClick={() => setPlaying((p) => !p)}>{playing ? "Pause" : "Play"}</button>
            <button type="button" className="primary" onClick={() => go("focus")}>Measure its distance</button>
          </div>
        </div>
      )}

      {ready && step === "focus" && (
        <>
          <div className="focus-controls">
            <div className="focus-readout">
              <span className="eyebrow">Trial distance from SPHEREx</span>
              <span className="focus-value mono">{trial === null ? "∞" : trial.toFixed(1)}<small>{trial === null ? " fixed stars" : " au"}</small></span>
            </div>
            <div className="focus-knob">
              <svg className="focus-curve" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true">
                <polyline
                  points={data.scores.slice(0, -1).map((s, i) => `${xOf(i)},${28 - 26 * Math.max(0, (s ?? 0) / maxScore)}`).join(" ")}
                  fill="none" stroke="var(--muted-strong)" strokeWidth={0.6} vectorEffect="non-scaling-stroke"
                />
                {revealed && truth !== null && <line x1={xOf(trueIndex)} y1={0} x2={xOf(trueIndex)} y2={30} stroke="var(--ice)" strokeWidth={1} strokeDasharray="2 2" vectorEffect="non-scaling-stroke" />}
                {di < n - 1 && <line x1={xOf(di)} y1={0} x2={xOf(di)} y2={30} stroke="var(--red-text)" strokeWidth={1.4} vectorEffect="non-scaling-stroke" />}
              </svg>
              <label htmlFor="focus-range" className="sr">Trial distance from SPHEREx, from 25 astronomical units to infinity</label>
              <input
                id="focus-range" type="range" min={0} max={n - 1} step={1} value={di}
                onChange={(e) => {
                  const next = Number(e.target.value);
                  setDi(next);
                  if (Math.abs(next - data.best) <= 1) setRevealed(true);
                }}
              />
              <div className="focus-scale mono"><span>25 au</span><span>100</span><span>600</span><span>∞</span></div>
              <p className="mode-help focus-unit">1 au is the distance from the Earth to the Sun, about 150 million km. Neptune is at 30 au.</p>
            </div>
            <button type="button" className="primary" onClick={snap}>Find the focus</button>
          </div>
          <div className="focus-result">
            {!revealed ? (
              <p>
                <strong>Now all {data.exposures} exposures are added together.</strong> With no shift the stars are sharp and {label} is smeared away. Each position of the knob shifts every exposure
                the way a body at that distance would have moved. Turn it toward smaller distances until a point appears at the cross.
              </p>
            ) : (
              <>
                <p>
                  <span className={`chip ${data.confidence}`}>{CONFIDENCE[data.confidence]}</span>{" "}
                  {data.confidence === "none" ? data.confidenceReason : (
                    <>The stack is sharpest at <strong className="mono">{data.bestDistanceAu} au</strong> <span className="mono">({data.halfRangeAu[0]}–{data.halfRangeAu[1]})</span>. That is how far away this body is.</>
                  )}
                </p>
                <div className="focus-actions">
                  <button type="button" className="primary" onClick={() => go("check")}>Check the answer</button>
                </div>
              </>
            )}
          </div>
        </>
      )}

      {ready && step === "check" && (
        <div className="focus-result">
          <p>
            {data.confidence === "none" ? (
              <><span className="chip none">No focus</span> {data.confidenceReason}</>
            ) : truth !== null ? (
              <>SEDNA measured <strong className="mono">{data.bestDistanceAu} au</strong>. JPL Horizons gives <strong className="mono ice">{truth} au</strong> for {label} on that date:{" "}
              <strong>{offPercent}% apart</strong>, from {data.spanDays} days of SPHEREx images and one assumption.</>
            ) : (
              <>SEDNA measures <strong className="mono">{data.bestDistanceAu} au</strong> <span className="mono">({data.halfRangeAu[0]}–{data.halfRangeAu[1]})</span> for {label}, from {data.spanDays} days of SPHEREx images and one assumption.</>
            )}
          </p>
          {data.known && (
            <p>
              <span className={`chip ${data.known.status === "known" ? "clear" : ""}`}>{data.known.status === "known" ? "Known object" : data.known.status === "none" ? "Not in the catalogue" : "Check unavailable"}</span>{" "}
              {data.known.status === "known" ? (
                <>This is <strong>{data.known.name}</strong> ({data.known.class}, V = {data.known.vMag}), {Number(data.known.separationArcsec).toFixed(1)}″ from the point you picked. {data.known.message}</>
              ) : data.known.status === "none" ? (
                <>{data.known.message} With a clear focus, that makes it a candidate worth a second look, not a discovery.</>
              ) : (
                data.known.message
              )}
            </p>
          )}
          <p>
            <strong>The same exposures, now following a body at {data.bestDistanceAu} au.</strong> {body?.name ?? "The point"} stays on the cross and the stars walk past: the reverse of step 1.
          </p>
          <p className="note-line">{data.assumption}</p>
          <div className="focus-actions">
            <button type="button" className="text" onClick={() => setPlaying((p) => !p)}>{playing ? "Pause" : "Play"}</button>
            {data.visits > 1 && (
              <div className="chips" role="group" aria-label="Visit">
                <span className="eyebrow">Try another visit</span>
                {Array.from({ length: data.visits }, (_, v) => (
                  <button key={v} type="button" className="opt mono" aria-pressed={visit === v} onClick={() => setVisit(v)}>{v + 1}</button>
                ))}
              </div>
            )}
          </div>
          {data.confidence !== "none" && (
            <NextVisitPanel
              name={body?.name ?? "the point"}
              query={body ? { body: body.id, visit: data.visit } : { ra: data.seed.ra, dec: data.seed.dec, mjd: data.seed.mjd, distance: data.bestDistanceAu }}
            />
          )}
        </div>
      )}
    </section>
  );
}
