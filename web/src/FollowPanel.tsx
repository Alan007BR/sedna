// Find Sedna: the world this tool is named after, invisible in one exposure, visible when SPHEREx's
// exposures are stacked along its orbit. Shows the result, its control and its limit.
// Code written with AI assistance (Claude); see AI_USAGE.md.
import { useEffect, useMemo, useState } from "react";
import { ApiError } from "./lib/api";
import { fetchFollow, followSummary, noiseLimits, visitLabel, type Follow } from "./lib/follow";
import Stamp from "./Stamp";

type Props = { body: string; onDistance: () => void };

export default function FollowPanel({ body, onDistance }: Props) {
  const [state, setState] = useState<{ kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; data: Follow }>({ kind: "loading" });

  useEffect(() => {
    const ctrl = new AbortController();
    setState({ kind: "loading" });
    fetchFollow(body, ctrl.signal)
      .then((data) => setState({ kind: "ready", data }))
      .catch((err) => {
        if (err.name !== "AbortError") setState({ kind: "error", message: err instanceof ApiError ? err.message : "The stack along the orbit could not be loaded." });
      });
    return () => ctrl.abort();
  }, [body]);

  const data = state.kind === "ready" ? state.data : null;
  const n = data?.stampSize ?? 21;
  const lim = useMemo(() => {
    if (!data) return null;
    const of = (img: Float32Array | null) => (img ? noiseLimits(img, n) : { lo: -1, hi: 1 });
    return { single: of(data.single?.image ?? null), combined: of(data.combined.image), visits: data.visits.map((v) => of(v.image)) };
  }, [data, n]);

  return (
    <section className="stage-wrap focus follow">
      <div className="focus-intro">
        <span className="eyebrow">The namesake</span>
        <h2>Find Sedna</h2>
        <p>
          90377 Sedna was found on 14 November 2003 by comparing pictures of the same patch of sky taken hours apart: one faint point had moved. It orbits far beyond Neptune
          {data ? `, ${data.distanceAu} au from us, and shines at magnitude ${data.vMag ?? "?"}` : ""}: about thirty times fainter than Makemake. SEDNA is named after it. Can SPHEREx see it?
        </p>
      </div>

      {state.kind === "loading" && <p className="note-line" role="status">Stacking every SPHEREx exposure along Sedna&rsquo;s orbit…</p>}
      {state.kind === "error" && <p className="note-line error" role="alert">{state.message}</p>}

      {data && lim && (
        <>
          <div className="zooms" role="group" aria-label="One exposure against all of them">
            {data.single && (
              <Stamp img={data.single.image} size={n} limits={lim.single} label={`One exposure (D${data.single.detector}, ${data.single.date.slice(0, 10)}): S/N ${data.single.snr.toFixed(1)}`} width={200} />
            )}
            {data.combined.image && (
              <Stamp img={data.combined.image} size={n} limits={lim.combined} label={`${data.combined.exposures} exposures along its orbit: S/N ${data.combined.snr.toFixed(1)}`} width={200} />
            )}
          </div>
          <p className="lens-summary">{followSummary(data)}</p>

          <h3 className="lens-title">Visit by visit <span>{data.wavelengthUm[0]}–{data.wavelengthUm[1]} µm, where its reflected sunlight is strongest</span></h3>
          <div className="zooms visits" role="group" aria-label="Each visit on its own">
            {data.visits.map((v, i) =>
              v.image ? <Stamp key={v.label} img={v.image} size={n} limits={lim.visits[i]} label={visitLabel(v)} width={120} /> : null,
            )}
          </div>
          <p>
            Each visit shows it faintly on its own, in a different part of the sky as Sedna moves, and the three agree. A typical single exposure reaches S/N {data.single?.medianSnr.toFixed(1) ?? "?"}:
            only {data.combined.exposures} of them together lift it out of the noise.
          </p>
          <p className="note-line">
            Each square is {Math.round((n * data.pixelScaleArcsec) / 60 * 10) / 10}′ across, centred where JPL Horizons puts Sedna, and shown against its own noise. This works because Horizons says where to look.
            A body this faint and still unknown has to be found by its motion first, which the distance focus does for brighter ones; a hypothetical Planet Nine is expected to be fainter still in
            reflected light. {data.method}
          </p>
          <div className="focus-actions">
            <button type="button" className="text ice" onClick={onDistance}>See how the distance focus finds a body by its motion</button>
          </div>
        </>
      )}
    </section>
  );
}
