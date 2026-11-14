"""Search a whole field for moving bodies, without clicking anything: shift-and-stack the full field per distance.

Within a few arcminutes, a distant body's motion at a given distance is the same everywhere in the field, so
instead of sweeping distances from one clicked point, every exposure of a visit (stars removed with a static
sky from other visits) is shifted as a whole for each trial distance and stacked. A body at that distance adds
up to a point wherever it is; the best S/N over all distances, per pixel, is a detection map. Peaks in it are
candidates. The same search on the negated residuals (noise only: no real source is negative) counts how many
candidates noise alone gives at each S/N.

Run from service/:  ../.venv/Scripts/python ../probes/p18_field_search.py
Writes probes/p18_field_search.json and probes/p18_field_search.png.

Code written with AI assistance (Claude); see AI_USAGE.md.
"""
from __future__ import annotations

import json
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
from scipy.ndimage import map_coordinates, maximum_filter, uniform_filter

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "service"))
from sedna.api import index  # noqa: E402
from sedna.archive import horizons  # noqa: E402
from sedna.archive.cutout import read_cutout  # noqa: E402
from sedna.archive.skyindex import split_visits  # noqa: E402
from sedna.focus_service import densest_window  # noqa: E402
from sedna.follow_service import _normalised  # noqa: E402
from sedna.science import parallax  # noqa: E402
from sedna.science.focus import distance_ladder  # noqa: E402
from sedna.science.stack import Grid, resample, robust_mean  # noqa: E402

OUT = Path(__file__).resolve().parent
distances = distance_ladder()[:-1]  # 72 trial distances, 25-600 au
STAR_SIGMA = 4.0  # static sky brighter than this (in exposure noise) counts as a star
MIN_MOTION_PX = 2.0  # a body that moves less than this in the window cannot be told from a star residual


def residuals(idx, ra, dec, size, visit, detectors, window_days):
    """The visit's exposures (densest window) on a fixed grid, minus a static sky from the other visits."""
    grid = Grid(ra, dec, size)
    gra, gdec = grid.sky()
    hits = idx.lookup(ra, dec, detectors=detectors)
    visits = split_visits(hits)
    own = densest_window(visits[visit], window_days)
    t0, t1 = visits[visit][0].mjd - 20, visits[visit][-1].mjd + 20
    others = [h for h in hits if not (t0 <= h.mjd <= t1)]

    def on_grid(h):
        try:
            cut = read_cutout(h.key, ra, dec, half=int(size * 0.75) + 4)
        except Exception:
            return None
        if cut is None or _normalised(cut) is None:
            return None
        return resample(cut, gra, gdec)

    with ThreadPoolExecutor(24) as pool:
        own_p = list(pool.map(on_grid, own))
        sky_p = list(pool.map(on_grid, others))
    static = {}
    for det in detectors:
        planes = [p for h, p in zip(others, sky_p) if p is not None and h.det == det]
        if len(planes) >= 3:
            static[det] = np.nanmedian(np.array(planes), axis=0)
    # near bright stars the subtraction leaves residuals of either sign: mask them (and 2 pixels around)
    bright = np.zeros((size, size), bool)
    for tpl in static.values():
        bright |= np.nan_to_num(tpl) > STAR_SIGMA
    bright = maximum_filter(bright.astype(np.uint8), size=5).astype(bool)
    usable = [(h, np.where(bright, np.nan, p - static[h.det])) for h, p in zip(own, own_p) if p is not None and h.det in static]
    return grid, usable, len(visits)


def search(grid, usable, sign=1.0, min_cover=0.6):
    """Best S/N over all trial distances at every pixel, and the distance that gave it."""
    mjd = np.array([h.mjd for h, _ in usable])
    t0 = mjd.min()
    earth = parallax.earth_position(mjd)
    earth0 = parallax.earth_position([t0])[0]
    ra_t, dec_t = parallax.predict_track(grid.ra, grid.dec, t0, distances, mjd, earth=earth, earth0=earth0)  # (D, T)
    c = (grid.size - 1) / 2
    j, i = np.mgrid[0 : grid.size, 0 : grid.size].astype(float)
    best = np.full((grid.size, grid.size), -np.inf)
    best_d = np.zeros((grid.size, grid.size))
    for d in range(len(distances)):
        px_all, py_all = grid.pixel_of(ra_t[d], dec_t[d])
        if np.hypot(np.ptp(px_all), np.ptp(py_all)) < MIN_MOTION_PX:
            continue
        planes = []
        for t, (_, resid) in enumerate(usable):
            px, py = grid.pixel_of(ra_t[d, t], dec_t[d, t])
            dx, dy = float(px) - c, float(py) - c  # where a body at this distance has moved by time t
            planes.append(sign * map_coordinates(resid, [j + dy, i + dx], order=1, mode="constant", cval=np.nan))
        cube = np.array(planes)
        cover = np.isfinite(cube).mean(axis=0)
        stack = robust_mean(cube)
        stack = np.where(cover >= min_cover, stack, np.nan)
        box = uniform_filter(np.nan_to_num(stack), size=3) * 9
        ok = np.isfinite(stack)
        if ok.sum() < 50:
            continue
        noise = 1.4826 * np.median(np.abs(box[ok] - np.median(box[ok])))
        snr = np.where(ok, (box - np.median(box[ok])) / noise, -np.inf)
        better = snr > best
        best[better], best_d[better] = snr[better], distances[d]
    return best, best_d


