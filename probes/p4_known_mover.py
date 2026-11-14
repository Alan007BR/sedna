"""Decision test 1: does a known distant object show up in single SPHEREx exposures
at the position JPL Horizons predicts for SPHEREx as the observer?

Usage: python probes/p4_known_mover.py NAME HORIZONS_ID APPROX_RA APPROX_DEC

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
from astroquery.jplhorizons import Horizons

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "service"))
from sedna.archive import index, s3  # noqa: E402

name, ident, ra0, dec0 = sys.argv[1], sys.argv[2], float(sys.argv[3]), float(sys.argv[4])
HALF = 12  # cutout half-size in pixels
OBSERVER = "500@-163182"

recs = index.load()
cands = index.near(recs, ra0, dec0, radius=3.2)
print(f"index: {len(recs)} exposures; {len(cands)} within 3.2 deg of the approximate position")

# exact apparent position at each exposure mid-time, seen from SPHEREx
positions = {}
jds = [r["mjd"] + 2400000.5 for r in cands]
for i in range(0, len(jds), 40):
    chunk = jds[i : i + 40]
    eph = Horizons(id=ident, location=OBSERVER, epochs=chunk).ephemerides(quantities="1,20")
    for jd, row in zip(chunk, eph):
        positions[round(jd, 6)] = (float(row["RA"]), float(row["DEC"]), float(row["delta"]))

hits = []
for r in cands:
    ra, dec, delta = positions[round(r["mjd"] + 2400000.5, 6)]
    pix = index.pixel_of(r, ra, dec)
    if pix and HALF + 2 < pix[0] < 2040 - HALF - 2 and HALF + 2 < pix[1] < 2040 - HALF - 2:
        hits.append({**r, "ra": ra, "dec": dec, "delta": delta, "x": pix[0], "y": pix[1]})
print(f"{len(hits)} exposures contain the predicted position")


def cut(h):
    xi, yi = int(round(h["x"])), int(round(h["y"]))
    rows = s3.read_rows(h["key"], h["data_start"], yi - HALF, yi + HALF + 1)
    return rows[:, xi - HALF : xi + HALF + 1]


t0 = time.time()
with ThreadPoolExecutor(16) as pool:
    cuts = list(pool.map(cut, hits))
dt = time.time() - t0
print(f"read {len(cuts)} cutouts by range request in {dt:.1f} s ({dt / max(len(cuts), 1):.2f} s each)")

results = []
for h, c in zip(hits, cuts):
    med = np.nanmedian(c)
    mad = 1.4826 * np.nanmedian(np.abs(c - med))
    core = c[HALF - 1 : HALF + 2, HALF - 1 : HALF + 2]
    peak = float(np.nanmax(core))
    snr = (peak - med) / mad if mad > 0 else float("nan")
    results.append({"obsid": h["obsid"], "mjd": h["mjd"], "x": h["x"], "y": h["y"], "delta": h["delta"], "snr": float(snr)})
    print(f"  {h['obsid']}  mjd {h['mjd']:.3f}  pix ({h['x']:.0f},{h['y']:.0f})  peak-snr {snr:6.1f}")

snrs = np.array([r["snr"] for r in results])
print(f"\n{name}: detected (snr>5) in {(snrs > 5).sum()} of {len(snrs)} exposures; median snr {np.nanmedian(snrs):.1f}")

n = len(cuts)
cols = min(n, 10)
rows_n = -(-n // cols)
fig, axes = plt.subplots(rows_n, cols, figsize=(1.5 * cols, 1.6 * rows_n), squeeze=False)
for ax in axes.ravel():
    ax.axis("off")
for ax, c, r in zip(axes.ravel(), cuts, results):
    med = np.nanmedian(c)
    mad = 1.4826 * np.nanmedian(np.abs(c - med)) or 1
    ax.imshow(c, origin="lower", cmap="gray", vmin=med - 2 * mad, vmax=med + 12 * mad, interpolation="nearest")
    ax.plot([HALF - 5, HALF - 2], [HALF, HALF], color="#e0694a", lw=0.8)
    ax.plot([HALF + 2, HALF + 5], [HALF, HALF], color="#e0694a", lw=0.8)
    ax.set_title(f"{r['mjd']:.2f}\nsnr {r['snr']:.0f}", fontsize=6)
fig.suptitle(f"{name}: single SPHEREx D1 exposures centred on the JPL Horizons position", fontsize=9)
fig.tight_layout()
out = Path(__file__).with_name(f"p4_{name.lower()}.png")
fig.savefig(out, dpi=130)
Path(__file__).with_name(f"p4_{name.lower()}.json").write_text(json.dumps(results, indent=1))
print("saved", out)
