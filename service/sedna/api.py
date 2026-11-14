"""SEDNA data service: sky position in, aligned SPHEREx frames out.

Run from the ``service`` folder:  uvicorn sedna.api:app --port 8000

Code written with AI assistance (Claude); see AI_USAGE.md.
"""
from __future__ import annotations

import base64
import hashlib
import json
import time
from pathlib import Path

import numpy as np
import requests
from astropy.time import Time
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from .archive.gaia import cone as gaia_cone
from .archive.sesame import SesameUnavailable
from .archive.sesame import resolve as sesame_resolve
from .archive.simbad import MIRRORS as SIMBAD_MIRRORS
from .archive.simbad import SimbadUnavailable
from .archive.simbad import lookup_gaia as simbad_lookup
from .archive.skybot import known_object
from .archive.skyindex import SkyIndex
from .science import parallax
from .focus_service import focus_body
from .brightness_service import measure_point, neighbours
from .brightness_service import wavemap as brightness_wavemap
from .archive import horizons
from .follow_service import CONTROLS as FOLLOW_CONTROLS
from .follow_service import STAMP as FOLLOW_STAMP
from .follow_service import follow
from .models import BrightnessResponse, FollowResponse, MoversResponse, NextVisitResponse, ResolveResponse, RulerResponse, SearchResponse, StarResponse
from .movers_service import MAX_RATE_ARCSEC_H, VISIBLE_V, movers_in_field
from .next_visit_service import DISTANCE_SPREAD as NV_SPREAD
from .next_visit_service import MAX_EXPOSURES as NV_MAX
from .next_visit_service import REGION_ARCMIN as NV_REGION
from .next_visit_service import next_visit
from .science.movers import separation_arcsec, tangent_offsets_arcsec
from .science.focus import INFINITY_AU, judge
from .science.focus import distance_ladder as parallax_ladder
from .science.stack import DETECTOR_RANGE_UM, PIXEL_ARCSEC, build_stack
from .targets import TARGETS, propagate
from .paths import CACHE_DIR

SCHEMA = 1
RELEASE = "SPHEREx DR1 + QR3 (pipeline R7), read from the public AWS bucket"
CACHE = CACHE_DIR / "stacks"
CITATION = (
    "This work makes use of data products from the Spectro-Photometer for the History of the Universe, "
    "Epoch of Reionization and Ices Explorer (SPHEREx), which is a joint project of the Jet Propulsion Laboratory "
    "and the California Institute of Technology, and is funded by the National Aeronautics and Space Administration."
)

app = FastAPI(title="SEDNA", version="0.1")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["GET"], allow_headers=["*"])
_index: SkyIndex | None = None


def index() -> SkyIndex:
    global _index
    if _index is None:
        _index = SkyIndex.load()
    return _index


def encode(image: np.ndarray) -> str:
    return base64.b64encode(np.ascontiguousarray(image, dtype="<f4").tobytes()).decode("ascii")


def iso(mjd: float) -> str:
    return Time(mjd, format="mjd").iso[:16] + "Z"


@app.get("/api/health")
def health():
    ix = index()
    return {"schemaVersion": SCHEMA, "exposures": ix.n, "dataFrom": iso(float(ix.a["mjd"][0])), "dataThrough": iso(float(ix.a["mjd"][-1]))}


@app.get("/api/targets")
def targets():
    return {"schemaVersion": SCHEMA, "targets": [{"id": k, **{f: v for f, v in t.items()}} for k, t in TARGETS.items()]}


@app.get("/api/stack")
def stack(
    ra: float = Query(..., ge=0, lt=360),
    dec: float = Query(..., ge=-90, le=90),
    fov: float = Query(6.0, ge=1.0, le=30.0, description="field of view in arcmin"),
):
    key = hashlib.sha1(f"{SCHEMA}|{ra:.5f}|{dec:.5f}|{fov:.2f}|{index().n}".encode()).hexdigest()
    path = CACHE / f"{key}.json"
    if path.exists():
        payload = json.loads(path.read_text())
        payload["source"] = "cache"
        return payload
    t0 = time.time()
    st = build_stack(index(), ra, dec, fov_arcmin=fov)
    if not st.frames:
        raise HTTPException(404, detail={"code": "OUT_OF_COVERAGE", "message": "SPHEREx has no usable exposure of this position in the indexed data."})
    visits = []
    for vi in sorted({f.visit for f in st.frames}):
        fr = [f for f in st.frames if f.visit == vi]
        visits.append(
            {
                "index": vi,
                "start": iso(min(f.mjd_start for f in fr)),
                "end": iso(max(f.mjd_end for f in fr)),
                "midMjd": float(np.mean([(f.mjd_start + f.mjd_end) / 2 for f in fr])),
                "detectors": sorted(f.det for f in fr),
            }
        )
    payload = {
        "schemaVersion": SCHEMA,
        "center": {"ra": ra, "dec": dec},
        "grid": {"size": st.grid.size, "pixelScaleArcsec": PIXEL_ARCSEC, "orientation": "north up, east left; row 0 is south"},
        "unit": "MJy/sr, median background removed per exposure",
        "visits": visits,
        "frames": [
            {
                "visit": f.visit,
                "detector": f.det,
                "wavelengthUm": DETECTOR_RANGE_UM[f.det],
                "start": iso(f.mjd_start),
                "end": iso(f.mjd_end),
                "exposures": f.n_exposures,
                "data": encode(f.image),
            }
            for f in st.frames
        ],
        "exposuresRequested": st.n_requested,
        "exposuresRead": st.n_read,
        "seconds": round(time.time() - t0, 2),
        "release": RELEASE,
        "citation": CITATION,
        "source": "archive",
    }
    CACHE.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload))
    return payload


