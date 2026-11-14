// Brightness lens: how one point's brightness changed over time, and its spectrum, from single exposures.
// Opens under the sky (never over it). Charts follow the chart skill: points with error bars, honest axes.
// Code written with AI assistance (Claude); see AI_USAGE.md.
import { useEffect, useMemo, useState } from "react";
import { ErrorBar, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from "recharts";
import { ApiError } from "./lib/api";
import {
  changeRows,
  defaultSpectrumBin,
  detectorColor,
  fetchBrightness,
  lightCurveSeries,
  monthLabel,
  spectrumBins,
  spectrumPoints,
  summary,
  toCsv,
  type Brightness,
  type CurvePoint,
  type SpectrumPoint,
} from "./lib/brightness";
import { formatSexagesimal } from "./lib/coords";

type Props = { ra: number; dec: number; target: string | null; label: string; onClose: () => void };

const AXIS = { stroke: "var(--line-strong)", tick: { fill: "var(--muted)", fontSize: 11, fontFamily: "var(--font-data)" }, tickLine: false } as const;

function Dot(props: { cx?: number; cy?: number; payload?: { det: number; reliable?: boolean } }) {
  const { cx, cy, payload } = props;
  if (cx === undefined || cy === undefined || !payload) return null;
  const color = detectorColor(payload.det);
  const hollow = payload.reliable === false;
  return <circle cx={cx} cy={cy} r={hollow ? 2.6 : 2.2} fill={hollow ? "none" : color} stroke={color} strokeWidth={hollow ? 1 : 0} />;
}

function CurveTip({ active, payload }: { active?: boolean; payload?: { payload: CurvePoint }[] }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="chart-tip mono">
      <div>D{p.det} · {monthLabel(p.t)}</div>
      <div>{p.y >= 0 ? "+" : "−"}{Math.abs(p.y).toFixed(2)} ± {p.err.toFixed(2)} mag</div>
      <div>{p.channels} channels · {p.exposures} exposures{p.reliable ? "" : " · few channels"}</div>
    </div>
  );
}

function SpectrumTip({ active, payload }: { active?: boolean; payload?: { payload: SpectrumPoint }[] }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="chart-tip mono">
      <div>{p.x.toFixed(3)} µm (±{(p.bandwidth / 2).toFixed(3)}) · D{p.det}</div>
      <div>{Math.round(p.y).toLocaleString("en")} ± {Math.round(p.err).toLocaleString("en")} µJy</div>
      <div>{p.date}{p.saturated ? ` · ${p.saturated} saturated core px` : ""}</div>
    </div>
  );
}

