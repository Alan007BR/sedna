// The start page: one screen, no scroll on a desktop. The real SPHEREx sky behind, a dwarf planet crossing
// a field in single exposures, the search, the five challenge targets and the missions. The brand intro
// (Arrival) plays once a session; the Orbital mark covers the wait while a distant body's field is found.
// Code written with AI assistance (Claude); see AI_USAGE.md.
import { useEffect, useMemo, useState } from "react";
import { BrandLockup, OrbitalLoader } from "./Brand";
import type { Target } from "./lib/api";
import { filmTicks, frameHold, INTRO_LEAVE_MS, INTRO_TIMING, introPlan, KIND_LABEL, LANDING_FILM, MISSION_CARDS, SEDNA_CARD, spritePosition, TARGET_CARDS, type IntroVariant } from "./lib/landing";
import type { Mission } from "./lib/missions";
import type { Active } from "./lib/transport";

type Props = {
  targets: Target[];
  missions: Mission[];
  source: Active | null;
  exposures: number | null;
  input: string;
  onInput: (value: string) => void;
  inputError: string | null;
  lookup: string | null;
  onSubmit: (e: React.FormEvent) => void;
  onTarget: (t: Target) => void;
  onMission: (m: Mission) => void;
  opening: string | null;
  onCancelOpening: () => void;
};