@app.get("/api/position")
def position(target: str, mjd: float):
    """Position of a built-in target propagated to a date with its catalogue proper motion."""
    if target not in TARGETS:
        raise HTTPException(404, detail={"code": "TARGET_NOT_FOUND", "message": f"Unknown target {target}."})
    ra, dec = propagate(TARGETS[target], mjd)
    return {"schemaVersion": SCHEMA, "ra": ra, "dec": dec}


@app.get("/api/gaia")
def gaia(ra: float, dec: float, fov: float = 6.0):
    """Gaia DR3 sources in the field with proper motions, for the overlay and the known-star verdict."""
    radius = fov / 60 / 2 * 1.5
    try:
        rows = gaia_cone(ra, dec, radius, g_max=16.5, limit=150)  # cached on disk after the first answer
    except Exception as err:
        raise HTTPException(503, detail={"code": "CATALOG_UNAVAILABLE", "message": "The Gaia archive did not answer.", "cause": repr(err)[:120]})
    return {"schemaVersion": SCHEMA, "catalog": "Gaia DR3", "refEpoch": 2016.0, "sources": rows}


@app.get("/api/star", response_model=StarResponse)
def star(gaia: str = Query(..., pattern=r"^\d{6,20}$", description="Gaia DR3 source_id")):
    """What SIMBAD knows about a Gaia DR3 star, with links to its SIMBAD page and its Gaia DR3 record."""
    try:
        info = simbad_lookup(gaia)
    except SimbadUnavailable:
        mirror = SIMBAD_MIRRORS[1]  # the mirror that stayed up when CDS went offline
        return {
            "schemaVersion": SCHEMA,
            "gaiaId": gaia,
            "available": False,
            "found": False,
            "source": None,
            "links": {
                "simbad": f"{mirror['simbad']}/simbad/sim-id?Ident=Gaia+DR3+{gaia}",
                "gaia": f"{mirror['vizier']}/viz-bin/VizieR-5?-source=I/355/gaiadr3&Source={gaia}",
            },
        }
    return {"schemaVersion": SCHEMA, "available": True, **info}


def _tidy_identifier(main_id: str) -> str:
    """SIMBAD pads identifiers ("M  42") and prefixes common names ("NAME Barnard's star")."""
    text = " ".join(main_id.split())
    return text[5:] if text.startswith("NAME ") else text


@app.get("/api/resolve", response_model=ResolveResponse)
def resolve_name(name: str = Query(..., min_length=1, max_length=80, description="an object's name, as people type it")):
    """Where a named object is: SIMBAD, then NED, then VizieR, through CDS Sesame and its mirrors."""
    try:
        found = sesame_resolve(name)
    except SesameUnavailable:
        raise HTTPException(503, detail={"code": "RESOLVER_UNAVAILABLE", "message": "The name resolver (CDS Sesame and its mirrors) did not answer. Type coordinates instead."})
    query = " ".join(name.split())
    if not found:
        return {"schemaVersion": SCHEMA, "query": query, "found": False}
    return {
        "schemaVersion": SCHEMA,
        "query": query,
        "found": True,
        "name": _tidy_identifier(found.name),
        "ra": found.ra,
        "dec": found.dec,
        "pmRa": found.pm_ra,
        "pmDec": found.pm_dec,
        "type": found.otype,
        "resolver": found.resolver,
        "source": f"{found.resolver} via Sesame ({found.source})",
    }


