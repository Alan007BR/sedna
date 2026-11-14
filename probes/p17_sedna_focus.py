"""Can the distance focus find Sedna? A blind distance sweep on a body no single exposure shows.

For each visit: start from Sedna's JPL Horizons position in the visit's first exposure (as if someone clicked
where a prediction says to look), take the visit's exposures with the stars removed (static sky from other
visits, as in follow_service), and for every trial distance shift-and-stack along the track the parallax model
predicts. The S/N of each stack against distance is the focus curve. The same sweep from 100 control starting
points (1-4 arcmin away, nothing there) measures the highest peak that noise alone reaches across all
distances, which is the fair comparison, since the sweep picks its best distance.

Run from service/:  ../.venv/Scripts/python ../probes/p17_sedna_focus.py
Writes probes/p17_sedna_focus.json and probes/p17_sedna_focus.png.

Code written with AI assistance (Claude); see AI_USAGE.md.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from scipy.ndimage import map_coordinates

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "service"))
from sedna.api import index  # noqa: E402
from sedna.follow_service import STAMP, residual_visits, snr  # noqa: E402
from sedna.science import parallax  # noqa: E402
from sedna.science.focus import distance_ladder  # noqa: E402
from sedna.science.stack import robust_mean  # noqa: E402

OUT = Path(__file__).resolve().parent
CONTROLS = 100
rng = np.random.default_rng(17)
c = STAMP // 2
yy, xx = np.mgrid[-c : c + 1, -c : c + 1]
distances = distance_ladder()  # 72 log-spaced from 25 to 600 au, then "infinity"


def sweep(prepared_visit, seed_ra, seed_dec, seed_mjd):
    """S/N of the shift-and-stack at every trial distance, and the stacks."""
    usable = prepared_visit["usable"]
    grid = prepared_visit["grid"]
    mjd = np.array([h.mjd for h, _ in usable])
    earth = parallax.earth_position(mjd)
    earth0 = parallax.earth_position([seed_mjd])[0]
    ra, dec = parallax.predict_track(seed_ra, seed_dec, seed_mjd, distances, mjd, earth=earth, earth0=earth0)  # (D, T)
    curve, stacks = [], []
    for d in range(len(distances)):
        planes = []
        for t, (_, resid) in enumerate(usable):
            px, py = (float(np.asarray(q).ravel()[0]) for q in grid.pixel_of(ra[d, t], dec[d, t]))
            s = map_coordinates(resid, [yy + py, xx + px], order=1, mode="constant", cval=np.nan)
            if np.isfinite(s).mean() > 0.8:
                planes.append(s)
        stack = robust_mean(np.array(planes)) if len(planes) >= 3 else None
        stacks.append(stack)
        curve.append(snr(stack))
    return np.array(curve), stacks


idx = index()
visits, prepared, track, eph = residual_visits(idx, "90377")
report = {"body": "90377 Sedna", "distances_au": [round(float(d), 2) for d in distances[:-1]], "visits": []}
best_stamps = []
all_curves, all_ctrl = [], []
# the same control offsets in every visit, so control k can be combined across visits like Sedna
offsets = [(rng.uniform(60, 240), rng.uniform(0, 2 * np.pi)) for _ in range(CONTROLS)]
for vi, pv in enumerate(prepared):
    if len(pv["usable"]) < 8:
        continue
    first = pv["usable"][0][0]
    seed_ra, seed_dec = track[id(first)]
    i_first = next(i for i, h in enumerate([h for v in visits for h in v]) if h is first)
    truth = float(eph["delta"][i_first])
    curve, stacks = sweep(pv, seed_ra, seed_dec, first.mjd)
    finite = curve[:-1]
    best = int(np.nanargmax(finite))
    above = np.flatnonzero(finite >= finite[best] / 2)
    # controls: the same sweep from empty starting points; keep each one's highest peak over all distances
    ctrl_peaks, ctrl_curves = [], []
    for k in range(CONTROLS):
        r, a = offsets[k]
        cra = seed_ra + r * np.cos(a) / 3600 / np.cos(np.radians(seed_dec))
        cdec = seed_dec + r * np.sin(a) / 3600
        cc, _ = sweep(pv, cra, cdec, first.mjd)
        ctrl_curves.append(cc[:-1])
        if np.isfinite(cc[:-1]).any():
            ctrl_peaks.append(float(np.nanmax(cc[:-1])))
    ctrl_peaks = np.array(ctrl_peaks)
    all_curves.append(finite)
    all_ctrl.append(np.array(ctrl_curves))
    entry = {
        "visit": vi + 1,
        "exposures": len(pv["usable"]),
        "days": round(float(pv["usable"][-1][0].mjd - first.mjd), 2),
        "jpl_distance_au": round(truth, 2),
        "best_distance_au": round(float(distances[best]), 2),
        "half_range_au": [round(float(distances[above.min()]), 1), round(float(distances[above.max()]), 1)],
        "peak_snr": round(float(finite[best]), 2),
        "snr_at_jpl_distance": round(float(np.interp(truth, distances[:-1], finite)), 2),
        "snr_at_infinity": round(float(curve[-1]), 2) if np.isfinite(curve[-1]) else None,
        "controls": int(len(ctrl_peaks)),
        "controls_peak_at_or_above": int((ctrl_peaks >= finite[best]).sum()),
        "controls_peak_max": round(float(ctrl_peaks.max()), 2) if len(ctrl_peaks) else None,
        "controls_peak_median": round(float(np.median(ctrl_peaks)), 2) if len(ctrl_peaks) else None,
        "curve": [None if not np.isfinite(v) else round(float(v), 2) for v in finite],
    }
    report["visits"].append(entry)
    best_stamps.append((vi + 1, stacks[best], stacks[-1], truth, float(distances[best])))
    print(f"visit {vi + 1}: {entry['exposures']} exposures over {entry['days']} d | best {entry['best_distance_au']} au "
          f"(half {entry['half_range_au']}) S/N {entry['peak_snr']} | JPL {entry['jpl_distance_au']} au, S/N there {entry['snr_at_jpl_distance']} | "
          f"infinity {entry['snr_at_infinity']} | controls >= peak: {entry['controls_peak_at_or_above']}/{entry['controls']} (max {entry['controls_peak_max']}, median {entry['controls_peak_median']})")

# all visits together: Stouffer's sum of the per-visit S/N at each distance (the distance is the same in all)
def combine(curves):
    arr = np.array(curves, dtype=float)
    return np.nansum(arr, axis=0) / np.sqrt(np.sum(np.isfinite(arr), axis=0).clip(min=1))

comb = combine(all_curves)
cb = int(np.nanargmax(comb))
ctrl_comb = np.array([combine([c[k] for c in all_ctrl]) for k in range(CONTROLS)])
ctrl_comb_peaks = np.nanmax(ctrl_comb, axis=1)
above = np.flatnonzero(comb >= comb[cb] / 2)
report["combined"] = {
    "best_distance_au": round(float(distances[cb]), 2),
    "half_range_au": [round(float(distances[above.min()]), 1), round(float(distances[above.max()]), 1)],
    "peak_snr": round(float(comb[cb]), 2),
    "controls_peak_at_or_above": int((ctrl_comb_peaks >= comb[cb]).sum()),
    "controls_peak_max": round(float(np.nanmax(ctrl_comb_peaks)), 2),
    "controls_peak_median": round(float(np.nanmedian(ctrl_comb_peaks)), 2),
    "curve": [None if not np.isfinite(v) else round(float(v), 2) for v in comb],
}
c_ = report["combined"]
print(f"all visits: best {c_['best_distance_au']} au (half {c_['half_range_au']}) S/N {c_['peak_snr']} | controls >= peak: {c_['controls_peak_at_or_above']}/{CONTROLS} (max {c_['controls_peak_max']}, median {c_['controls_peak_median']})")
(OUT / "p17_sedna_focus.json").write_text(json.dumps(report, indent=1))

import matplotlib  # noqa: E402
matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

fig = plt.figure(figsize=(12, 3.2 + 2.6 * len(best_stamps)), facecolor="#020305")
gs = fig.add_gridspec(1 + len(best_stamps), 3, height_ratios=[1.3] + [1] * len(best_stamps))
ax = fig.add_subplot(gs[0, :])
for e in report["visits"]:
    ax.plot(report["distances_au"], [np.nan if v is None else v for v in e["curve"]], label=f"visit {e['visit']}")
ax.plot(report["distances_au"], [np.nan if v is None else v for v in report["combined"]["curve"]], color="#ECEEF2", lw=2, label="all visits")
ax.axvline(report["visits"][0]["jpl_distance_au"], color="#8FB6C9", ls="--", lw=1, label="JPL Horizons")
ax.set_xscale("log"); ax.set_xlabel("trial distance from SPHEREx (au)", color="#B3B8C4"); ax.set_ylabel("S/N of the stack", color="#B3B8C4")
ax.tick_params(colors="#7E8595"); ax.set_facecolor("#020305"); ax.legend(facecolor="#0b0d12", labelcolor="#ECEEF2", fontsize=8)
ax.set_ylim(-4, 12)
ax.set_title("Distance focus on 90377 Sedna, started from one position per visit", color="#ECEEF2", fontsize=10)
for k, (v, best_stack, inf_stack, truth, bestd) in enumerate(best_stamps):
    for j, (img, title) in enumerate([(inf_stack, "no shift (infinity)"), (best_stack, f"best: {bestd:.0f} au (JPL {truth:.0f})")]):
        a = fig.add_subplot(gs[1 + k, j])
        if img is not None:
            lo, hi = np.nanpercentile(img, [5, 99.5])
            a.imshow(img, origin="lower", cmap="gray", vmin=lo, vmax=hi, interpolation="nearest")
        a.set_title(f"visit {v}: {title}", color="#ECEEF2", fontsize=9); a.axis("off")
fig.tight_layout()
fig.savefig(OUT / "p17_sedna_focus.png", dpi=110, facecolor="#020305")
print("wrote", OUT / "p17_sedna_focus.json", OUT / "p17_sedna_focus.png")
