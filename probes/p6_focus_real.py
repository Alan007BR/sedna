"""Decision test 2b: the distance focus on real SPHEREx pixels.

Seeds the model on the object's position in ONE exposure, then for each trial
distance shifts every other exposure to where the object would be and
median-stacks. If the idea works, the stack is sharpest near the true distance.

Usage: python probes/p6_focus_real.py NAME HORIZONS_ID APPROX_RA APPROX_DEC

Code written with AI assistance (Claude); see AI_USAGE.md.
"""
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from astroquery.jplhorizons import Horizons
from scipy.ndimage import map_coordinates

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "service"))
from sedna.archive import index, s3  # noqa: E402
from sedna.science import parallax  # noqa: E402

name, ident, ra0, dec0 = sys.argv[1], sys.argv[2], float(sys.argv[3]), float(sys.argv[4])
OBSERVER = "500@-163182"
MARGIN = 70  # pixels read around the true position, enough for wrong distances
HALF = 7  # stamp half-size
WINDOW_DAYS = 6.0

recs = index.near(index.load(), ra0, dec0, radius=3.2)
jds = [r["mjd"] + 2400000.5 for r in recs]
truth = {}
for i in range(0, len(jds), 40):
    chunk = jds[i : i + 40]
    eph = Horizons(id=ident, location=OBSERVER, epochs=chunk).ephemerides(quantities="1,20")
    for jd, row in zip(chunk, eph):
        truth[round(jd, 6)] = (float(row["RA"]), float(row["DEC"]), float(row["delta"]))

hits = []
for r in recs:
    ra, dec, delta = truth[round(r["mjd"] + 2400000.5, 6)]
    pix = index.pixel_of(r, ra, dec)
    if pix:
        hits.append({**r, "ra": ra, "dec": dec, "delta": delta, "x": pix[0], "y": pix[1]})
hits.sort(key=lambda h: h["mjd"])
# keep the densest window of exposures
best = max(hits, key=lambda h: sum(abs(o["mjd"] - h["mjd"]) <= WINDOW_DAYS / 2 for o in hits))
hits = [h for h in hits if abs(h["mjd"] - best["mjd"]) <= WINDOW_DAYS / 2]
print(f"{name}: {len(hits)} exposures within {WINDOW_DAYS} days, mjd {hits[0]['mjd']:.2f} to {hits[-1]['mjd']:.2f}")


def load(h):
    xi, yi = int(round(h["x"])), int(round(h["y"]))
    y0, y1 = max(0, yi - MARGIN), min(2040, yi + MARGIN + 1)
    rows = s3.read_rows(h["key"], h["data_start"], y0, y1)
    x0, x1 = max(0, xi - MARGIN), min(2040, xi + MARGIN + 1)
    img = rows[:, x0:x1].astype(float)
    img -= np.nanmedian(img)
    return {"img": img, "x0": x0, "y0": y0, "wcs": index.wcs_of(h)}


t0 = time.time()
with ThreadPoolExecutor(16) as pool:
    frames = list(pool.map(load, hits))
print(f"read {len(frames)} strips of {2 * MARGIN + 1} rows in {time.time() - t0:.1f} s")

seed = hits[0]  # as if the user clicked the source in the first exposure
mjd = np.array([h["mjd"] for h in hits])
earth = parallax.earth_position(mjd)
distances = np.concatenate([np.geomspace(25, 400, 60), [1e7]])
ra_t, dec_t = parallax.predict_track(seed["ra"], seed["dec"], seed["mjd"], distances, mjd, earth=earth, earth0=earth[0])

yy, xx = np.mgrid[-HALF : HALF + 1, -HALF : HALF + 1]


def stamp(frame, ra, dec):
    x, y = frame["wcs"].all_world2pix([[ra, dec]], 0, quiet=True)[0]
    cx, cy = x - frame["x0"], y - frame["y0"]
    return map_coordinates(frame["img"], [yy + cy, xx + cx], order=1, mode="constant", cval=np.nan)


scores, stacks = [], []
for di in range(len(distances)):
    cube = np.array([stamp(f, ra_t[di, ti], dec_t[di, ti]) for ti, f in enumerate(frames)])
    med = np.nanmedian(cube, axis=0)
    ring = med[np.hypot(yy, xx) > 4]
    noise = 1.4826 * np.nanmedian(np.abs(ring - np.nanmedian(ring))) or np.nan
    scores.append((np.nanmax(med[HALF - 1 : HALF + 2, HALF - 1 : HALF + 2]) - np.nanmedian(ring)) / noise)
    stacks.append(med)
scores = np.array(scores)
k = int(np.nanargmax(scores[:-1]))
print(f"true distance {seed['delta']:.1f} au; sharpest stack at {distances[k]:.1f} au (score {scores[k]:.0f}); at infinity score {scores[-1]:.0f}")
half = scores[:-1] > scores[k] / 2
print(f"half-maximum range {distances[:-1][half].min():.0f} to {distances[:-1][half].max():.0f} au")

fig = plt.figure(figsize=(11, 4.2))
ax = fig.add_subplot(1, 2, 1)
ax.semilogx(distances[:-1], scores[:-1], color="#e0694a")
ax.axvline(seed["delta"], color="#8fb6c9", ls="--", lw=1, label=f"JPL Horizons: {seed['delta']:.1f} au")
ax.axhline(scores[-1], color="gray", ls=":", lw=1, label="no shift (infinity)")
ax.set_xlabel("trial distance (au)")
ax.set_ylabel("sharpness of the median stack (peak S/N)")
ax.set_title(f"{name}: distance focus on {len(frames)} real SPHEREx exposures")
ax.legend(fontsize=8)
picks = [int(np.argmin(np.abs(distances[:-1] - v))) for v in (30, distances[k], 120)] + [len(distances) - 1]
for j, di in enumerate(picks):
    a = fig.add_subplot(2, 4, (3 + j) if j < 2 else (5 + j))
    m = stacks[di]
    a.imshow(m, origin="lower", cmap="gray", vmin=np.nanpercentile(stacks[k], 5), vmax=np.nanmax(stacks[k]), interpolation="nearest")
    a.set_title("infinity" if di == len(distances) - 1 else f"{distances[di]:.0f} au", fontsize=8)
    a.axis("off")
fig.tight_layout()
out = Path(__file__).with_name(f"p6_focus_{name.lower()}.png")
fig.savefig(out, dpi=130)
print("saved", out)
