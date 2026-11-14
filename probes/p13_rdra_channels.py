"""R Draconis at matched wavelength: a light curve per spectral channel.

SPHEREx's filter varies along each detector's y axis, so the row where a star
falls sets its wavelength (17 channels of about 120 rows per detector). Comparing
exposures from different channels mixes spectrum with time, which is fatal for a
Mira whose spectrum is full of molecular bands. Here every exposure is measured on
its own, grouped by (detector, channel), and each channel is compared only with
itself. Reference stars sit within a few arcminutes, so they share the channel.

Code written with AI assistance (Claude); see AI_USAGE.md.
"""
import json
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from astropy.time import Time

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "service"))
from sedna.archive import gaia  # noqa: E402
from sedna.archive.cutout import read_cutout  # noqa: E402
from sedna.archive.skyindex import SkyIndex  # noqa: E402
from sedna.science.astrometry import star_position  # noqa: E402
from sedna.science.measure import annulus_flux, centroid  # noqa: E402
from sedna.science.stack import Grid, resample  # noqa: E402
from sedna.targets import TARGETS  # noqa: E402

T = TARGETS["rdra"]
FOV = 8.0
ROWS_PER_CHANNEL = 2040 / 17
WING = (3.0, 7.0)
OUT = Path(__file__).resolve().parents[1] / "docs" / "targets"

ix = SkyIndex.load()
ra_t, dec_t = (float(v[0]) for v in star_position(T["ra"], T["dec"], T["pmRa"] * 1000, T["pmDec"] * 1000, None, T["epoch"], [61000.0]))
size = int(round(FOV * 60 / 6.15)) | 1
grid = Grid(ra_t, dec_t, size)
gra, gdec = grid.sky()
tx, ty = (float(v) for v in grid.pixel_of(ra_t, dec_t))
refs = [s for s in gaia.cone(ra_t, dec_t, FOV / 60 / 2 * 1.3, g_max=15.5) if s["g"] > 10.5]
refs = [s for s in refs if np.hypot(*(np.array(grid.pixel_of(s["ra"], s["dec"])) - (tx, ty))) > 10]
ref_xy = {s["id"]: tuple(float(v) for v in grid.pixel_of(s["ra"], s["dec"])) for s in refs}
hits = ix.lookup(ra_t, dec_t)
print(f"R Draconis: {len(hits)} exposures, {len(refs)} reference stars")