def peaks(best, best_d, grid, threshold, n=10):
    finite = np.where(np.isfinite(best), best, -np.inf)
    local = (finite == maximum_filter(finite, size=7)) & (finite >= threshold)
    ys, xs = np.nonzero(local)
    order = np.argsort(-finite[ys, xs])[:n]
    out = []
    for k in order:
        y, x = int(ys[k]), int(xs[k])
        out.append({"x": x, "y": y, "snr": round(float(finite[y, x]), 2), "distance_au": round(float(best_d[y, x]), 1)})
    return out


def run(name, ra, dec, visit, detectors, truth=None, fov_arcmin=6.0, window_days=6.0):
    idx = index()
    size = int(round(fov_arcmin * 60 / 6.15)) | 1
    grid, usable, nvis = residuals(idx, ra, dec, size, visit, detectors, window_days)
    best, best_d = search(grid, usable)
    neg, neg_d = search(grid, usable, sign=-1.0)
    real = peaks(best, best_d, grid, 4.0, n=12)
    noise_peaks = peaks(neg, neg_d, grid, 4.0, n=200)
    where = None
    if truth is not None:  # where the known body is in the grid at the window's start, and the map's value there
        px, py = grid.pixel_of(truth[0], truth[1])
        tx, ty = int(round(float(px))), int(round(float(py)))
        if 0 <= tx < grid.size and 0 <= ty < grid.size:
            y0, y1, x0, x1 = max(0, ty - 2), ty + 3, max(0, tx - 2), tx + 3
            k = np.unravel_index(np.nanargmax(np.where(np.isfinite(best[y0:y1, x0:x1]), best[y0:y1, x0:x1], -np.inf)), best[y0:y1, x0:x1].shape)
            near = round(float(best[y0 + k[0], x0 + k[1]]), 2)  # compared rounded, like the candidates' S/N
            where = {"x": tx, "y": ty, "snr_near": near, "distance_near_au": round(float(best_d[y0 + k[0], x0 + k[1]]), 1),
                     "rank": 1 + sum(1 for p in real if p["snr"] > near)}
    result = {
        "field": name, "ra": ra, "dec": dec, "visit": visit + 1, "visits": nvis, "exposures": len(usable),
        "days": round(float(max(h.mjd for h, _ in usable) - min(h.mjd for h, _ in usable)), 2),
        "candidates": real, "known_body": where,
        "noise_peaks_at_or_above": {str(t): int(sum(1 for p in noise_peaks if p["snr"] >= t)) for t in (5, 6, 7, 8)},
        "real_peaks_at_or_above": {str(t): int(sum(1 for p in peaks(best, best_d, grid, 4.0, n=200) if p["snr"] >= t)) for t in (5, 6, 7, 8)},
    }
    print(f"\n== {name}, visit {visit + 1}: {len(usable)} exposures over {result['days']} d")
    print("  top candidates:", [(p["snr"], p["distance_au"], (p["x"], p["y"])) for p in real[:6]])
    print("  known body:", where)
    print("  peaks >= 5/6/7/8 sigma: real", result["real_peaks_at_or_above"], "| noise (negated)", result["noise_peaks_at_or_above"])
    return result, best


results, maps = [], []
# Makemake's field, the visit the distance focus uses (body near the centre at the window's start)
eph_mk = None
r, m = run("Makemake", 199.94124, 21.48776, 0, (1, 2, 3, 4), truth=None)
results.append(r); maps.append(("Makemake", m))
# Sedna: field centred near it in visits 1 and 3 (where the seeded focus found it); not told where it is
idx = index()
from sedna.focus_service import body_visits  # noqa: E402
sv = body_visits(idx, "90377", detectors=(1, 2, 3))
for v in (0, 2):
    win = densest_window([h for h in sv[v] if h.det in (1, 2, 3)], 6.0)
    eph = horizons.at_times("90377", [win[0].mjd])
    sra, sdec = float(eph["ra"][0]), float(eph["dec"][0])
    # the field centre is offset from Sedna by a fixed 1.3' so the search is not centred on the answer
    r, m = run(f"Sedna (visit {v + 1})", sra + 1.3 / 60 / np.cos(np.radians(sdec)), sdec - 0.7 / 60, v, (1, 2, 3), truth=(sra, sdec))
    results.append(r); maps.append((f"Sedna, visit {v + 1}", m))

(OUT / "p18_field_search.json").write_text(json.dumps(results, indent=1))

import matplotlib  # noqa: E402
matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

fig, axes = plt.subplots(1, len(maps), figsize=(4.2 * len(maps), 4.4), facecolor="#020305")
for ax, (title, mp), res in zip(np.atleast_1d(axes), maps, results):
    shown = np.where(np.isfinite(mp), mp, np.nan)
    ax.imshow(shown, origin="lower", cmap="magma", vmin=0, vmax=10, interpolation="nearest")
    for p in res["candidates"][:5]:
        ax.add_patch(plt.Circle((p["x"], p["y"]), 3, fill=False, color="#8FB6C9", lw=1))
        ax.text(p["x"] + 4, p["y"] + 3, f"{p['snr']:.0f}σ {p['distance_au']:.0f} au", color="#ECEEF2", fontsize=7)
    if res["known_body"]:
        kb = res["known_body"]
        ax.plot(kb["x"], kb["y"], "+", color="#E0694A", ms=12)
    ax.set_title(f"{title}: best S/N over all distances", color="#ECEEF2", fontsize=9)
    ax.axis("off")
fig.tight_layout()
fig.savefig(OUT / "p18_field_search.png", dpi=110, facecolor="#020305")
print("\nwrote", OUT / "p18_field_search.json", OUT / "p18_field_search.png")