@app.get("/api/parallax-ruler", response_model=RulerResponse)
def parallax_ruler(
    ra: float = Query(..., ge=0, lt=360),
    dec: float = Query(..., ge=-90, le=90),
    mjd_a: float = Query(..., ge=60000, le=70000),
    mjd_b: float = Query(..., ge=60000, le=70000),
    fov: float = Query(6.0, ge=1.0, le=30.0),
):
    """Where a body seen at (ra, dec) on date A would be on date B, at 50, 100, 300 and 500 au and at 2 pc."""
    ras, decs = parallax.ruler(ra, dec, mjd_a, mjd_b)
    east, north = tangent_offsets_arcsec(ras, decs, ra, dec)
    shift = separation_arcsec(ras, decs, ra, dec)
    half = fov * 60 / 2
    marks = []
    for d, r, c, e, n, s in zip(parallax.RULER_AU, ras, decs, east, north, shift):
        marks.append(
            {
                "distanceAu": d,
                "label": "2 pc (a nearby star)" if d > 1e5 else f"{d:.0f} au",
                "ra": float(r),
                "dec": float(c),
                "eastArcsec": float(e),
                "northArcsec": float(n),
                "shiftArcsec": float(s),
                "inField": bool(abs(e) <= half and abs(n) <= half),
            }
        )
    return {
        "schemaVersion": SCHEMA,
        "anchor": {"ra": ra, "dec": dec, "mjd": mjd_a, "date": iso(mjd_a)},
        "to": {"ra": ra, "dec": dec, "mjd": mjd_b, "date": iso(mjd_b)},
        "fovArcmin": fov,
        "marks": marks,
        "staysInFieldBeyondAu": parallax.stays_in_field_beyond(ra, dec, mjd_a, mjd_b, half),
        "assumption": "A Solar System body on a circular, prograde orbit in the ecliptic, seen from the Earth's centre. The 2 pc mark is a star's parallax alone; real stars also have their own motion.",
    }


def _next_visit_payload(body: str | None, name: str, seed: dict, distance: float, truth_ident: str | None) -> dict:
    t0 = time.time()
    nv = next_visit(index(), seed["ra"], seed["dec"], seed["mjd"], distance)
    base = {
        "schemaVersion": SCHEMA,
        "release": RELEASE,
        "status": nv.status,
        "body": body,
        "name": name,
        "seed": {"ra": seed["ra"], "dec": seed["dec"], "mjd": seed["mjd"], "date": iso(seed["mjd"])},
        "distanceAu": round(distance, 2),
        "spread": NV_SPREAD,
        "predicted": None,
        "daysAhead": None,
        "jumpDeg": None,
        "arc": [{"distanceAu": round(d, 2), "ra": r, "dec": c} for d, r, c in nv.arc],
        "window": None,
        "grid": None,
        "tracked": None,
        "static": None,
        "found": None,
        "truth": None,
        "known": None,
        "method": (
            f"Predicted with the distance-focus model at {distance:.1f} au. The search covers distances within ±{NV_SPREAD:.0%} and {NV_REGION:.0f} arcmin around them; "
            f"the next visit's exposures (up to {NV_MAX}) are stacked twice, fixed on the sky and following the body at {distance:.1f} au. A detection must stand out at S/N 7, "
            "be sharper when followed than when fixed, have no negative lobe beside it (a star shifted by a pixel), and appear in both halves of the exposures."
        ),
        "seconds": 0.0,
        "source": "archive",
    }
    if np.isfinite(nv.t_mid):
        base["predicted"] = {"ra": nv.predicted[0], "dec": nv.predicted[1], "mjd": nv.t_mid, "date": iso(nv.t_mid)}
        base["daysAhead"] = round(nv.t_mid - seed["mjd"], 1)
        base["jumpDeg"] = round(float(separation_arcsec(seed["ra"], seed["dec"], *nv.predicted)) / 3600, 3)
    if nv.tracked is not None:
        base["window"] = {"start": iso(nv.window[0]), "end": iso(nv.window[1]), "exposures": nv.exposures}
        base["grid"] = {"size": nv.size, "pixelScaleArcsec": PIXEL_ARCSEC, "center": {"ra": nv.centre[0], "dec": nv.centre[1]}}
        base["tracked"] = encode(np.nan_to_num(nv.tracked, nan=0.0))
        base["static"] = encode(np.nan_to_num(nv.static, nan=0.0))
    if nv.found:
        f = nv.found
        base["found"] = {"ra": f["ra"], "dec": f["dec"], "snr": round(f["snr"], 1), "halves": [round(v, 1) for v in f["halves"]], "offsetArcmin": round(f["offset_arcsec"] / 60, 2)}
        if not truth_ident:
            base["known"] = known_object(f["ra"], f["dec"], nv.t_mid, radius_arcsec=30.0)
    if truth_ident and np.isfinite(nv.t_mid):
        eph = horizons.at_times(truth_ident, [nv.t_mid])
        tr, td = float(eph["ra"][0]), float(eph["dec"][0])
        base["truth"] = {
            "ra": tr,
            "dec": td,
            "predictionErrorArcmin": round(float(separation_arcsec(*nv.predicted, tr, td)) / 60, 2),
            "foundErrorArcsec": round(float(separation_arcsec(nv.found["ra"], nv.found["dec"], tr, td)), 1) if nv.found else None,
            "source": "JPL Horizons, SPHEREx as observer",
        }
    base["seconds"] = round(time.time() - t0, 2)
    return base


