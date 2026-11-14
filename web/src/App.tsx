// SEDNA: type coordinates, watch the SPHEREx sky change over time.
// Code written with AI assistance (Claude); see AI_USAGE.md.
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import FilmPanel, { type Seed } from "./FilmPanel";
import FocusPanel, { type FocusStep } from "./FocusPanel";
import FollowPanel from "./FollowPanel";
import MissionCoach from "./MissionCoach";
import MoversNote, { type MoversState } from "./MoversNote";
import RulerPanel, { RulerMarks, type RulerState } from "./RulerPanel";
import { ApiError, fetchFocus, fetchGaia, fetchHealth, fetchStack, fetchTargets, type GaiaSource, type Stack, type Target } from "./lib/api";
import { formatSexagesimal, gridToSky, mjdToYear, parseTarget, skyToGrid } from "./lib/coords";
import { advance, missionById, MISSIONS, type Mission, type MissionContext } from "./lib/missions";
import { fetchMovers } from "./lib/movers";
import { fetchRuler } from "./lib/prediction";
import { onSourceChange, type Active } from "./lib/transport";
import { paintStack, sharedLimits, type ViewMode } from "./lib/render";
import SkyView from "./SkyView";
import StarCard from "./StarCard";

type Mode = "blink" | "diff" | "sum" | "film" | "focus" | "follow";
const MODES: { id: Mode; label: string }[] = [
  { id: "blink", label: "Blink" },
  { id: "diff", label: "Difference" },
  { id: "sum", label: "Sum" },
  { id: "film", label: "Single exposures" },
  { id: "focus", label: "Distance focus" },
];
// fv: single-exposure visit (0-based; 1-based in the URL); ft: open the single exposures at this MJD
// bp: brightness lens on a built-in target id, or on a point "ra,dec"; mission: guided mission id; ruler: parallax ruler on
type View = { ra: number; dec: number; fov: number; det: number; mode: Mode; target: string | null; gaia: boolean; invert: boolean; fps: number; fv: number; ft: number | null; bp: string | null; mission: string | null; ruler: boolean; sky: boolean };
const VIEW_DEFAULTS = { fov: 6, det: 2, mode: "blink" as Mode, gaia: true, invert: false, fps: 2, fv: 0, ft: null, bp: null, mission: null, ruler: false, sky: false };

// from the pipeline's wavelength maps (service/sedna/archive/wavelength.py), rounded outward
const DETECTORS = [
  { id: 1, range: "0.73–1.13 µm" },
  { id: 2, range: "1.08–1.67 µm" },
  { id: 3, range: "1.61–2.44 µm" },
  { id: 4, range: "2.39–3.87 µm" },
  { id: 5, range: "3.79–4.45 µm" },
  { id: 6, range: "4.40–5.03 µm" },
];
// the brightness lens brings the chart library; load it only when someone opens the lens
const BrightnessPanel = lazy(() => import("./BrightnessPanel"));
const FOVS = [4, 6, 10, 15];
// the embed shell: /embed/ (or ?embed=1) shows only the sky, a minimal timeline and a link back
const IS_EMBED = /\/embed\/?$/.test(location.pathname) || new URLSearchParams(location.search).get("embed") === "1";

