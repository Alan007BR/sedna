"""Target matrix, motion targets: does SPHEREx show each star moving as its catalogue says?

For each visit and detector, measures the target's centroid on an aligned grid,
measures the registration error from unmoving Gaia DR3 stars in the same frame,
and compares the corrected motion with the catalogue prediction.

Usage: python probes/p11_motion_targets.py barnard|epsindib|wise0855 [FOV_ARCMIN]

Code written with AI assistance (Claude); see AI_USAGE.md.
"""
import json
import sys
import time
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from astropy.time import Time

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "service"))
from sedna.archive import gaia  # noqa: E402
from sedna.archive.skyindex import SkyIndex, split_visits  # noqa: E402
from sedna.science.astrometry import julian_year, star_position  # noqa: E402
from sedna.science.measure import centroid  # noqa: E402
from sedna.science.stack import PIXEL_ARCSEC, build_stack  # noqa: E402
from sedna.targets import TARGETS  # noqa: E402

key = sys.argv[1]
fov = float(sys.argv[2]) if len(sys.argv) > 2 else 10.0
T = TARGETS[key]
OUT = Path(__file__).resolve().parents[1] / "docs" / "targets"
OUT.mkdir(parents=True, exist_ok=True)


def target_at(mjd):
    return star_position(T["ra"], T["dec"], T["pmRa"] * 1000, T["pmDec"] * 1000, T.get("parallaxMas"), T["epoch"], mjd)


ix = SkyIndex.load()
ra_guess, dec_guess = target_at([61000.0])
visits = split_visits(ix.lookup(float(ra_guess[0]), float(dec_guess[0])))
mid = float(np.mean([np.mean([h.mjd for h in v]) for v in visits]))
ra_c, dec_c = (float(v[0]) for v in target_at([mid]))
t0 = time.time()
stack = build_stack(ix, ra_c, dec_c, fov_arcmin=fov)
print(f"{T['name']}: grid {stack.grid.size} px centred on the {Time(mid, format='mjd').iso[:10]} position; {stack.n_read}/{stack.n_requested} cutouts, {len(stack.frames)} frames, {time.time() - t0:.0f} s")

stars = gaia.cone(ra_c, dec_c, fov / 60 / 2 * 1.3, g_max=16.0)
target_id = T.get("source", "").split()[2] if T.get("source", "").startswith("Gaia DR3") else None
refs = [s for s in stars if s["id"] != target_id and s["g"] and s["g"] > 12.0 and np.hypot(s["pmRa"] or 0, s["pmDec"] or 0) < 30]
print(f"Gaia DR3: {len(stars)} stars with G < 16 in the field, {len(refs)} used as unmoving references (12 < G < 16, motion < 30 mas/yr)")

rows = []
for f in stack.frames:
    m = (f.mjd_start + f.mjd_end) / 2
    # registration: unmoving reference stars, measured minus predicted
    offs = []
    for s in refs:
        ra_s, dec_s = star_position(s["ra"], s["dec"], s["pmRa"], s["pmDec"], s["parallax"], gaia.REF_EPOCH, [m])
        px, py = stack.grid.pixel_of(float(ra_s[0]), float(dec_s[0]))
        tx, ty = stack.grid.pixel_of(*(float(v[0]) for v in target_at([m])))
        if np.hypot(px - tx, py - ty) < 5:
            continue
        c = centroid(f.image, float(px), float(py))
        if c.ok and c.saturated == 0 and np.isfinite(c.snr) and c.snr > 10:
            offs.append((c.x - px, c.y - py))
    offs = np.array(offs)
    if len(offs) >= 3:
        reg = np.median(offs, axis=0)
        scatter = 1.4826 * np.median(np.abs(offs - reg), axis=0)
    else:
        reg, scatter = np.array([np.nan, np.nan]), np.array([np.nan, np.nan])
    px, py = stack.grid.pixel_of(*(float(v[0]) for v in target_at([m])))
    c = centroid(f.image, float(px), float(py))
    # blind check: start from the grid centre for every visit, with no knowledge of the motion
    centre = (stack.grid.size - 1) / 2
    cb = centroid(f.image, centre, centre, search=2.5)
    rows.append(
        {
            "visit": f.visit,
            "det": f.det,
            "mjd": m,
            "date": Time(m, format="mjd").iso[:10],
            "exposures": f.n_exposures,
            "pred_x": float(px),
            "pred_y": float(py),
            "meas_x": c.x,
            "meas_y": c.y,
            "snr": c.snr,
            "saturated": c.saturated,
            "ok": c.ok,
            "reg_dx": float(reg[0]),
            "reg_dy": float(reg[1]),
            "reg_scatter": float(np.hypot(*scatter)) if np.isfinite(scatter).all() else float("nan"),
            "n_refs": int(len(offs)),
            "blind_x": cb.x,
            "blind_y": cb.y,
        }
    )

print("\nvisit det date        exp  S/N   sat  refs  reg(dx,dy) px   target - catalogue (px, after registration)")
for r in rows:
    res = (r["meas_x"] - r["reg_dx"] - r["pred_x"], r["meas_y"] - r["reg_dy"] - r["pred_y"])
    r["res_x"], r["res_y"] = float(res[0]), float(res[1])
    print(
        f"  {r['visit']}   D{r['det']} {r['date']}  {r['exposures']:3d} {r['snr']:5.0f}  {r['saturated']:3d}  {r['n_refs']:3d}   ({r['reg_dx']:+.2f},{r['reg_dy']:+.2f})±{r['reg_scatter']:.2f}"
        f"   ({res[0]:+.2f}, {res[1]:+.2f})"
    )