@app.get("/api/follow", response_model=FollowResponse)
def follow_body(body: str):
    """Stack every exposure of a known faint body along its JPL Horizons track (built for 90377 Sedna)."""
    target = TARGETS.get(body)
    if not target or target.get("kind") != "follow":
        raise HTTPException(404, detail={"code": "TARGET_NOT_FOUND", "message": "Following along a known orbit is prepared for 90377 Sedna."})
    key = hashlib.sha1(f"follow|{SCHEMA}|{body}|{index().n}".encode()).hexdigest()
    path = CACHE / f"{key}.json"
    if path.exists():
        payload = json.loads(path.read_text())
        payload["source"] = "cache"
        return payload
    t0 = time.time()
    try:
        res = follow(index(), target["horizons"])
    except LookupError as err:
        raise HTTPException(404, detail={"code": "OUT_OF_COVERAGE", "message": str(err)})

    def pack(s: dict, label: str) -> dict:
        return {
            "label": label,
            "start": iso(s["start"]) if "start" in s else None,
            "end": iso(s["end"]) if "end" in s else None,
            "exposures": s["exposures"],
            "snr": round(s["snr"], 2),
            "controlSd": round(s["control_sd"], 2),
            "controlMax": round(s["control_max"], 2),
            "controlsAtOrAbove": s["controls_at_or_above"],
            "controls": s["controls"],
            "stack": encode(np.nan_to_num(s["stack"], nan=0.0)) if s["stack"] is not None else None,
        }

    single = res["single"]
    payload = {
        "schemaVersion": SCHEMA,
        "release": RELEASE,
        "body": body,
        "name": target["name"],
        "distanceAu": round(res["distance_au"], 1),
        "vMag": target.get("vMag"),
        "detectors": res["detectors"],
        "wavelengthUm": [DETECTOR_RANGE_UM[min(res["detectors"])][0], DETECTOR_RANGE_UM[max(res["detectors"])][1]],
        "stampSize": FOLLOW_STAMP,
        "pixelScaleArcsec": PIXEL_ARCSEC,
        "visits": [pack(s, f"Visit {i + 1}") for i, s in enumerate(res["visits"])],
        "combined": pack(res["combined"], "All visits"),
        "single": None
        if single is None
        else {"date": iso(single["mjd"]), "detector": single["detector"], "snr": round(single["snr"], 2), "medianSnr": round(single["median_snr"], 2), "stamp": encode(np.nan_to_num(single["stamp"], nan=0.0))},
        "method": (
            "Each exposure's position of the body comes from JPL Horizons with SPHEREx as the observer. The stars are removed with a static sky "
            "made from exposures of the same patch taken in other visits, months away, when the body was degrees off. Stamps centred on the body "
            f"are stacked with outlier rejection. Control: the same stamps along {FOLLOW_CONTROLS} tracks with the body's motion, shifted 1-4 arcmin."
        ),
        "seconds": round(time.time() - t0, 1),
        "source": "archive",
    }
    CACHE.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload))
    return payload


@app.get("/api/next-visit", response_model=NextVisitResponse)
def next_visit_body(body: str, visit: int = Query(0, ge=0, le=20)):
    """Predict a known body's position at SPHEREx's next visit from its distance focus, and look for it there."""
    target = TARGETS.get(body)
    if not target or "horizons" not in target:
        raise HTTPException(404, detail={"code": "TARGET_NOT_FOUND", "message": "The next-visit check has controls for Makemake, Haumea, Pluto and Eris."})
    key = hashlib.sha1(f"next|{SCHEMA}|{body}|{visit}|{index().n}".encode()).hexdigest()
    path = CACHE / f"{key}.json"
    if path.exists():
        payload = json.loads(path.read_text())
        payload["source"] = "cache"
        return payload
    f = focus(body, visit)
    payload = _next_visit_payload(body, target["name"], f["seed"], f["bestDistanceAu"], target["horizons"])
    CACHE.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload))
    return payload


@app.get("/api/next-visit-at", response_model=NextVisitResponse)
def next_visit_at(
    ra: float = Query(..., ge=0, lt=360),
    dec: float = Query(..., ge=-90, le=90),
    mjd: float = Query(..., ge=60000, le=70000),
    distance: float = Query(..., ge=10, le=2000),
):
    """The same check for a point the person picked, at the distance the focus found."""
    key = hashlib.sha1(f"next-at|{SCHEMA}|{ra:.5f}|{dec:.5f}|{mjd:.4f}|{distance:.2f}|{index().n}".encode()).hexdigest()
    path = CACHE / f"{key}.json"
    if path.exists():
        payload = json.loads(path.read_text())
        payload["source"] = "cache"
        return payload
    payload = _next_visit_payload(None, "the point you picked", {"ra": ra, "dec": dec, "mjd": mjd}, distance, None)
    CACHE.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload))
    return payload


