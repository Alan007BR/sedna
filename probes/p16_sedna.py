"""Can SPHEREx see 90377 Sedna if we stack every exposure along its known track?

Sedna (V about 20.8 at 83 au) should be far below one exposure's reach. Near
quadrature, where SPHEREx looks, it moves only a few pixels within a visit, so the
stars around it cannot be rejected by stacking that visit alone. This probe:

1. asks JPL Horizons where Sedna was, seen from SPHEREx, at every exposure covering it;
2. builds, for each visit and detector, an image of the static sky over Sedna's path
   from exposures of the same patch taken in other visits, months away, when Sedna
   was degrees off (median, each exposure in units of its own noise);
3. resamples every Sedna exposure on the same large grid, subtracts that static sky,
   and cuts a stamp centred on Sedna at the exposure's instant;
4. stacks the stamps with outlier rejection, per visit and for all visits.

Control: the same stamps cut along 200 tracks with Sedna's motion, shifted 1-4
arcmin in random directions, give the spread of "detections" where nothing is.

Code written with AI assistance (Claude); see AI_USAGE.md.
"""
import json
import sys
import warnings
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from scipy.ndimage import map_coordinates

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "service"))
warnings.filterwarnings("ignore")
from sedna.archive import horizons  # noqa: E402
from sedna.archive.cutout import read_cutout  # noqa: E402
from sedna.archive.skyindex import SkyIndex  # noqa: E402
from sedna.focus_service import body_visits  # noqa: E402
from sedna.science.stack import Grid, resample, robust_mean  # noqa: E402

IDENT = "90377"
BIG = 121  # static-sky grid per visit, 12.4 arcmin: Sedna's path within a visit plus the control offsets
STAMP = 21
CONTROLS = 200
rng = np.random.default_rng(3)

ix = SkyIndex.load()
visits = body_visits(ix, IDENT, detectors=(1, 2, 3, 4, 5, 6))
hits = [h for v in visits for h in v]
eph = horizons.at_times(IDENT, [h.mjd for h in hits])
track = {id(h): (float(eph["ra"][i]), float(eph["dec"][i])) for i, h in enumerate(hits)}
print(f"Sedna: {len(visits)} visits, {len(hits)} detector images, {np.median(eph['delta']):.1f} au")
angles = rng.uniform(0, 2 * np.pi, CONTROLS)
radii = rng.uniform(60, 240, CONTROLS)  # arcsec


def normalised(cut):
    f = np.isfinite(cut.image)
    if f.mean() < 0.5:
        return None
    med = np.median(cut.image[f])
    noise = 1.4826 * np.median(np.abs(cut.image[f] - med))
    if not noise > 0:
        return None
    cut.image = ((cut.image - med) / noise).astype(np.float32)
    return cut


def on_grid(h, grid, centre):
    try:
        cut = read_cutout(h.key, *centre, half=int(BIG * 0.75) + 4)
    except Exception:
        return None
    if cut is None or normalised(cut) is None:
        return None
    return resample(cut, *grid.sky())


visit_data = []
for vi, visit in enumerate(visits):
    pts = np.array([track[id(h)] for h in visit])
    centre = (float(np.median(pts[:, 0])), float(np.median(pts[:, 1])))
    grid = Grid(*centre, BIG)
    t0, t1 = visit[0].mjd - 20, visit[-1].mjd + 20
    others = [h for h in ix.lookup(*centre) if not (t0 <= h.mjd <= t1)]
    with ThreadPoolExecutor(24) as pool:
        sedna_planes = list(pool.map(lambda h: on_grid(h, grid, centre), visit))
        other_planes = list(pool.map(lambda h: on_grid(h, grid, centre), others))
    static = {}
    for det in range(1, 7):
        planes = [p for h, p in zip(others, other_planes) if p is not None and h.det == det]
        if len(planes) >= 3:
            static[det] = np.nanmedian(np.array(planes), axis=0)
    usable = [(h, p) for h, p in zip(visit, sedna_planes) if p is not None and h.det in static]
    print(f"visit {vi + 1}: {len(visit)} Sedna exposures ({len(usable)} usable), {len(others)} exposures of the same sky from other visits")
    visit_data.append((grid, static, usable))

c = STAMP // 2
yy, xx = np.mgrid[-c : c + 1, -c : c + 1]
rr = np.hypot(xx, yy)