export default function BrightnessPanel({ ra, dec, target, label, onClose }: Props) {
  const [state, setState] = useState<{ kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; data: Brightness }>({ kind: "loading" });
  const [bin, setBin] = useState<number | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    setState({ kind: "loading" });
    fetchBrightness(ra, dec, target, ctrl.signal)
      .then((data) => {
        setState({ kind: "ready", data });
        setBin(defaultSpectrumBin(data));
      })
      .catch((err) => {
        if (err.name === "AbortError") return;
        setState({ kind: "error", message: err instanceof ApiError ? err.message : "The brightness could not be measured here." });
      });
    return () => ctrl.abort();
  }, [ra, dec, target]);

  const data = state.kind === "ready" ? state.data : null;
  const series = useMemo(() => (data ? lightCurveSeries(data) : []), [data]);
  const bins = useMemo(() => (data ? spectrumBins(data) : []), [data]);
  const spectrum = useMemo(() => (data && bin !== null ? spectrumPoints(data, bin) : []), [data, bin]);
  const rows = useMemo(() => (data ? changeRows(data) : []), [data]);
  const csvUrl = useMemo(() => (data ? URL.createObjectURL(new Blob([toCsv(data)], { type: "text/csv" })) : null), [data]);
  useEffect(() => () => { if (csvUrl) URL.revokeObjectURL(csvUrl); }, [csvUrl]);

  const times = series.flatMap((s) => s.points.map((p) => p.t));
  const tDomain: [number, number] = times.length ? [Math.min(...times) - 15 * 86400000, Math.max(...times) + 15 * 86400000] : [0, 1];
  const fluxes = spectrum.map((p) => p.y);
  const logY = fluxes.length > 0 && Math.max(...fluxes) / Math.max(Math.min(...fluxes), 1e-9) > 20;
  const yDomain: [number, number] = fluxes.length ? (logY ? [Math.min(...fluxes) * 0.6, Math.max(...fluxes) * 1.6] : [0, Math.max(...fluxes) * 1.15]) : [0, 1];
  const currentBin = bins.find((b) => b.index === bin);

  return (
    <section className="lens" aria-label={`Brightness of ${label}`}>
      <div className="lens-head">
        <span className="eyebrow">Brightness</span>
        <span className="mono">{label === "this point" ? formatSexagesimal(ra, dec) : label}</span>
        <button type="button" className="text" onClick={onClose}>Close</button>
      </div>

      {state.kind === "loading" && <p className="note-line" role="status">Measuring this point in every SPHEREx exposure. This takes 5 to 20 seconds the first time.</p>}
      {state.kind === "error" && <p className="note-line error" role="alert">{state.message}</p>}

      {data && (
        <>
          <p className="lens-summary">{summary(data)}</p>

          <h3 className="lens-title">Change over time <span>magnitudes, each wavelength compared only with itself · brighter is up</span></h3>
          {series.length ? (
            <div className="chart" role="img" aria-label={`Change in brightness over time per detector. ${summary(data)}`}>
              <ResponsiveContainer width="100%" height={200}>
                <ScatterChart margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                  <ReferenceLine y={0} stroke="var(--line-strong)" strokeDasharray="2 3" ifOverflow="extendDomain" />
                  <XAxis type="number" dataKey="t" domain={tDomain} tickFormatter={monthLabel} {...AXIS} tickCount={6} />
                  <YAxis type="number" dataKey="y" reversed width={44} {...AXIS} tickFormatter={(v: number) => (v > 0 ? `+${v.toFixed(1)}` : v.toFixed(1))} />
                  <Tooltip content={<CurveTip />} cursor={false} isAnimationActive={false} />
                  {series.map((s) => (
                    <Scatter key={s.detector} name={`D${s.detector}`} data={s.points} shape={<Dot />} isAnimationActive={false}>
                      <ErrorBar dataKey="err" direction="y" width={0} stroke={detectorColor(s.detector)} strokeWidth={1} />
                    </Scatter>
                  ))}
                </ScatterChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="note-line">Not enough repeated exposures at the same wavelength yet.</p>
          )}
          <ul className="chart-legend" aria-label="Detectors">
            {series.map((s) => (
              <li key={s.detector}>
                <i style={{ background: detectorColor(s.detector) }} />
                <span className="mono">D{s.detector}</span> <span className="mono sub">{s.rangeUm[0].toFixed(2)}–{s.rangeUm[1].toFixed(2)} µm</span>
              </li>
            ))}
            {series.some((s) => s.points.some((p) => !p.reliable)) && <li><i className="hollow" /> fewer than 3 channels compared</li>}
          </ul>

          <h3 className="lens-title">Spectrum <span>{data.method === "wing" ? "not shown for saturated stars" : currentBin ? `${currentBin.label} · ${spectrum.length} exposures, one point each` : ""}</span></h3>
          {data.method === "wing" ? (
            <p className="note-line">A spectrum drawn from the wings of a saturated star would have the wrong shape, so none is shown.</p>
          ) : (
          <>
          {bins.length > 1 && (
            <div className="chips wrap" role="group" aria-label="Dates of the spectrum">
              {bins.slice(0, 12).map((b) => (
                <button key={b.index} type="button" className="opt mono" aria-pressed={b.index === bin} onClick={() => setBin(b.index)}>
                  {bins.length > 4 ? b.start.slice(0, 10) : b.start.slice(0, 7)}
                </button>
              ))}
            </div>
          )}
          {spectrum.length ? (
            <div className="chart" role="img" aria-label={`Spectrum from ${spectrum.length} exposures between ${spectrum[0].x.toFixed(2)} and ${spectrum[spectrum.length - 1].x.toFixed(2)} micrometres.`}>
              <ResponsiveContainer width="100%" height={210}>
                <ScatterChart margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                  <XAxis type="number" dataKey="x" domain={[0.7, 5.1]} ticks={[1, 2, 3, 4, 5]} tickFormatter={(v: number) => `${v} µm`} {...AXIS} />
                  <YAxis
                    type="number"
                    dataKey="y"
                    scale={logY ? "log" : "linear"}
                    domain={yDomain}
                    allowDataOverflow
                    width={56}
                    {...AXIS}
                    tickFormatter={(v: number) => (v >= 1e6 ? `${(v / 1e6).toFixed(v >= 1e7 ? 0 : 1)} Jy` : v >= 1e3 ? `${(v / 1e3).toFixed(v >= 1e4 ? 0 : 1)} mJy` : `${Math.round(v)} µJy`)}
                  />
                  <Tooltip content={<SpectrumTip />} cursor={false} isAnimationActive={false} />
                  {[1, 2, 3, 4, 5, 6].map((det) => (
                    <Scatter key={det} data={spectrum.filter((p) => p.det === det)} shape={<Dot />} isAnimationActive={false}>
                      <ErrorBar dataKey="err" direction="y" width={0} stroke={detectorColor(det)} strokeWidth={1} />
                    </Scatter>
                  ))}
                </ScatterChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="note-line">No date has enough exposures for a spectrum here yet.</p>
          )}
          </>
          )}

          <p className="note-line">
            {data.methodNote} {data.exposuresMeasured} of {data.exposuresAvailable} exposures measured{logY ? "; flux on a log scale" : ""}.
          </p>
          <details className="lens-data">
            <summary>Show data</summary>
            <table>
              <caption className="sr">Change in brightness per detector</caption>
              <thead>
                <tr><th>Detector</th><th>Wavelength</th><th>Dates compared</th><th>First to last</th><th>Full range</th></tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.detector}>
                    <td className="mono">D{r.detector}</td>
                    <td className="mono">{r.rangeUm[0].toFixed(2)}–{r.rangeUm[1].toFixed(2)} µm</td>
                    <td className="mono">{r.bins}</td>
                    <td className="mono">{r.firstToLast === null ? "—" : `${r.firstToLast > 0 ? "+" : "−"}${Math.abs(r.firstToLast).toFixed(2)} ± ${(r.firstToLastErr ?? 0).toFixed(2)} mag`}</td>
                    <td className="mono">{r.peakToPeak.toFixed(2)} mag</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {csvUrl && <a className="text" href={csvUrl} download={`sedna-brightness-${ra.toFixed(4)}_${dec.toFixed(4)}.csv`}>Download every exposure (CSV)</a>}
          </details>
        </>
      )}
    </section>
  );
}