# motion between the first and last visit, per detector, in arcsec
print("\nmotion first -> last visit (arcsec; east = +x on sky is -x on the grid)")
summary = []
for det in range(1, 7):
    rd = sorted([r for r in rows if r["det"] == det and r["ok"] and np.isfinite(r["reg_dx"])], key=lambda r: r["mjd"])
    if len(rd) < 2:
        continue
    a, b = rd[0], rd[-1]
    meas = np.array([(b["meas_x"] - b["reg_dx"]) - (a["meas_x"] - a["reg_dx"]), (b["meas_y"] - b["reg_dy"]) - (a["meas_y"] - a["reg_dy"])])
    pred = np.array([b["pred_x"] - a["pred_x"], b["pred_y"] - a["pred_y"]])
    err = np.hypot(a["reg_scatter"], b["reg_scatter"]) / max(1, np.sqrt(min(a["n_refs"], b["n_refs"])))
    blind = np.array([(b["blind_x"] - b["reg_dx"]) - (a["blind_x"] - a["reg_dx"]), (b["blind_y"] - b["reg_dy"]) - (a["blind_y"] - a["reg_dy"])])
    item = {
        "det": det,
        "from": a["date"],
        "to": b["date"],
        "years": float(julian_year(b["mjd"]) - julian_year(a["mjd"])),
        "predicted_arcsec": float(np.hypot(*pred) * PIXEL_ARCSEC),
        "measured_arcsec": float(np.hypot(*meas) * PIXEL_ARCSEC),
        "difference_arcsec": float(np.hypot(*(meas - pred)) * PIXEL_ARCSEC),
        "measured_blind_arcsec": float(np.hypot(*blind) * PIXEL_ARCSEC),
        "registration_error_arcsec": float(err * PIXEL_ARCSEC),
        "angle_error_deg": float(np.degrees(np.arctan2(meas[1], meas[0]) - np.arctan2(pred[1], pred[0]))),
        "snr_min": float(min(a["snr"], b["snr"])),
        "saturated": int(max(a["saturated"], b["saturated"])),
    }
    item["angle_error_deg"] = (item["angle_error_deg"] + 180) % 360 - 180
    summary.append(item)
    print(
        f"  D{det} {item['from']} -> {item['to']} ({item['years']:.2f} yr): predicted {item['predicted_arcsec']:5.2f}\"  measured {item['measured_arcsec']:5.2f}\"  "
        f"(blind start {item['measured_blind_arcsec']:5.2f}\")  difference {item['difference_arcsec']:4.2f}\"  direction off {item['angle_error_deg']:+5.0f} deg  registration ±{item['registration_error_arcsec']:.2f}\"  min S/N {item['snr_min']:.0f}  sat {item['saturated']}"
    )

(OUT / f"{key}.json").write_text(json.dumps({"target": key, "name": T["name"], "fov": fov, "center": [ra_c, dec_c], "frames": rows, "motion": summary}, indent=1, default=float))

# montage: each visit in the detector where the target is cleanest, plus the difference
usable = [s for s in summary if s["saturated"] == 0] or summary
best_det = max(usable, key=lambda s: s["snr_min"])["det"] if usable else 2
frames = sorted([f for f in stack.frames if f.det == best_det], key=lambda f: f.visit)
half = 9
cx, cy = (stack.grid.size - 1) / 2, (stack.grid.size - 1) / 2
cols = len(frames) + 1
fig, axes = plt.subplots(1, cols, figsize=(2.3 * cols, 2.6))
vals = np.concatenate([f.image[int(cy) - half : int(cy) + half + 1, int(cx) - half : int(cx) + half + 1].ravel() for f in frames])
lo, hi = np.nanpercentile(vals, [5, 99.7])
for ax, f in zip(axes, frames):
    sub = f.image[int(cy) - half : int(cy) + half + 1, int(cx) - half : int(cx) + half + 1]
    ax.imshow(sub, origin="lower", cmap="gray", vmin=lo, vmax=hi, interpolation="nearest", extent=(int(cx) - half - 0.5, int(cx) + half + 0.5, int(cy) - half - 0.5, int(cy) + half + 0.5))
    r = next(r for r in rows if r["visit"] == f.visit and r["det"] == best_det)
    ax.plot(r["pred_x"], r["pred_y"], "+", color="#e0694a", ms=10, mew=1)
    ax.set_title(f"{r['date']}  n={f.n_exposures}", fontsize=7)
    ax.invert_xaxis()  # east to the left
    ax.axis("off")
if len(frames) >= 2:
    d = frames[-1].image - frames[0].image
    sub = d[int(cy) - half : int(cy) + half + 1, int(cx) - half : int(cx) + half + 1]
    lim = np.nanpercentile(np.abs(sub), 99.5) or 1
    axes[-1].imshow(sub, origin="lower", cmap="RdBu_r", vmin=-lim, vmax=lim, interpolation="nearest")
    axes[-1].invert_xaxis()
    axes[-1].set_title("last minus first", fontsize=7)
axes[-1].axis("off")
fig.suptitle(f"{T['name']}, SPHEREx D{best_det}: north up, east left; + = catalogue position at each date", fontsize=8)
fig.tight_layout()
fig.savefig(OUT / f"{key}.png", dpi=140)
print("saved", OUT / f"{key}.png")