const BASE = import.meta.env.BASE_URL;
const SEEN_KEY = "sedna-intro-seen";
const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
function introSeen(): boolean {
  try { return sessionStorage.getItem(SEEN_KEY) === "1"; } catch { return false; }
}
function markIntroSeen() {
  try { sessionStorage.setItem(SEEN_KEY, "1"); } catch { /* private mode: it may play again, that is all */ }
}
const dayLabel = (iso: string) => new Date(iso.replace(" ", "T")).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export default function Landing(p: Props) {
  const reduced = useMemo(reducedMotion, []);
  const [intro, setIntro] = useState<{ variant: IntroVariant; leaving: boolean } | null>(() => {
    const variant = introPlan({ reducedMotion: reducedMotion(), seen: introSeen(), param: new URLSearchParams(location.search).get("intro") });
    return variant ? { variant, leaving: false } : null;
  });

  useEffect(() => {
    if (!intro) return;
    markIntroSeen();
    const t = setTimeout(() => setIntro((i) => (!i ? i : i.leaving ? null : { ...i, leaving: true })), intro.leaving ? INTRO_LEAVE_MS : INTRO_TIMING[intro.variant]);
    return () => clearTimeout(t);
  }, [intro]);
  const skip = () => setIntro((i) => (i && !i.leaving ? { ...i, leaving: true } : i));
  useEffect(() => {
    if (!intro || intro.leaving) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") skip(); };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [intro]);

  const cards = Object.keys(TARGET_CARDS)
    .map((id) => p.targets.find((t) => t.id === id))
    .filter((t): t is Target => !!t);
  const sedna = p.targets.find((t) => t.id === "sedna");
  const help = p.inputError ?? (p.lookup ? `Looking up "${p.lookup}" in SIMBAD…` : p.source === "demo" ? (
    <>
      <span className="long">Running on prepared cases: typed coordinates need the live service.</span>
      <span className="short">Running on prepared cases only.</span>
    </>
  ) : "Any object's name (M42, Betelgeuse), or RA Dec in degrees or hh:mm:ss ±dd:mm:ss");

  return (
    <div className={`landing${intro && !intro.leaving ? " hold" : ""}`}>
      <div className="landing-sky" aria-hidden="true">
        <div className="landing-sky-img" style={{ backgroundImage: `url(${BASE}landing/sky-barnard-30.jpg)` }} />
        <div className="landing-sky-fade" />
      </div>

      <header className="landing-top rise d1">
        <a className="brand" href={BASE} aria-label="SEDNA, start page">
          <img src={`${BASE}brand/sedna-horizontal-on-dark.svg`} width={184} height={46} alt="SEDNA" />
        </a>
        <div className="landing-nav">
          <span className="mono landing-bg-note">Behind this page: 30′ of sky around Barnard&rsquo;s Star, SPHEREx detectors 1–6 in false colour</span>
          {!reduced && (
            <button type="button" className="text mono" onClick={() => setIntro({ variant: "arrival", leaving: false })}>
              Replay intro
            </button>
          )}
        </div>
      </header>

      <main className="landing-hero">
        <div className="landing-copy">
          <p className="mono landing-eyebrow rise d1">Explore the unseen</p>
          <h1 className="rise d2">Watch the infrared sky change.</h1>
          <p className="landing-lede rise d3">
            <span className="long">SEDNA turns NASA SPHEREx&rsquo;s repeated all-sky images into short films. Anything that moved or changed stands out, and you can measure it: how fast, how far, how bright.</span>
            <span className="short">NASA SPHEREx&rsquo;s all-sky images as short films: whatever moved or changed stands out.</span>
          </p>
          <form className="landing-search rise d4" role="search" onSubmit={p.onSubmit}>
            <label htmlFor="landing-input" className="mono landing-label">Find any place in the sky</label>
            <div className="landing-field">
              <input
                id="landing-input"
                value={p.input}
                onChange={(e) => p.onInput(e.target.value)}
                placeholder="Name or RA Dec"
                autoComplete="off"
                spellCheck={false}
                aria-invalid={p.inputError ? true : undefined}
                aria-describedby="landing-help"
              />
              <button type="submit">Load sky</button>
            </div>
            <p id="landing-help" className={`mono landing-help${p.inputError ? " error" : ""}`} role={p.source === "demo" || p.lookup ? "status" : undefined} aria-live="polite">{help}</p>
          </form>

          <section className="landing-targets rise d5" aria-labelledby="targets-title">
            <div className="landing-row-head">
              <h2 id="targets-title" className="mono">The challenge targets</h2>
              <span className="mono">Each one opens in a click</span>
            </div>
            <ul>
              {cards.map((t) => (
                <li key={t.id}>
                  <button type="button" className="target-card" onClick={() => p.onTarget(t)}>
                    <img src={`${BASE}${TARGET_CARDS[t.id].image}`} alt="" width={288} height={112} />
                    <span className={`mono kind ${t.kind}`} aria-hidden="true">{KIND_LABEL[t.kind] ?? t.kind}</span>
                    <strong>{t.name}</strong>
                    <span className="sr"> ({KIND_LABEL[t.kind] ?? t.kind})</span>
                    <span className="fact">{TARGET_CARDS[t.id].fact}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>

          {p.exposures !== null && (
            <p className="mono landing-facts rise d6">
              <span>0.75–5 µm</span> in 102 colours · <span>the whole sky</span> twice a year · <span>{p.exposures.toLocaleString("en")}</span> exposures indexed
            </p>
          )}
        </div>

        <LandingFilm reduced={reduced} />
      </main>

      <section className="landing-band rise d6" aria-labelledby="missions-title">
        <div className="landing-row-head">
          <h2 id="missions-title" className="mono">Start with a one-minute mission</h2>
          <span className="mono credits">Data: NASA SPHEREx via IRSA · ESA Gaia DR3 · IMCCE SkyBoT · Logo and animations made with AI assistance</span>
        </div>
        <ul className="landing-missions">
          {p.missions.map((m, i) => (
            <li key={m.id}>
              <button type="button" className="mission-card" onClick={() => p.onMission(m)} disabled={!p.targets.length}>
                <img src={`${BASE}${MISSION_CARDS[m.id]?.image}`} alt="" width={288} height={288} />
                <span className="mission-text">
                  <span className="mono num">Mission {i + 1}</span>
                  <strong>{m.title}</strong>
                  <span className="desc">{MISSION_CARDS[m.id]?.text ?? m.teaser}</span>
                </span>
              </button>
            </li>
          ))}
          {sedna && (
            <li>
              <button type="button" className="mission-card namesake" onClick={() => p.onTarget(sedna)}>
                <img src={`${BASE}${SEDNA_CARD.image}`} alt="" width={294} height={294} />
                <span className="mission-text">
                  <span className="mono num">Our namesake</span>
                  <strong>{SEDNA_CARD.title}</strong>
                  <span className="desc">{SEDNA_CARD.text}</span>
                </span>
              </button>
            </li>
          )}
        </ul>
      </section>

      {p.opening && (
        <div className="landing-opening">
          <OrbitalLoader size={148}>
            Opening {p.opening}
            <span className="mono">Finding where it was when SPHEREx looked</span>
          </OrbitalLoader>
          <button type="button" className="ghost" onClick={p.onCancelOpening}>Back to the start page</button>
        </div>
      )}

      {intro && (
        <div className={`intro ${intro.variant}${intro.leaving ? " leaving" : ""}`}>
          <BrandLockup className={intro.variant} />
          <button type="button" className="intro-skip mono" onClick={skip}>Skip intro</button>
        </div>
      )}
    </div>
  );
}

/** Makemake crossing a 6′ field: one single SPHEREx exposure per pass, hard cuts, the same stretch for all. */
function LandingFilm({ reduced }: { reduced: boolean }) {
  const film = LANDING_FILM;
  const n = film.frames.length;
  const [i, setI] = useState(reduced ? Math.floor(n / 2) : 2);
  const [playing, setPlaying] = useState(!reduced);
  useEffect(() => {
    if (!playing) return;
    const t = setTimeout(() => setI((k) => (k + 1) % n), frameHold(i, n));
    return () => clearTimeout(t);
  }, [playing, i, n]);
  const ticks = useMemo(() => filmTicks(film.frames), [film.frames]);
  const frame = film.frames[i];
  const first = film.frames[0];
  const last = film.frames[n - 1];
  const days = Math.round(last.mjd - first.mjd);

  return (
    <figure className="landing-film reveal" aria-label={`${film.body} crossing a SPHEREx field`}>
      <div className="mono film-head">
        <span className="film-id">
          <span className="ice">{film.number} {film.body}</span>
          <span className="film-sep"> · </span>
          <span>{film.distanceAu.toFixed(1)} au · V {film.vMag}</span>
        </span>
        <span className="film-orient">{Math.round(film.fovArcmin)}′ · N up, E left</span>
      </div>
      <div className="film-wrap">
        <div
          className="film"
          role="img"
          aria-label={`${n} single SPHEREx exposures of a ${Math.round(film.fovArcmin)} arcminute field, ${dayLabel(first.date)} to ${dayLabel(last.date)}. ${film.body}, circled, moves while the stars stay fixed.`}
          style={{ backgroundImage: `url(${BASE}${film.sprite})`, backgroundSize: `${n * 100}% 100%`, backgroundPosition: spritePosition(i, n) }}
        />
        <span className="corner tl" aria-hidden="true" />
        <span className="corner tr" aria-hidden="true" />
        <span className="corner bl" aria-hidden="true" />
        <span className="corner br" aria-hidden="true" />
      </div>
      <button type="button" className="play film-play" onClick={() => setPlaying((v) => !v)} aria-label={playing ? "Pause the film" : "Play the film"}>
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
          {playing ? <path d="M3 2h2.6v10H3zM8.4 2H11v10H8.4z" fill="currentColor" /> : <path d="M4 2l8 5-8 5z" fill="currentColor" />}
        </svg>
      </button>
      <div className="film-track" role="group" aria-label="Passes">
        {film.frames.map((f, k) => (
          <button
            key={f.obsid}
            type="button"
            className={`film-tick${k === i ? " on" : k < i ? " past" : ""}`}
            style={{ left: `${ticks[k]}%` }}
            aria-label={`Show the exposure of ${f.date}`}
            aria-current={k === i}
            onClick={() => { setPlaying(false); setI(k); }}
          >
            <span />
          </button>
        ))}
      </div>
      <div className="mono film-dates">
        <span className="end">{dayLabel(first.date)}</span>
        <span className="now">
          <span className="day">{frame.date.slice(0, 10)}</span> <span>{frame.date.slice(11)} · detector {frame.detector}</span> <span className="count">· {i + 1}/{n}</span>
        </span>
        <span className="end">{dayLabel(last.date).replace(/ \d{4}$/, "")}</span>
      </div>
      <figcaption>
        <span className="long">{n} SPHEREx passes over {days} days, one exposure each, one stretch for all. The ring is where IMCCE SkyBoT puts {film.body}; the dot inside it is SPHEREx seeing it.</span>
        <span className="short">Ring: where {film.body} should be. Dot: SPHEREx seeing it.</span>
      </figcaption>
    </figure>
  );
}
