// The card for a clicked Gaia star: its usual name and nature from SIMBAD, its Gaia motion, and links out.
// Code written with AI assistance (Claude); see AI_USAGE.md.
import { useEffect, useState } from "react";
import type { GaiaSource } from "./lib/api";
import { fallbackLinks, fetchStar, starFacts, starName, type Star } from "./lib/star";

type Props = { star: GaiaSource; shiftPx: number };

export default function StarCard({ star, shiftPx }: Props) {
  const [state, setState] = useState<{ kind: "loading" } | { kind: "error" } | { kind: "ready"; data: Star }>({ kind: "loading" });
  useEffect(() => {
    let live = true;
    setState({ kind: "loading" });
    fetchStar(star.id)
      .then((data) => live && setState({ kind: "ready", data }))
      .catch(() => live && setState({ kind: "error" }));
    return () => { live = false; };
  }, [star.id]);

  const data = state.kind === "ready" ? state.data : null;
  const name = data ? starName(data) : null;
  const facts = data?.found ? starFacts(data) : [];
  const links = data?.links ?? fallbackLinks(star.id);
  const motion = Math.hypot(star.pmRa ?? 0, star.pmDec ?? 0) / 1000;

  return (
    <section className="star-card" role="status" aria-live="polite" aria-busy={state.kind === "loading"}>
      <p className="star-title">
        <strong className="ice">Known star</strong>
        {state.kind === "loading" ? <span className="skeleton-line short" aria-hidden="true" /> : name ? <span className="star-name">{name}</span> : null}
      </p>
      {state.kind === "loading" ? (
        <span className="skeleton-line" aria-label="Asking SIMBAD what this star is" />
      ) : facts.length ? (
        <p className="star-facts">{facts.join(" · ")}</p>
      ) : data && !data.available ? (
        <p className="star-facts muted">SIMBAD did not answer, so only the Gaia record is shown. The links may still open.</p>
      ) : data && !data.found ? (
        <p className="star-facts muted">Not in SIMBAD: Gaia DR3 is its only catalogue entry, as for most stars this faint.</p>
      ) : state.kind === "error" ? (
        <p className="star-facts muted">Its SIMBAD record could not be fetched here; the links may still open.</p>
      ) : null}
      <p className="star-gaia mono">
        Gaia DR3 {star.id} · G {star.g?.toFixed(1) ?? "?"} · {motion.toFixed(motion < 0.1 ? 3 : 2)}″ a year, about {shiftPx.toFixed(2)} pixel over the dates shown
      </p>
      {data?.designations && data.designations.length > 0 && <p className="star-ids mono">Also {data.designations.join(" · ")}</p>}
      <p className="star-links">
        {/* SIMBAD only when it has the star: its page for an unknown identifier is an error page */}
        {data?.found && <a href={links.simbad} target="_blank" rel="noopener">{name ? `${name} in SIMBAD` : "SIMBAD"} ↗<span className="sr"> (opens in new tab)</span></a>}
        <a href={links.gaia} target="_blank" rel="noopener">Gaia DR3 record ↗<span className="sr"> (opens in new tab)</span></a>
        {data?.source && <span className="star-source">{data.source}</span>}
      </p>
    </section>
  );
}