def stamps_for(k):
    """Residual stamps along track k (0 is Sedna's own track), with visit and detector."""
    out = []
    for vi, (grid, static, usable) in enumerate(visit_data):
        for h, plane in usable:
            ra, dec = track[id(h)]
            if k:
                ra += radii[k - 1] * np.cos(angles[k - 1]) / 3600 / np.cos(np.radians(dec))
                dec += radii[k - 1] * np.sin(angles[k - 1]) / 3600
            px, py = (float(np.asarray(v).ravel()[0]) for v in grid.pixel_of(ra, dec))
            coords = [yy + py, xx + px]
            resid = map_coordinates(np.nan_to_num(plane - static[h.det], nan=np.nan), coords, order=1, mode="constant", cval=np.nan)
            if np.isfinite(resid).mean() > 0.8:
                out.append((vi, h.det, resid))
    return out


def snr(stack):
    if stack is None or not np.isfinite(stack).any():
        return float("nan")
    s = np.nan_to_num(stack - np.nanmedian(stack[rr > 4]))
    box = sum(np.roll(np.roll(s, dy, 0), dx, 1) for dy in (-1, 0, 1) for dx in (-1, 0, 1))
    ring = box[(rr > 4) & (rr < c - 1)]
    return float(box[c, c] / (1.4826 * np.median(np.abs(ring - np.median(ring)))))


with ThreadPoolExecutor(8) as pool:
    per_track = list(pool.map(stamps_for, range(CONTROLS + 1)))

sets = [(f"visit {v + 1}", (lambda vi, v=v: vi == v)) for v in range(len(visits))] + [("all visits", lambda vi: True)]
dets = {"D1-D3": (1, 2, 3), "D4-D6": (4, 5, 6), "all": (1, 2, 3, 4, 5, 6)}
report = {"visits": len(visits), "distance_au": round(float(np.median(eph["delta"])), 1), "results": []}
stacks = {}
for sname, pick in sets:
    for dname, dd in dets.items():
        def stack_for(k):
            planes = [r for vi, d, r in per_track[k] if pick(vi) and d in dd]
            return (robust_mean(np.array(planes)) if len(planes) >= 3 else None), len(planes)

        s0, n = stack_for(0)
        stacks[(sname, dname)] = s0
        ctrl = np.array([v for v in (snr(stack_for(k)[0]) for k in range(1, CONTROLS + 1)) if np.isfinite(v)])
        val = snr(s0)
        res = {"set": sname, "detectors": dname, "exposures": n, "snr": round(val, 2), "control_sd": round(float(ctrl.std()), 2), "control_max": round(float(ctrl.max()), 2), "controls_at_or_above": int((ctrl >= val).sum()), "controls": len(ctrl)}
        report["results"].append(res)
        print(res)

fig, axes = plt.subplots(len(sets), 3, figsize=(8, 2.8 * len(sets)))
for i, (sname, _) in enumerate(sets):
    for j, dname in enumerate(dets):
        ax = axes[i, j]
        ax.axis("off")
        s = stacks[(sname, dname)]
        if s is not None:
            ax.imshow(s, origin="lower", cmap="gray", vmin=-0.4, vmax=1.2, interpolation="nearest")
            ax.plot([c - 4.5, c - 2], [c, c], color="#e0694a", lw=1)
            ax.plot([c + 2, c + 4.5], [c, c], color="#e0694a", lw=1)
        r = next(x for x in report["results"] if x["set"] == sname and x["detectors"] == dname)
        ax.set_title(f"{sname}, {dname}: n={r['exposures']}\nS/N {r['snr']}, controls above {r['controls_at_or_above']}/{r['controls']}", fontsize=7)
fig.suptitle("90377 Sedna in SPHEREx: static sky from other visits subtracted, stacked along the JPL Horizons track", fontsize=9)
fig.tight_layout()
fig.savefig(Path(__file__).with_suffix(".png"), dpi=110)
np.save(Path(__file__).with_name("p16_sedna_stacks.npy"), np.array([stacks[(s, "D1-D3")] if stacks[(s, "D1-D3")] is not None else np.full((STAMP, STAMP), np.nan) for s, _ in sets]))
Path(__file__).with_suffix(".json").write_text(json.dumps(report, indent=1))
print("saved")
