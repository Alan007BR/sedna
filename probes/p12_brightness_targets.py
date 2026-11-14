"""Target matrix, brightness targets: can SPHEREx follow a saturated variable star?

Saturated pixels are NaN in SPHEREx Level-2 images, so the core of a bright star
is missing. Its wings (an annulus a few pixels out) are not, and their flux scales
with the star's total brightness. Each frame's wing flux is compared with the same
detector's first frame, after correcting by the median flux change of unsaturated
Gaia stars in the same frames (the calibration check).

Usage: python probes/p12_brightness_targets.py rwaur|rdra [--bins DAYS]

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
from sedna.science.astrometry import star_position  # noqa: E402
from sedna.science.measure import annulus_flux, centroid  # noqa: E402
from sedna.science.stack import build_stack, build_timebins  # noqa: E402
from sedna.targets import TARGETS  # noqa: E402

key = sys.argv[1]
bins = float(sys.argv[sys.argv.index("--bins") + 1]) if "--bins" in sys.argv else None
FOV = 8.0
T = TARGETS[key]
OUT = Path(__file__).resolve().parents[1] / "docs" / "targets"
OUT.mkdir(parents=True, exist_ok=True)
WING = (3.0, 7.0)  # annulus radii in pixels (18" to 43")

ix = SkyIndex.load()
ra_t, dec_t = (float(v[0]) for v in star_position(T["ra"], T["dec"], T["pmRa"] * 1000, T["pmDec"] * 1000, None, T["epoch"], [61000.0]))
t0 = time.time()
stack = build_timebins(ix, ra_t, dec_t, fov_arcmin=FOV, bin_days=bins) if bins else build_stack(ix, ra_t, dec_t, fov_arcmin=FOV)
print(f"{T['name']}: {stack.n_read}/{stack.n_requested} cutouts, {len(stack.frames)} frames ({'bins of %g days' % bins if bins else 'per visit'}), {time.time() - t0:.0f} s")

stars = gaia.cone(ra_t, dec_t, FOV / 60 / 2 * 1.3, g_max=15.5)
refs = [s for s in stars if s["g"] and s["g"] > 10.5 and np.hypot(stack.grid.pixel_of(s["ra"], s["dec"])[0] - stack.grid.pixel_of(ra_t, dec_t)[0], stack.grid.pixel_of(s["ra"], s["dec"])[1] - stack.grid.pixel_of(ra_t, dec_t)[1]) > 10]
print(f"Gaia DR3 reference stars (10.5 < G < 15.5, more than 10 px from the target): {len(refs)}")

tx, ty = (float(v) for v in stack.grid.pixel_of(ra_t, dec_t))
rows = []
for f in stack.frames:
    yy, xx = np.indices(f.image.shape)
    r = np.hypot(xx - tx, yy - ty)
    core_nan = int((~np.isfinite(f.image[r <= 1.5])).sum())
    ring = f.image[(r >= 10) & (r < 14)]
    bg = float(np.nanmedian(ring)) if np.isfinite(ring).any() else 0.0
    wing, used = annulus_flux(f.image, tx, ty, *WING, bg)
    ref_flux = {}
    for s in refs:
        px, py = (float(v) for v in stack.grid.pixel_of(s["ra"], s["dec"]))
        c = centroid(f.image, px, py)
        if c.ok and c.saturated == 0 and np.isfinite(c.snr) and c.snr > 15:
            ref_flux[s["id"]] = c.flux
    rows.append({"bin": f.visit, "det": f.det, "mjd": (f.mjd_start + f.mjd_end) / 2, "exposures": f.n_exposures, "core_nan": core_nan, "wing": wing, "wing_px": used, "refs": ref_flux})

# relative brightness per detector, against that detector's first usable frame
results = []
for det in range(1, 7):
    rd = sorted([r for r in rows if r["det"] == det and np.isfinite(r["wing"]) and r["wing"] > 0], key=lambda r: r["mjd"])
    if len(rd) < 2:
        continue
    base = rd[0]
    for r in rd:
        common = [i for i in r["refs"] if i in base["refs"] and base["refs"][i] > 0]
        ratios = np.array([r["refs"][i] / base["refs"][i] for i in common])
        calib = float(np.median(ratios)) if len(ratios) >= 3 else float("nan")
        calib_err = float(1.4826 * np.median(np.abs(ratios - calib)) / np.sqrt(len(ratios))) if len(ratios) >= 3 else float("nan")
        rel = r["wing"] / base["wing"] / calib if np.isfinite(calib) else float("nan")
        results.append(
            {
                "det": det,
                "mjd": r["mjd"],
                "date": Time(r["mjd"], format="mjd").iso[:10],
                "exposures": r["exposures"],
                "core_saturated_px": r["core_nan"],
                "delta_mag": float(-2.5 * np.log10(rel)) if rel > 0 else float("nan"),
                "calibration_ratio": calib,
                "calibration_error": calib_err,
                "n_refs": len(ratios),
            }
        )

print("\ndet  date        exp  core NaN  refs  calib ratio      delta mag (wings, vs first frame)")
for r in results:
    print(f" D{r['det']}  {r['date']}  {r['exposures']:3d}   {r['core_saturated_px']:3d}     {r['n_refs']:3d}   {r['calibration_ratio']:.3f}±{r['calibration_error']:.3f}   {r['delta_mag']:+.2f}")

for det in range(1, 7):
    dm = np.array([r["delta_mag"] for r in results if r["det"] == det and np.isfinite(r["delta_mag"])])
    cal = np.array([r["calibration_ratio"] for r in results if r["det"] == det and np.isfinite(r["calibration_ratio"])])
    if len(dm):
        print(f"D{det}: range of the star {np.nanmax(dm) - np.nanmin(dm):.2f} mag over {len(dm)} frames; reference stars vary by {(-2.5 * np.log10(cal)).std():.3f} mag rms")

(OUT / f"{key}.json").write_text(json.dumps({"target": key, "name": T["name"], "wing_px": WING, "frames": results}, indent=1, default=float))

fig, ax = plt.subplots(figsize=(9, 3.6))
colors = ["#6fa8ff", "#3ec7b0", "#b6d65a", "#f2c14e", "#f08a4b", "#e05f8f"]
for det in range(1, 7):
    pts = [(r["mjd"], r["delta_mag"]) for r in results if r["det"] == det and np.isfinite(r["delta_mag"])]
    if pts:
        x, y = zip(*pts)
        ax.plot([Time(v, format="mjd").datetime for v in x], y, "o-", ms=3, lw=0.8, color=colors[det - 1], label=f"D{det}")
if "periodDays" in T:
    jd0 = T["maxEpochJd"]
    lo, hi = min(r["mjd"] for r in results) + 2400000.5, max(r["mjd"] for r in results) + 2400000.5
    n = np.ceil((lo - 60 - jd0) / T["periodDays"])
    while jd0 + n * T["periodDays"] < hi + 60:
        ax.axvline(Time(jd0 + n * T["periodDays"] - 2400000.5, format="mjd").datetime, color="gray", ls=":", lw=1)
        n += 1
    ax.text(0.01, 0.03, "dotted: predicted visual maxima (AAVSO VSX period and epoch)", transform=ax.transAxes, fontsize=7, color="gray")
ax.invert_yaxis()
ax.set_ylabel("brightness change (mag, wings)")
ax.set_title(f"{T['name']}: SPHEREx brightness from the unsaturated wings, per detector", fontsize=9)
ax.legend(fontsize=7, ncol=6, loc="upper right")
fig.autofmt_xdate()
fig.tight_layout()
fig.savefig(OUT / f"{key}.png", dpi=140)
print("saved", OUT / f"{key}.png")