@app.get("/api/focus")
def focus(body: str, visit: int = Query(0, ge=0, le=20)):
    """Distance focus on a known body: stacks for a ladder of trial distances, plus the JPL Horizons distance."""
    target = TARGETS.get(body)
    if not target or "horizons" not in target:
        raise HTTPException(404, detail={"code": "TARGET_NOT_FOUND", "message": "The distance focus has controls for Makemake, Haumea, Pluto and Eris."})
    key = hashlib.sha1(f"focus2|{SCHEMA}|{body}|{visit}|{index().n}".encode()).hexdigest()
    path = CACHE / f"{key}.json"
    if path.exists():
        payload = json.loads(path.read_text())
        payload["source"] = "cache"
        return payload
    t0 = time.time()
    try:
        res, truth = focus_body(index(), target["horizons"], visit=visit)
    except LookupError as err:
        raise HTTPException(404, detail={"code": "OUT_OF_COVERAGE", "message": str(err)})
    except ValueError:
        raise HTTPException(422, detail={"code": "TOO_FEW_EXPOSURES", "message": "Too few usable exposures around this body in the chosen visit. Try another visit."})
    level, reason = judge(res)
    payload = {
        "schemaVersion": SCHEMA,
        "body": body,
        "name": target["name"],
        "seed": {"ra": res.seed[0], "dec": res.seed[1], "mjd": res.seed[2], "date": iso(res.seed[2])},
        "distancesAu": [None if d >= INFINITY_AU else round(float(d), 2) for d in res.distances],
        "scores": [None if not np.isfinite(s) else round(float(s), 2) for s in res.scores],
        "best": res.best,
        "bestDistanceAu": round(float(res.distances[res.best]), 1),
        "halfRangeAu": [round(res.half_range[0], 1), round(res.half_range[1], 1)],
        "confidence": level,
        "confidenceReason": reason,
        "trueDistanceAu": round(truth["distanceAu"], 1),
        "visit": truth["visit"],
        "visits": truth["visits"],
        "exposures": res.n_exposures,
        "spanDays": round(float(res.mjd.max() - res.mjd.min()), 1),
        "start": iso(float(res.mjd.min())),
        "end": iso(float(res.mjd.max())),
        "detectors": truth["detectors"],
        "stampSize": int(res.stacks.shape[1]),
        "stacks": encode(np.nan_to_num(res.stacks, nan=0.0)),
        "film": {
            "dates": [iso(float(m)) for m in res.mjd],
            "static": encode(np.nan_to_num(res.film_static, nan=0.0)),
            "follow": encode(np.nan_to_num(res.film_follow, nan=0.0)),
        },
        "unit": "each exposure divided by its own noise, then median-stacked",
        "assumption": "The body is assumed to follow a circular, prograde orbit in the ecliptic. Distances come out within about 10% for such orbits and up to 40% off for eccentric ones.",
        "seconds": round(time.time() - t0, 2),
        "source": "archive",
    }
    CACHE.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload))
    return payload


