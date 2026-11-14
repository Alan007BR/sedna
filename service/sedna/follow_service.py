"""Follow a known faint body along its JPL Horizons track through every SPHEREx exposure, and stack.

Built for 90377 Sedna (V about 20.8 at 83 au), which no single exposure shows.
Near quadrature, where SPHEREx looks, it moves only a few pixels within a visit, so
the stars around it are subtracted with a static sky made from exposures of the same
patch taken in other visits, months away. Residual stamps centred on the body are
stacked per visit and for all visits; the same stamps cut along control tracks
(the body's motion, shifted 1-4 arcmin) measure how often noise alone does as well.
``probes/p16_sedna.py`` is the reasoning behind each step.

Code written with AI assistance (Claude); see AI_USAGE.md.
"""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor

import numpy as np
from scipy.ndimage import map_coordinates

from .archive import horizons
from .archive.cutout import read_cutout
from .archive.skyindex import SkyIndex
from .focus_service import body_visits
from .science.stack import Grid, resample, robust_mean
from .archive.net import WORKERS

BIG = 121  # static-sky grid per visit (12.4 arcmin): the body's path within a visit plus the control offsets
STAMP = 21
CONTROLS = 200
REFLECTED = (1, 2, 3)  # 0.73-2.44 um, where reflected sunlight is strongest


def _normalised(cut):
    f = np.isfinite(cut.image)
    if f.mean() < 0.5:
        return None
    med = np.median(cut.image[f])
    noise = 1.4826 * np.median(np.abs(cut.image[f] - med))
    if not noise > 0:
        return None
    cut.image = ((cut.image - med) / noise).astype(np.float32)
    return cut


def snr(stack: np.ndarray | None) -> float:
    """3x3 sum at the centre over the scatter of 3x3 sums in a ring 4-9 pixels out."""
    if stack is None or not np.isfinite(stack).any():
        return float("nan")
    c = stack.shape[0] // 2
    yy, xx = np.indices(stack.shape)
    rr = np.hypot(xx - c, yy - c)
    s = np.nan_to_num(stack - np.nanmedian(stack[rr > 4]))
    box = sum(np.roll(np.roll(s, dy, 0), dx, 1) for dy in (-1, 0, 1) for dx in (-1, 0, 1))
    ring = box[(rr > 4) & (rr < c - 1)]
    noise = 1.4826 * np.median(np.abs(ring - np.median(ring)))
    return float(box[c, c] / noise) if noise > 0 else float("nan")


def follow(index: SkyIndex, ident: str, detectors=REFLECTED, workers: int = WORKERS, seed: int = 3) -> dict:
    visits = body_visits(index, ident, detectors=(1, 2, 3, 4, 5, 6))
    visits = [[h for h in v if h.det in detectors] for v in visits]
    visits = [v for v in visits if len(v) >= 3]
    if not visits:
        raise LookupError("SPHEREx has no indexed exposure of this body")
    hits = [h for v in visits for h in v]
    eph = horizons.at_times(ident, [h.mjd for h in hits])
    track = {id(h): (float(eph["ra"][i]), float(eph["dec"][i])) for i, h in enumerate(hits)}
    rng = np.random.default_rng(seed)
    angles = rng.uniform(0, 2 * np.pi, CONTROLS)
    radii = rng.uniform(60, 240, CONTROLS)

    def on_grid(h, grid, centre):
        try:
            cut = read_cutout(h.key, *centre, half=int(BIG * 0.75) + 4)
        except Exception:
            return None
        if cut is None or _normalised(cut) is None:
            return None
        return resample(cut, *grid.sky())

    prepared = []
    for visit in visits:
        pts = np.array([track[id(h)] for h in visit])
        centre = (float(np.median(pts[:, 0])), float(np.median(pts[:, 1])))
        grid = Grid(*centre, BIG)
        t0, t1 = visit[0].mjd - 20, visit[-1].mjd + 20
        others = [h for h in index.lookup(*centre, detectors=detectors) if not (t0 <= h.mjd <= t1)]
        with ThreadPoolExecutor(workers) as pool:
            own = list(pool.map(lambda h: on_grid(h, grid, centre), visit))
            sky = list(pool.map(lambda h: on_grid(h, grid, centre), others))
        static = {}
        for det in detectors:
            planes = [p for h, p in zip(others, sky) if p is not None and h.det == det]
            if len(planes) >= 3:
                static[det] = np.nanmedian(np.array(planes), axis=0)
        usable = [(h, p - static[h.det]) for h, p in zip(visit, own) if p is not None and h.det in static]
        prepared.append({"grid": grid, "usable": usable, "templates": len(others)})

    c = STAMP // 2
    yy, xx = np.mgrid[-c : c + 1, -c : c + 1]

    def stamps(k):
        out = []
        for vi, v in enumerate(prepared):
            for h, resid in v["usable"]:
                ra, dec = track[id(h)]
                if k:
                    ra += radii[k - 1] * np.cos(angles[k - 1]) / 3600 / np.cos(np.radians(dec))
                    dec += radii[k - 1] * np.sin(angles[k - 1]) / 3600
                px, py = (float(np.asarray(q).ravel()[0]) for q in v["grid"].pixel_of(ra, dec))
                s = map_coordinates(resid, [yy + py, xx + px], order=1, mode="constant", cval=np.nan)
                if np.isfinite(s).mean() > 0.8:
                    out.append((vi, h, s))
        return out

    with ThreadPoolExecutor(8) as pool:
        per_track = list(pool.map(stamps, range(CONTROLS + 1)))

    def summarise(pick):
        planes = [s for vi, h, s in per_track[0] if pick(vi)]
        stack = robust_mean(np.array(planes)) if len(planes) >= 3 else None
        ctrl = []
        for k in range(1, CONTROLS + 1):
            p = [s for vi, h, s in per_track[k] if pick(vi)]
            if len(p) >= 3:
                ctrl.append(snr(robust_mean(np.array(p))))
        ctrl = np.array([x for x in ctrl if np.isfinite(x)])
        value = snr(stack)
        return {
            "stack": stack,
            "exposures": len(planes),
            "snr": value,
            "control_sd": float(ctrl.std()) if len(ctrl) else float("nan"),
            "control_max": float(ctrl.max()) if len(ctrl) else float("nan"),
            "controls_at_or_above": int((ctrl >= value).sum()) if len(ctrl) else 0,
            "controls": int(len(ctrl)),
        }

    per_visit = []
    for vi, visit in enumerate(visits):
        s = summarise(lambda x, vi=vi: x == vi)
        s.update(start=visit[0].mjd, end=visit[-1].mjd, templates=prepared[vi]["templates"])
        per_visit.append(s)
    combined = summarise(lambda x: True)

    # a typical single exposure: the one whose own S/N is the median, not a lucky one
    singles = [(snr(s), h, s) for vi, h, s in per_track[0]]
    singles = [x for x in singles if np.isfinite(x[0])]
    singles.sort(key=lambda x: x[0])
    typical = singles[len(singles) // 2] if singles else None
    return {
        "visits": per_visit,
        "combined": combined,
        "single": None if typical is None else {"snr": typical[0], "mjd": typical[1].mjd, "detector": typical[1].det, "stamp": typical[2], "median_snr": float(np.median([x[0] for x in singles]))},
        "distance_au": float(np.median(eph["delta"])),
        "detectors": list(detectors),
    }