def measure(h):
    try:
        c = read_cutout(h.key, ra_t, dec_t, half=int(np.ceil(size * 0.75)) + 2)
    except Exception:
        return None
    if c is None:
        return None
    img = resample(c, gra, gdec)
    if np.isfinite(img).mean() < 0.5:
        return None
    img = img - np.nanmedian(img)
    yy, xx = np.indices(img.shape)
    r = np.hypot(xx - tx, yy - ty)
    ring = img[(r >= 10) & (r < 14)]
    bg = float(np.nanmedian(ring))
    wing, _ = annulus_flux(img, tx, ty, *WING, bg)
    core_nan = int((~np.isfinite(img[r <= 1.5])).sum())
    refs_flux = {}
    for sid, (px, py) in ref_xy.items():
        m = centroid(img, px, py)
        if m.ok and m.saturated == 0 and np.isfinite(m.snr) and m.snr > 15:
            refs_flux[sid] = m.flux
    return {"mjd": c.mjd, "det": c.det, "channel": int(c.y // ROWS_PER_CHANNEL), "row": c.y, "wing": wing, "core_nan": core_nan, "refs": refs_flux}


t0 = time.time()
with ThreadPoolExecutor(24) as pool:
    meas = [m for m in pool.map(measure, hits) if m is not None and np.isfinite(m["wing"]) and m["wing"] > 0]
print(f"measured {len(meas)} exposures in {time.time() - t0:.0f} s")

# per channel: normalise each exposure by its reference stars, then by the channel's median
curves = {}
for m in meas:
    curves.setdefault((m["det"], m["channel"]), []).append(m)
points = []
for (det, ch), ms in curves.items():
    if len(ms) < 6 or max(x["mjd"] for x in ms) - min(x["mjd"] for x in ms) < 60:
        continue
    # each reference star's typical flux in this channel, then each exposure's median ratio to it
    typical = {}
    for x in ms:
        for i, v in x["refs"].items():
            typical.setdefault(i, []).append(v)
    typical = {i: float(np.median(v)) for i, v in typical.items() if len(v) >= 0.5 * len(ms)}
    ms = [x for x in ms if sum(i in typical for i in x["refs"]) >= 2]
    if len(ms) < 6 or max(x["mjd"] for x in ms) - min(x["mjd"] for x in ms) < 60:
        continue
    for x in ms:
        x["calib"] = float(np.median([x["refs"][i] / typical[i] for i in x["refs"] if i in typical]))
    rel = np.array([x["wing"] / x["calib"] for x in ms])
    med = np.median(rel)
    for x, v in zip(ms, rel):
        points.append({"det": det, "channel": ch, "mjd": x["mjd"], "delta_mag": float(-2.5 * np.log10(v / med)), "core_nan": x["core_nan"]})
print(f"{len(points)} points in {len({(p['det'], p['channel']) for p in points})} channels with at least 6 exposures over 60+ days")

# does the curve follow the Mira's period? fold on the VSX period and compare with a constant
period, jd_max = T["periodDays"], T["maxEpochJd"]
for det in range(1, 7):
    pd = [p for p in points if p["det"] == det]
    if len(pd) < 10:
        continue
    t = np.array([p["mjd"] + 2400000.5 for p in pd])
    y = np.array([p["delta_mag"] for p in pd])
    phase = 2 * np.pi * ((t - jd_max) / period)
    A = np.column_stack([np.ones_like(t), np.cos(phase), np.sin(phase)])
    coef, *_ = np.linalg.lstsq(A, y, rcond=None)
    resid = y - A @ coef
    amp = float(np.hypot(coef[1], coef[2]))
    lag = float((np.degrees(np.arctan2(-coef[2], -coef[1])) % 360) / 360 * period)  # days after the visual maximum when brightest
    print(f"D{det}: {len(pd)} points; sine at the VSX period: full amplitude {2 * amp:.2f} mag, brightest {lag:.0f} days after the visual maximum; scatter {np.std(y):.2f} -> {np.std(resid):.2f} mag after the fit")

(OUT / "rdra_channels.json").write_text(json.dumps({"points": points, "period": period, "maxEpochJd": jd_max}, indent=0))
fig, ax = plt.subplots(figsize=(9, 3.6))
colors = ["#6fa8ff", "#3ec7b0", "#b6d65a", "#f2c14e", "#f08a4b", "#e05f8f"]
for det in range(1, 7):
    pd = [p for p in points if p["det"] == det]
    if pd:
        ax.plot([Time(p["mjd"], format="mjd").datetime for p in pd], [p["delta_mag"] for p in pd], "o", ms=2.5, alpha=0.7, color=colors[det - 1], label=f"D{det}")
lo = min(p["mjd"] for p in points) + 2400000.5
hi = max(p["mjd"] for p in points) + 2400000.5
n = np.ceil((lo - 60 - jd_max) / period)
while jd_max + n * period < hi + 60:
    ax.axvline(Time(jd_max + n * period - 2400000.5, format="mjd").datetime, color="gray", ls=":", lw=1)
    n += 1
ax.invert_yaxis()
ax.set_ylabel("change (mag), each channel vs itself")
ax.set_title("R Draconis: brightness from the unsaturated wings, each spectral channel compared only with itself", fontsize=9)
ax.text(0.01, 0.03, "dotted: predicted visual maxima (AAVSO VSX)", transform=ax.transAxes, fontsize=7, color="gray")
ax.legend(fontsize=7, ncol=6, loc="upper right")
fig.autofmt_xdate()
fig.tight_layout()
fig.savefig(OUT / "rdra_channels.png", dpi=140)
print("saved", OUT / "rdra_channels.png")