@app.get("/api/brightness", response_model=BrightnessResponse)
def brightness(ra: float = Query(..., ge=0, lt=360), dec: float = Query(..., ge=-90, le=90), target: str | None = None):
    """Spectrum per time bin and change in brightness over time for one point (built-in targets follow their proper motion)."""
    t = TARGETS.get(target) if target else None
    key = hashlib.sha1(f"brightness|{SCHEMA}|{ra:.5f}|{dec:.5f}|{target if t else ''}|{index().n}".encode()).hexdigest()
    path = CACHE / f"{key}.json"
    if path.exists():
        payload = json.loads(path.read_text())
        payload["source"] = "cache"
        return payload
    t0 = time.time()
    position_at = (lambda mjd: propagate(t, mjd)) if t and t.get("pmRa") is not None else None
    method, exposures, available, change = measure_point(index(), ra, dec, position_at=position_at)
    if not exposures:
        raise HTTPException(404, detail={"code": "OUT_OF_COVERAGE", "message": "SPHEREx has no usable exposure of this point in the indexed data."})
    wm = brightness_wavemap()
    bins = []
    for b in sorted({e.bin for e in exposures}):
        sel = [e.mjd for e in exposures if e.bin == b]
        bins.append({"index": b, "start": iso(min(sel)), "end": iso(max(sel)), "midMjd": float(np.mean(sel)), "exposures": len(sel)})
    mid = {b["index"]: b["midMjd"] for b in bins}
    finite = lambda v: None if not np.isfinite(v) else round(float(v), 3)  # noqa: E731
    payload = {
        "schemaVersion": SCHEMA,
        "release": RELEASE,
        "point": {"ra": ra, "dec": dec},
        "target": target if t else None,
        "method": method,
        "methodNote": (
            "Flux within 12 arcsec (2 pixels) of the point, background from a ring 30-48 arcsec out; not corrected for light outside the aperture."
            if method == "aperture"
            else "The star's core is saturated in many exposures, so every exposure is measured in the unsaturated wings (18-42 arcsec from the centre). Changes over time are reliable; the spectrum's shape is not, because the wings widen with wavelength."
        ),
        "unit": "µJy",
        "exposuresAvailable": available,
        "exposuresMeasured": len(exposures),
        "neighbours": neighbours(
            ra,
            dec,
            method,
            float(np.median([e.flux for e in exposures if e.det == 1 and np.isfinite(e.flux) and e.flux > 0] or [e.flux for e in exposures if np.isfinite(e.flux) and e.flux > 0] or [0.0])),
            [position_at(m) for m in np.linspace(exposures[0].mjd, exposures[-1].mjd, 12)] if position_at else None,
        ),
        "bins": bins,
        "exposures": [
            {
                "mjd": e.mjd,
                "date": iso(e.mjd),
                "detector": e.det,
                "wavelengthUm": round(e.wavelength, 4),
                "bandwidthUm": round(e.bandwidth, 4),
                "flux": finite(e.flux),
                "fluxErr": finite(e.error),
                "saturatedPixels": e.nan_core,
                "bin": e.bin,
            }
            for e in exposures
        ],
        "change": [
            {
                "detector": det,
                "rangeUm": [round(v, 3) for v in wm.range_um(det)],
                "points": [{"bin": p.bin, "midMjd": mid[p.bin], "deltaMag": round(p.delta_mag, 4), "error": round(p.error, 4), "channels": p.channels, "exposures": p.exposures, "reliable": p.channels >= 3} for p in pts],
            }
            for det, pts in sorted(change.items())
            if pts
        ],
        "seconds": round(time.time() - t0, 2),
        "source": "archive",
    }
    CACHE.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload))
    return payload


@app.get("/api/movers", response_model=MoversResponse)
def movers(ra: float = Query(..., ge=0, lt=360), dec: float = Query(..., ge=-90, le=90), fov: float = Query(6.0, ge=1.0, le=15.0)):
    """Known asteroids, comets and dwarf planets that crossed the field during SPHEREx's visits (IMCCE SkyBoT)."""
    key = hashlib.sha1(f"movers|{SCHEMA}|{ra:.5f}|{dec:.5f}|{fov:.2f}|{index().n}".encode()).hexdigest()
    path = CACHE / f"{key}.json"
    if path.exists():
        payload = json.loads(path.read_text())
        payload["source"] = "cache"
        return payload
    t0 = time.time()
    visits, found, n_queries, n_failed = movers_in_field(index(), ra, dec, fov)
    if not visits:
        raise HTTPException(404, detail={"code": "OUT_OF_COVERAGE", "message": "SPHEREx has no usable exposure of this position in the indexed data."})
    status = "ok" if n_failed == 0 else ("unavailable" if n_failed == n_queries else "partial")
    shown = [(vi, c) for vi, c in found if c.v is None or c.v <= VISIBLE_V]
    payload = {
        "schemaVersion": SCHEMA,
        "release": RELEASE,
        "center": {"ra": ra, "dec": dec},
        "fovArcmin": fov,
        "status": status,
        "queries": n_queries,
        "failedQueries": n_failed,
        "visibleV": VISIBLE_V,
        "maxRateArcsecPerHour": MAX_RATE_ARCSEC_H,
        "visits": [{"index": vi, "start": iso(v[0].mjd), "end": iso(v[-1].mjd)} for vi, v in enumerate(visits)],
        "movers": [
            {
                "name": c.name,
                "number": c.number,
                "category": c.cls,
                "vMag": c.v,
                "visible": c.v is not None and c.v <= VISIBLE_V,
                "rateArcsecPerHour": round(c.rate_arcsec_h, 2),
                "distanceAu": None if c.distance_au is None else round(c.distance_au, 3),
                "visit": vi,
                "firstInField": iso(c.mjd[0]),
                "lastInField": iso(c.mjd[-1]),
                "closestDate": iso(c.closest_mjd),
                "closestMjd": c.closest_mjd,
                "closestArcsec": round(c.closest_arcsec, 1),
                "track": [{"mjd": t, "ra": r, "dec": d} for t, r, d in zip(c.mjd, c.ra, c.dec)],
            }
            for vi, c in shown
        ],
        "fainter": len(found) - len(shown),
        "method": (
            "IMCCE SkyBoT cone searches, one per group of exposures no longer than a day, geocentric; each body moved "
            f"linearly within its group. Bodies faster than {MAX_RATE_ARCSEC_H:.0f} arcsec/h (some near-Earth objects) can be missed."
        ),
        "seconds": round(time.time() - t0, 2),
        "source": "archive",
    }
    if status == "ok":  # a partial answer is not cached, so the next request retries the failed searches
        CACHE.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(payload))
    return payload


