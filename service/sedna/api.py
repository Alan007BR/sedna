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
from .archive.skybot import known_object
from .archive.skyindex import SkyIndex
from .science import parallax
from .focus_service import focus_body
from .brightness_service import measure_point, neighbours
from .brightness_service import wavemap as brightness_wavemap
from .archive import horizons
from .models import BrightnessResponse, MoversResponse, NextVisitResponse, RulerResponse
from .movers_service import MAX_RATE_ARCSEC_H, VISIBLE_V, movers_in_field
from .next_visit_service import DISTANCE_SPREAD as NV_SPREAD
from .next_visit_service import MAX_EXPOSURES as NV_MAX
from .next_visit_service import REGION_ARCMIN as NV_REGION
from .next_visit_service import next_visit
from .science.movers import separation_arcsec, tangent_offsets_arcsec
from .science.focus import INFINITY_AU, judge
from .science.stack import DETECTOR_RANGE_UM, PIXEL_ARCSEC, build_stack
from .targets import TARGETS, propagate

SCHEMA = 1
RELEASE = "SPHEREx DR1 + QR3 (pipeline R7), read from the public AWS bucket"
CACHE = Path(__file__).resolve().parents[2] / "data" / "cache" / "stacks"
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