function readView(): View | null {
  const p = new URLSearchParams(location.search);
  const ra = Number(p.get("ra"));
  const dec = Number(p.get("dec"));
  if (!p.has("ra") || !p.has("dec") || !Number.isFinite(ra) || !Number.isFinite(dec) || ra < 0 || ra >= 360 || Math.abs(dec) > 90) return null;
  const fov = FOVS.includes(Number(p.get("fov"))) ? Number(p.get("fov")) : 6;
  const det = Number(p.get("band")) >= 1 && Number(p.get("band")) <= 6 ? Number(p.get("band")) : 2;
  const mode = MODES.some((m) => m.id === p.get("mode")) || p.get("mode") === "follow" ? (p.get("mode") as Mode) : "blink";
  const fv = Math.max(0, Math.min(20, Math.round(Number(p.get("visit")) || 1) - 1));
  const ft = p.has("t") && Number.isFinite(Number(p.get("t"))) ? Number(p.get("t")) : null;
  return { ra, dec, fov, det, mode, target: p.get("target"), gaia: p.get("gaia") !== "0", invert: p.get("invert") === "1", fps: Number(p.get("speed")) || 2, fv, ft, bp: p.get("bright"), mission: missionById(p.get("mission"))?.id ?? null, ruler: p.get("ruler") === "1", sky: p.get("view") === "sky" };
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
  if (v.bp) p.set("bright", v.bp);
  if (v.mission) p.set("mission", v.mission);
  if (v.ruler) p.set("ruler", "1");
  if (v.sky) p.set("view", "sky");
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
  const [source, setSource] = useState<Active | null>(null);
  const [copied, setCopied] = useState<"link" | "embed" | null>(null);
  useEffect(() => onSourceChange(setSource), []);
  const [seed, setSeed] = useState<Seed | null>(null);
  const [movers, setMovers] = useState<MoversState>({ kind: "loading" });
  const [clickSky, setClickSky] = useState<{ ra: number; dec: number; star: boolean } | null>(null);
  const [missionStep, setMissionStep] = useState(0);
  const [ruler, setRuler] = useState<RulerState>({ kind: "loading" });
  // visits shown in Blink, tied to one loaded stack and detector so a new target never inherits them
  const [stackGen, setStackGen] = useState(0);
  const [seen, setSeen] = useState<{ key: string; visits: Set<number> }>({ key: "", visits: new Set() });
  const [focusProgress, setFocusProgress] = useState<{ step: FocusStep; revealed: boolean } | null>(null);
  const onFocusProgress = useCallback((p: { step: FocusStep; revealed: boolean }) => setFocusProgress(p), []);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [stagePx, setStagePx] = useState(560);
  const stageObserver = useRef<ResizeObserver | null>(null);
  const stageRef = useCallback((el: HTMLDivElement | null) => {
    stageObserver.current?.disconnect();
    if (!el) return;
    stageObserver.current = new ResizeObserver(([entry]) => setStagePx(entry.contentRect.width || 560));
    stageObserver.current.observe(el);
  }, []);

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
  // following Sedna needs no field stack: it shows its own stamps
  const queryKey = view && view.mode !== "follow" ? `${view.ra.toFixed(5)}|${view.dec.toFixed(5)}|${view.fov}` : "";
  useEffect(() => {
    if (!view || !queryKey) return;
    const ctrl = new AbortController();
    setStatus({ kind: "loading" });
    setStack(null);
    setGaia([]);
    setInput((cur) => cur || (targets.find((t) => t.id === view.target)?.name ?? `${view.ra.toFixed(5)} ${view.dec.toFixed(5)}`));
    setPicked(null);
    setClickSky(null);
    fetchStack(view.ra, view.dec, view.fov, ctrl.signal)
      .then((s) => {
        setStack(s);
        setStackGen((g) => g + 1);
        setStatus({ kind: "ready" });
        setEpoch(0);
        if (IS_EMBED && !matchMedia("(prefers-reduced-motion: reduce)").matches) setPlaying(true);
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
  useEffect(() => {
    if (target && view && input === `${view.ra.toFixed(5)} ${view.dec.toFixed(5)}`) setInput(target.name);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);
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

  // the pixels on screen; the sky view paints the same ones
  const frameImages = useMemo(() => frames.map((f) => f.image), [frames]);
  const viewMode: ViewMode = view?.mode === "diff" || view?.mode === "sum" ? view.mode : "blink";
  const canSky = !!view;

  // draw
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !stack || !view || !frames.length || !limits) return;
    const size = stack.grid.size;
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    const out = ctx.createImageData(size, size);
    paintStack(frameImages, epoch, viewMode, size, out, limits, view.invert);
    ctx.putImageData(out, 0, 0);
  }, [stack, view, frameImages, limits, epoch, viewMode]);

  const viewSky = !!view?.sky;
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
      else if ((e.key === "f" || e.key === "F") && canSky && !viewSky) update({ sky: true }, true);
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [frames.length, update, canSky, viewSky]);

  function go(ra: number, dec: number, targetId: string | null, extra: Partial<View> = {}) {
    const base = view ?? VIEW_DEFAULTS;
    const next: View = { ...base, mode: base.mode === "focus" ? "blink" : base.mode, ra, dec, target: targetId, fv: 0, ft: null, bp: null, mission: null, ...extra };
    writeView(next, true);
    setView(next);
    setInputError(null);
  }

  async function openTarget(t: Target, extra: Partial<View> = {}) {
    setInput(t.name);
    if (t.kind === "follow") {
      const next: View = { ...(view ?? VIEW_DEFAULTS), ra: t.ra, dec: t.dec, target: t.id, mode: "follow", fv: 0, ft: null, bp: null, mission: null, ruler: false, ...extra };
      writeView(next, true);
      setView(next);
      setInputError(null);
      return;
    }
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
      const next: View = { ...(view ?? VIEW_DEFAULTS), ra, dec, target: t.id, mode: "focus", fv: 0, ft: null, bp: null, mission: null, ...extra };
      writeView(next, true);
      setView(next);
      setInputError(null);
      return;
    }
    // centre on the catalogue position moved to mid-2025 so fast movers stay in the field
    const years = 2025.9 - t.epoch;
    const dec = t.dec + ((t.pmDec ?? 0) * years) / 3600;
    const ra = t.ra + ((t.pmRa ?? 0) * years) / 3600 / Math.cos((t.dec * Math.PI) / 180);
    go(ra, dec, t.id, { ...(t.id === "wise0855" ? { det: 6 } : {}), ...extra });
  }

  function startMission(m: Mission) {
    const t = targets.find((x) => x.id === m.target);
    if (!t) return;
    setMissionStep(0);
    setFocusProgress(null);
    setInput(t.name);
    openTarget(t, { mode: m.start.mode, det: m.start.det, fov: m.start.fov, mission: m.id });
  }

  function copy(what: "link" | "embed", text: string) {
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(what);
      setTimeout(() => setCopied(null), 1600);
    }).catch(() => undefined);
  }

  function embedCode() {
    const p = new URLSearchParams(location.search);
    ["mission", "bright", "ruler", "visit", "t"].forEach((k) => p.delete(k));
    if (p.get("mode") === "focus" || p.get("mode") === "film") p.set("mode", "blink");
    p.set("gaia", "0");
    const src = `${location.origin}${import.meta.env.BASE_URL}embed/?${p}`;
    const label = view ? `SEDNA: SPHEREx sky at RA ${view.ra.toFixed(4)}, Dec ${view.dec.toFixed(4)}` : "SEDNA";
    return `<iframe src="${src}" width="400" height="300" style="border:0" title="${label}" loading="lazy"></iframe>`;
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
    if (pick) pickAt(col, rowScreen);
  }

  /** A click on the sky: the Gaia star under it, if any, and the point to measure. ``rowScreen`` counts from the top. */
  function pickAt(col: number, rowScreen: number) {
    if (!stack) return;
    const row = size - 1 - rowScreen;
    {
      const near = gaiaMarks
        .map((m) => ({ m, d: Math.hypot(m.x - (col + 0.5), m.y - (rowScreen + 0.5)) }))
        .sort((a, b) => a.d - b.d)[0];
      const star = near && near.d < 2 ? near.m : null;
      setPicked(star ? star.s : null);
      // measure on the Gaia star when one is under the pointer, otherwise on the pixel's centre
      if (star) {
        const pos = propagate(star.s.ra, star.s.dec, (star.s.pmRa ?? 0) / 1000, (star.s.pmDec ?? 0) / 1000, 2016.0, yearNow);
        setClickSky({ ra: pos.ra, dec: pos.dec, star: true });
      } else {
        const c = gridToSky(col, row, stack.center, size, scale);
        setClickSky({ ra: c.ra, dec: c.dec, star: false });
      }
    }
  }

  // guided missions: which visits have been shown in Blink on this detector, and where the person is
  const seenKey = stack && status.kind === "ready" ? `${stackGen}|${view?.det}` : "";
  useEffect(() => {
    if (!seenKey || view?.mode !== "blink" || !frames.length) return;
    setSeen((s) => (s.key !== seenKey ? { key: seenKey, visits: new Set([epoch]) } : s.visits.has(epoch) ? s : { key: s.key, visits: new Set(s.visits).add(epoch) }));
  }, [epoch, view?.mode, frames.length, seenKey]);
  const mission = missionById(view?.mission ?? null);
  const missionContext = useMemo<MissionContext>(
    () => ({
      mode: view?.mode ?? "blink",
      det: view?.det ?? 2,
      target: view?.target ?? null,
      seenAllVisits: seenKey !== "" && seen.key === seenKey && frames.length >= 2 && frames.every((_, i) => seen.visits.has(i)),
      pickedMotionArcsecYr: picked ? Math.hypot(picked.pmRa ?? 0, picked.pmDec ?? 0) / 1000 : null,
      focusStep: focusProgress?.step ?? null,
      focusRevealed: focusProgress?.revealed ?? false,
    }),
    [view?.mode, view?.det, view?.target, frames, seen, seenKey, picked, focusProgress],
  );
  useEffect(() => {
    if (mission) setMissionStep((s) => advance(mission, s, missionContext));
  }, [mission, missionContext]);
  const coach = mission ? (
    <MissionCoach mission={mission} step={missionStep} onAction={(patch) => update(patch, true)} onNext={startMission} onExit={() => update({ mission: null }, true)} />
  ) : null;

  // parallax ruler: from the visit on screen to the next one (Blink), or first to last (Difference, Sum)
  const rulerPair = useMemo(() => {
    if (!stack || frames.length < 2 || !view) return null;
    const i = Math.min(epoch, frames.length - 1);
    const [a, b] = view.mode === "blink" ? (i < frames.length - 1 ? [i, i + 1] : [i - 1, i]) : [0, frames.length - 1];
    const va = stack.visits.find((v) => v.index === frames[a].visit);
    const vb = stack.visits.find((v) => v.index === frames[b].visit);
    return va && vb ? { from: va, to: vb } : null;
  }, [stack, frames, epoch, view]);
  const rulerAnchor = clickSky ?? (view ? { ra: view.ra, dec: view.dec } : null);
  const rulerKey = view?.ruler && rulerPair && rulerAnchor ? `${rulerAnchor.ra.toFixed(5)}|${rulerAnchor.dec.toFixed(5)}|${rulerPair.from.midMjd}|${rulerPair.to.midMjd}|${view.fov}` : "";
  useEffect(() => {
    if (!rulerKey || !rulerPair || !rulerAnchor || !view) return;
    const ctrl = new AbortController();
    setRuler({ kind: "loading" });
    fetchRuler(rulerAnchor.ra, rulerAnchor.dec, rulerPair.from.midMjd, rulerPair.to.midMjd, view.fov, ctrl.signal)
      .then((data) => setRuler({ kind: "ready", data }))
      .catch((err) => { if (err.name !== "AbortError") setRuler({ kind: "error", message: "The parallax ruler could not be computed." }); });
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rulerKey]);

  const lens = useMemo(() => {
    if (!view?.bp) return null;
    const t = targets.find((x) => x.id === view.bp);
    if (t) return { ra: view.ra, dec: view.dec, target: t.id, label: t.name };
    const [r, d] = view.bp.split(",").map(Number);
    return Number.isFinite(r) && Number.isFinite(d) ? { ra: r, dec: d, target: null, label: "this point" } : null;
  }, [view?.bp, view?.ra, view?.dec, targets]);
  const lensMark = lens && !lens.target && stack ? toSvg(lens.ra, lens.dec) : null;

  const span = stack && stack.visits.length > 1 ? stack.visits[stack.visits.length - 1].midMjd - stack.visits[0].midMjd : 0;
  const shiftPx = (s: GaiaSource) => (Math.hypot(s.pmRa ?? 0, s.pmDec ?? 0) / 1000) * (span / 365.25) / scale;

  // the stack's stage, caption and playback, shared by the full view and the embed (one viewer, two layouts)
  const captionEl = !view ? null : (
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
  );
  // marks keep their screen size at every field of view: ticks 9 px long with a 9 px gap, circles 7 px
  const unit = size / Math.max(stagePx, 1); // grid units per screen pixel
  const ticks = (c: { x: number; y: number }) => {
    const gap = Math.max(9 * unit, 1.6);
    const len = 9 * unit;
    return [[-1, 0], [1, 0], [0, -1], [0, 1]].map(([dx, dy]) => [c.x + dx * gap, c.y + dy * gap, c.x + dx * (gap + len), c.y + dy * (gap + len)]);
  };
  const stageEl = !view ? null : (
            <div
              ref={stageRef}
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
                    <circle key={m.s.id} cx={m.x} cy={m.y} r={Math.max(7 * unit, 1.5)} fill="none" stroke={picked?.id === m.s.id ? "var(--fg)" : "var(--ice)"} strokeWidth={shiftPx(m.s) > 0.3 ? 1.4 : 1} vectorEffect="non-scaling-stroke" opacity={shiftPx(m.s) > 0.3 ? 0.95 : 0.55} />
                  ))}
                  {view.ruler && ruler.kind === "ready" && rulerAnchor && (
                    <RulerMarks ruler={ruler.data} anchor={toSvg(rulerAnchor.ra, rulerAnchor.dec)} size={size} scale={scale} />
                  )}
                  {lensMark && (
                    <g stroke="var(--ice)" strokeLinecap="round" strokeWidth={1.6} vectorEffect="non-scaling-stroke">
                      {ticks(lensMark).map(([x1, y1, x2, y2], i) => (
                        <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} vectorEffect="non-scaling-stroke" />
                      ))}
                    </g>
                  )}
                  {predicted && (
                    <g stroke="var(--red-text)" strokeLinecap="round">
                      <polyline points={predicted.pts.map((p) => `${p.x},${p.y}`).join(" ")} fill="none" strokeWidth={1.2} vectorEffect="non-scaling-stroke" strokeDasharray={`${4 * unit} ${4 * unit}`} />
                      {ticks(predicted.now).map(([x1, y1, x2, y2], i) => (
                        <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} strokeWidth={1.8} vectorEffect="non-scaling-stroke" />
                      ))}
                    </g>
                  )}
                </svg>
              )}
            </div>
  );
  const playbackEl = !view ? null : (
    <>
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
    </>
  );

  if (IS_EMBED) {
    const fullView = `${location.origin}${import.meta.env.BASE_URL}${location.search}`.replace(/[?&]embed=1/, "");
    return (
      <div className="embed">
        {!view ? (
          <p className="stage-msg">Add <span className="mono">ra</span> and <span className="mono">dec</span> to this embed link, for example <span className="mono">?ra=269.4463&amp;dec=4.7679&amp;fov=4</span>.</p>
        ) : (
          <>
            {captionEl}
            {stageEl}
            <div className="embed-bar">
              {playbackEl}
              <a className="text" href={fullView} target="_blank" rel="noopener">
                Open in SEDNA ↗<span className="sr"> (opens in new tab)</span>
              </a>
            </div>
            <p className="embed-credit">NASA SPHEREx data · {source === "demo" ? "prepared case" : "SEDNA"}</p>
          </>
        )}
      </div>
    );
  }

  // what the void view shows around the sky; the sky view shows the same elements in its drawer
  const detailsEl = !view ? null : (
    <>
            {/* short context first: the mission, what was clicked, what can be measured, what is known */}
            {coach}
            {picked && <StarCard star={picked} shiftPx={shiftPx(picked)} />}
            {clickSky && !view.bp && (
              <div className="focus-actions measure">
                <button type="button" className="text ice" onClick={() => update({ bp: `${clickSky.ra.toFixed(5)},${clickSky.dec.toFixed(5)}` }, true)}>
                  Measure brightness and spectrum {clickSky.star ? "of this star" : "here"}
                </button>
              </div>
            )}
            {target && target.kind !== "distance" && !view.bp && (
              <div className="focus-actions measure">
                <button type="button" className="text ice" onClick={() => update({ bp: target.id }, true)}>
                  Measure {target.name}&rsquo;s brightness and spectrum
                </button>
              </div>
            )}
            {target && <p className="note-line target-note">{target.note}</p>}
            <MoversNote state={movers} onShow={(m) => update({ mode: "film", fv: m.visit, ft: m.closestMjd }, true)} />
            {/* then the larger panels */}
            {view.ruler && rulerPair && (
              <RulerPanel state={ruler} fromLabel={dateLabel(rulerPair.from.start)} toLabel={dateLabel(rulerPair.to.start)} onFocus={() => update({ mode: "film" }, true)} />
            )}
            {lens && (
              <Suspense fallback={<p className="note-line" role="status">Opening the brightness lens…</p>}>
                <BrightnessPanel ra={lens.ra} dec={lens.dec} target={lens.target} label={lens.label} />
              </Suspense>
            )}
    </>
  );
  const modePanelEl = !view ? null : (
    view.mode === "follow" ? (
            <FollowPanel body={view.target ?? "sedna"} onDistance={() => startMission(MISSIONS[2])} />
          ) : view.mode === "focus" ? (
            <FocusPanel
              body={target?.kind === "distance" ? target : null}
              seed={target?.kind === "distance" ? null : seed}
              controls={targets.filter((t) => t.kind === "distance")}
              onOpen={openTarget}
              onProgress={onFocusProgress}
              header={coach}
            />
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
    ) : null
  );

  const skyEl =
    view?.sky ? (
      <SkyView
        size={stack ? size : Math.round((view.fov * 60) / 6.15) | 1}
        pixelArcsec={scale}
        center={stack?.center ?? { ra: view.ra, dec: view.dec }}
        frames={frameImages}
        epoch={epoch}
        mode={viewMode}
        appMode={view.mode}
        modes={MODES}
        limits={limits ?? { lo: 0, hi: 1 }}
        invert={view.invert}
        status={
          view.mode === "follow"
            ? "Sedna is stacked along its orbit in the panel on the right."
            : status.kind === "loading"
              ? "Reading SPHEREx exposures from the archive…"
              : status.kind === "error"
                ? status.message ?? "This field could not be loaded."
                : status.kind === "ready" && !frames.length
                  ? `No exposures of this field in detector ${view.det}. Try another detector.`
                  : null
        }
        title={target?.name ?? `${view.ra.toFixed(4)} ${view.dec.toFixed(4)}`}
        caption={
          current
            ? [
                view.mode === "diff" && frames.length > 1 ? `${dateLabel(frames[frames.length - 1].start)} − ${dateLabel(frames[0].start)}` : view.mode === "sum" ? `Sum of ${frames.length} visits` : dateLabel(current.start),
                `D${view.det} · ${DETECTORS[view.det - 1].range}`,
                `${view.mode === "diff" || view.mode === "sum" ? frames.reduce((n, f) => n + f.exposures, 0) : current.exposures} exp.`,
              ]
            : [`D${view.det} · ${DETECTORS[view.det - 1].range}`]
        }
        windowLabel={`SPHEREx · ${view.fov}′ · ${frames.length} ${frames.length === 1 ? "epoch" : "epochs"}`}
        det={view.det}
        detectors={DETECTORS}
        fov={view.fov}
        fovs={FOVS}
        gaia={view.gaia ? gaiaMarks.map((m) => ({ id: m.s.id, x: m.x, y: m.y, fast: shiftPx(m.s) > 0.3 })) : null}
        pickedId={picked?.id ?? null}
        measured={lensMark ?? (clickSky && stack ? toSvg(clickSky.ra, clickSky.dec) : null)}
        predicted={predicted}
        rulerMarks={view.ruler && ruler.kind === "ready" && rulerAnchor && stack ? <RulerMarks ruler={ruler.data} anchor={toSvg(rulerAnchor.ra, rulerAnchor.dec)} size={size} scale={scale} /> : null}
        ticks={frames.map((f, i) => {
          const first = visitOf(frames[0].visit)?.midMjd ?? 0;
          const last = visitOf(frames[frames.length - 1].visit)?.midMjd ?? 1;
          const mid = visitOf(f.visit)?.midMjd ?? first;
          return { key: String(f.visit), label: dateLabel(f.start), left: frames.length > 1 ? 6 + (88 * (mid - first)) / (last - first) : 50, current: i === epoch && view.mode === "blink", onClick: () => { setEpoch(i); update({ mode: "blink" }); } };
        })}
        playing={playing}
        fps={view.fps}
        spectrumQuery={{ ra: view.ra, dec: view.dec, target: target && target.kind !== "distance" ? target.id : null }}
        details={modePanelEl ?? detailsEl}
        attention={`${picked?.id ?? ""}|${clickSky ? `${clickSky.ra.toFixed(5)},${clickSky.dec.toFixed(5)}` : ""}|${view.bp ?? ""}|${view.mode}|${view.mission ?? ""}|${view.ruler}`}
        overlays={{ invert: view.invert, ruler: view.ruler, wiseview: `http://byw.tools/wiseview#ra=${view.ra.toFixed(5)}&dec=${view.dec.toFixed(5)}&size=${Math.round(view.fov * 60)}&band=2` }}
        onPick={pickAt}
        onPlay={() => setPlaying((v) => !v)}
        onSpeed={() => update({ fps: view.fps === 1 ? 2 : view.fps === 2 ? 4 : 1 })}
        onMode={(m) => update({ mode: m as Mode }, true)}
        onDet={(d) => update({ det: d })}
        onFov={(f) => update({ fov: f }, true)}
        onGaia={() => update({ gaia: !view.gaia })}
        onInvert={() => update({ invert: !view.invert })}
        onRuler={() => update({ ruler: !view.ruler }, true)}
        onCopyLink={() => copy("link", location.href)}
        onCopyEmbed={() => copy("embed", embedCode())}
        copied={copied}
        onExit={() => update({ sky: false }, true)}
      />
    ) : null;

  // full screen replaces the page: nothing is drawn or fetched twice
  if (skyEl) return skyEl;

  return (
    <div className="app">
      <header className="top">
        <a className="brand" href={import.meta.env.BASE_URL} aria-label="SEDNA, start page">
          <picture>
            <source media="(max-width: 820px)" srcSet={`${import.meta.env.BASE_URL}brand/sedna-wordmark-on-dark.svg`} width={120} height={28} />
            <img src={`${import.meta.env.BASE_URL}brand/sedna-horizontal-on-dark.svg`} width={180} height={45} alt="SEDNA" />
          </picture>
        </a>
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
            <>
              {canSky && status.kind === "ready" && frames.length > 0 && (
                <button type="button" className="text full-screen-entry" onClick={() => update({ sky: true }, true)} title="Full screen sky map (F)">
                  <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 6V2.5H6M10 2.5h3.5V6M2.5 10v3.5H6M13.5 10v3.5H10" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
                  Full screen
                </button>
              )}
              <button type="button" className="text" onClick={() => copy("link", location.href)}>
                {copied === "link" ? "Copied" : "Copy link"}
              </button>
              <button type="button" className="text wide-only" onClick={() => copy("embed", embedCode())} title="An iframe of this view for another web page">
                {copied === "embed" ? "Copied" : "Copy embed code"}
              </button>
            </>
          )}
        </div>
      </header>

      {!view && (
        <section className="start">
          <h1>Watch the infrared sky change.</h1>
          <p>SEDNA shows NASA SPHEREx images of any patch of sky as a short sequence in time, so anything that moved or changed stands out. Type coordinates above, or start with a one-minute mission.</p>
          {source === "demo" && (
            <p className="note-line" role="status">
              The data service is not reachable, so SEDNA is running on prepared cases: the three missions, the five challenge targets and the distance controls. Typed coordinates need the live service.
            </p>
          )}
          {targets.some((t) => t.id === "sedna") && (
            <p className="namesake">
              <button type="button" className="text ice" onClick={() => openTarget(targets.find((t) => t.id === "sedna")!)}>
                SEDNA is named after 90377 Sedna, a world 83 au away. Can SPHEREx see it? →
              </button>
            </p>
          )}
          <h2 className="eyebrow">One-minute missions</h2>
          <ul className="examples missions">
            {MISSIONS.map((m, i) => (
              <li key={m.id}>
                <button type="button" onClick={() => startMission(m)} disabled={!targets.length}>
                  <strong><span className="mono">{i + 1}</span> {m.title}</strong>
                  <span>{m.teaser}</span>
                </button>
              </li>
            ))}
          </ul>
          <h2 className="eyebrow">The challenge targets</h2>
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
        <main className={`viewer${modePanelEl ? " panel-mode" : ""}`}>
          {/* every control in one column, beside the sky */}
          <aside className="rail left" aria-label="Controls">
            <div className="group" role="group" aria-label="Compare mode">
              <span className="eyebrow">Compare</span>
              {MODES.map((m) => (
                <button key={m.id} type="button" className="opt" aria-pressed={view.mode === m.id} onClick={() => update({ mode: m.id })}>
                  <span className="dot" />
                  {m.label}
                </button>
              ))}
            </div>
            {!modePanelEl && (
              <div className="group" role="group" aria-label="Detector">
                <span className="eyebrow">Detector</span>
                <div className="chips det-chips">
                  {DETECTORS.map((d) => (
                    <button key={d.id} type="button" className="opt mono" aria-pressed={view.det === d.id} onClick={() => update({ det: d.id })} title={d.range} aria-label={`Detector ${d.id}, ${d.range}`}>
                      D{d.id}
                    </button>
                  ))}
                </div>
                <span className="sub mono det-range">{DETECTORS[view.det - 1].range}</span>
              </div>
            )}
            {view.mode !== "focus" && view.mode !== "follow" && (
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
            {!modePanelEl && (
              <div className="group" role="group" aria-label="Overlays and display">
                <span className="eyebrow">Overlays</span>
                <button type="button" className="opt" aria-pressed={view.gaia} onClick={() => update({ gaia: !view.gaia })}>
                  <span className="dot" />Gaia DR3 stars
                </button>
                <button type="button" className="opt" aria-pressed={view.invert} onClick={() => update({ invert: !view.invert })}>
                  <span className="dot" />Invert
                </button>
                <button type="button" className="opt" aria-pressed={view.ruler} onClick={() => update({ ruler: !view.ruler }, true)} title="How far a body here would move between two visits">
                  <span className="dot" />Parallax ruler
                </button>
                <a className="opt link" href={`http://byw.tools/wiseview#ra=${view.ra.toFixed(5)}&dec=${view.dec.toFixed(5)}&size=${Math.round(view.fov * 60)}&band=2`} target="_blank" rel="noopener">
                  Same sky in WiseView ↗<span className="sr"> (opens in new tab)</span>
                </a>
              </div>
            )}
          </aside>

          {modePanelEl ?? (
          <section className="stage-wrap">
            {captionEl}
            {stageEl}
            <div className="readout mono">
              <span>{readout ?? "Point at the sky to read its position and value; click to identify"}</span>
              <span>North up, east left · asinh, one stretch for all dates</span>
            </div>
            {/* the timeline stays right under the sky, whatever the details below or beside it hold */}
            <footer className="timeline">
              {playbackEl}
              <button type="button" className="speed mono" onClick={() => update({ fps: view.fps === 1 ? 2 : view.fps === 2 ? 4 : 1 })} aria-label="Blink speed">
                {view.fps} fps
              </button>
            </footer>
          </section>
          )}

          {/* what is known about this field, beside the sky (below it on narrower screens) */}
          {!modePanelEl && (
            <aside className="details" aria-label="About this field">
              <span className="eyebrow">About this field</span>
              {detailsEl}
            </aside>
          )}
        </main>
      )}

      <footer className="credits">
        <span>
          Data: NASA SPHEREx Level-2 spectral images (DR1 and QR3), read from the public archive bucket{health ? `, through ${health}` : ""}. Star positions: ESA Gaia DR3.
        </span>
        <span className="mono">
          {stack && status.kind === "ready" ? `${stack.exposuresRead} exposures · ${stack.source === "cache" ? "prepared result" : `read in ${stack.seconds}s`} · ` : ""}
          {source === "live" ? "live data service" : source === "demo" ? "prepared cases: the data service is offline" : ""}
        </span>
      </footer>
    </div>
  );
}