@app.get("/api/film")
def film(ra: float = Query(..., ge=0, lt=360), dec: float = Query(..., ge=-90, le=90), fov: float = Query(6.0, ge=1.0, le=15.0), visit: int = Query(0, ge=0, le=20)):
    """Single exposures of one visit, in time order: the view in which a moving body can be picked."""
    from .science.stack import build_film

    key = hashlib.sha1(f"film|{SCHEMA}|{ra:.5f}|{dec:.5f}|{fov:.2f}|{visit}|{index().n}".encode()).hexdigest()
    path = CACHE / f"{key}.json"
    if path.exists():
        return json.loads(path.read_text())
    grid, n_visits, used, frames = build_film(index(), ra, dec, fov_arcmin=fov, visit=visit)
    if not frames:
        raise HTTPException(404, detail={"code": "OUT_OF_COVERAGE", "message": "No usable single exposures of this field in this visit."})
    payload = {
        "schemaVersion": SCHEMA,
        "center": {"ra": ra, "dec": dec},
        "grid": {"size": grid.size, "pixelScaleArcsec": PIXEL_ARCSEC},
        "visit": used,
        "visits": n_visits,
        "frames": [{"mjd": f["mjd"], "date": iso(f["mjd"]), "detector": f["det"], "obsid": f["obsid"]} for f in frames],
        "data": encode(np.nan_to_num(np.array([f["image"] for f in frames]), nan=0.0)),
        "unit": "each exposure divided by its own noise",
    }
    CACHE.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload))
    return payload


@app.get("/api/search", response_model=SearchResponse)
def search(ra: float = Query(..., ge=0, lt=360), dec: float = Query(..., ge=-90, le=90), fov: float = Query(6.0, ge=1.0, le=10.0), visit: int = Query(0, ge=0, le=20)):
    """Search one visit of a field for moving bodies, with no starting point: shift-and-stack per trial distance."""
    from concurrent.futures import ThreadPoolExecutor

    from .search_service import CANDIDATE_SNR, DETECTORS as SEARCH_DETECTORS, FIXED_SHARE, HALF_SNR, MIN_MOTION_PX, RULES, STAR_SIGMA, WINDOW_DAYS, search_field

    key = hashlib.sha1(f"search|{RULES}|{SCHEMA}|{ra:.5f}|{dec:.5f}|{fov:.2f}|{visit}|{index().n}".encode()).hexdigest()
    path = CACHE / f"{key}.json"
    if path.exists():
        payload = json.loads(path.read_text())
        payload["source"] = "cache"
        return payload
    t0 = time.time()
    try:
        res = search_field(index(), ra, dec, fov_arcmin=fov, visit=visit)
    except LookupError as err:
        raise HTTPException(404, detail={"code": "OUT_OF_COVERAGE", "message": str(err)})
    except ValueError:
        raise HTTPException(422, detail={"code": "TOO_FEW_EXPOSURES", "message": "Too few usable single exposures in this visit, or too short a span, to search it. Try another visit."})
    with ThreadPoolExecutor(4) as pool:  # name each candidate if a known body was there
        known = list(pool.map(lambda c: known_object(c["ra"], c["dec"], c["mjd"], radius_arcsec=30.0), res.candidates))
    noise_max = max(res.noise_peaks, default=float("-inf"))
    ladder = [d for d in parallax_ladder() if d < INFINITY_AU]
    ladder = [d for d in ladder if d <= res.farthest_au + 1e-6]
    status_ok = all(k.get("status") != "unavailable" for k in known)
    payload = {
        "schemaVersion": SCHEMA,
        "release": RELEASE,
        "center": {"ra": ra, "dec": dec},
        "fovArcmin": fov,
        "grid": {"size": res.grid.size, "pixelScaleArcsec": PIXEL_ARCSEC},
        "visit": res.visit,
        "visits": res.visits,
        "window": {"start": iso(float(res.mjd.min())), "end": iso(float(res.mjd.max())), "exposures": int(len(res.mjd))},
        "templates": res.templates,
        "distancesAu": (round(float(ladder[0]), 1), round(float(ladder[-1]), 1)),
        "threshold": CANDIDATE_SNR,
        "candidates": [
            {
                "rank": i + 1,
                "ra": c["ra"],
                "dec": c["dec"],
                "mjd": c["mjd"],
                "date": iso(c["mjd"]),
                "x": c["x"],
                "y": c["y"],
                "snr": round(c["snr"], 1),
                "halves": [round(v, 1) for v in c["halves"]],
                "distanceAu": round(c["distance_au"], 1),
                "motionArcsec": round(c["motion_arcsec"], 1),
                "aboveNoise": bool(c["snr"] > noise_max),
                "known": k,
                "track": [{"mjd": t, "ra": r, "dec": d} for t, r, d in c["track"]],
            }
            for i, (c, k) in enumerate(zip(res.candidates, known))
        ],
        "noisePeaks": [round(v, 1) for v in res.noise_peaks],
        "map": encode(np.nan_to_num(res.snr_map, nan=0.0, neginf=0.0)),
        "method": (
            f"Every single exposure of the densest {WINDOW_DAYS:.0f} days of this visit (detectors {SEARCH_DETECTORS[0]}-{SEARCH_DETECTORS[-1]}), with the stars removed by a static sky "
            f"made from {res.templates} exposures of other visits, is shifted as a whole for each trial distance and stacked. Pixels near stars brighter than {STAR_SIGMA:.0f} sigma are masked. "
            f"A candidate must reach S/N {CANDIDATE_SNR:.0f}, show in each half of the exposures that cover it (S/N {HALF_SNR}), move at least {MIN_MOTION_PX:.0f} pixels, and fade to under "
            f"{FIXED_SHARE:.0%} of its S/N with no shift, which rules out stars that changed. The same search on the negated exposures counts what noise alone gives here."
        ),
        "limit": (
            "Tested without being told where to look, it found the dwarf planets Makemake and Haumea (V about 17) in each of their visits, "
            "and Eris (V = 18.6) in one visit of three. Fainter bodies, such as 90377 Sedna (V = 20.8), stay at the level of noise unless their orbit is known."
        ),
        "seconds": round(time.time() - t0, 2),
        "source": "archive",
    }
    if status_ok:  # a missing name is not cached, so the next request asks SkyBoT again
        CACHE.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(payload))
    return payload


@app.get("/api/focus-at")
def focus_at(ra: float = Query(..., ge=0, lt=360), dec: float = Query(..., ge=-90, le=90), mjd: float = Query(..., ge=60000, le=70000), window: float = Query(6.0, ge=1.0, le=20.0)):
    """Distance focus seeded on any point the user picked in one exposure."""
    from .science.focus import run_focus

    key = hashlib.sha1(f"focus-at|{SCHEMA}|{ra:.5f}|{dec:.5f}|{mjd:.4f}|{window}|{index().n}".encode()).hexdigest()
    path = CACHE / f"{key}.json"
    if path.exists():
        return json.loads(path.read_text())
    t0 = time.time()
    hits = index().lookup(ra, dec, detectors=(1, 2, 3, 4), mjd_range=(mjd - window / 2, mjd + window / 2))
    try:
        res = run_focus(hits, ra, dec, mjd)
    except ValueError:
        raise HTTPException(422, detail={"code": "TOO_FEW_EXPOSURES", "message": "Too few single exposures around that moment to measure a distance. Pick the point in another exposure."})
    level, reason = judge(res)
    payload = {
        "schemaVersion": SCHEMA,
        "body": None,
        "name": "the point you picked",
        "seed": {"ra": ra, "dec": dec, "mjd": mjd, "date": iso(mjd)},
        "distancesAu": [None if d >= INFINITY_AU else round(float(d), 2) for d in res.distances],
        "scores": [None if not np.isfinite(s) else round(float(s), 2) for s in res.scores],
        "best": res.best,
        "bestDistanceAu": round(float(res.distances[res.best]), 1),
        "halfRangeAu": [round(res.half_range[0], 1), round(res.half_range[1], 1)],
        "confidence": level,
        "confidenceReason": reason,
        "trueDistanceAu": None,
        "known": known_object(ra, dec, mjd),
        "visit": 0,
        "visits": 1,
        "exposures": res.n_exposures,
        "spanDays": round(float(res.mjd.max() - res.mjd.min()), 1),
        "start": iso(float(res.mjd.min())),
        "end": iso(float(res.mjd.max())),
        "detectors": [1, 2, 3, 4],
        "stampSize": int(res.stacks.shape[1]),
        "stacks": encode(np.nan_to_num(res.stacks, nan=0.0)),
        "film": {
            "dates": [iso(float(m)) for m in res.mjd],
            "static": encode(np.nan_to_num(res.film_static, nan=0.0)),
            "follow": encode(np.nan_to_num(res.film_follow, nan=0.0)),
        },
        "unit": "each exposure divided by its own noise, then median-stacked",
        "assumption": "The body is assumed to follow a circular, prograde orbit in the ecliptic. Distances come out within about 10% for such orbits and up to 40% off for eccentric ones.",
        "seconds": round(time.time() - t0, 2),
        "source": "archive",
    }
    CACHE.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload))
    return payload
