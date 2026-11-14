"""Where do detectors 2-6 sit relative to detector 1 in the same exposure?

Reads the six headers of several exposures and expresses each detector's centre
and orientation in detector 1's ideal (distortion-free) pixel frame. If the
offsets are stable, an index of detector 1 alone locates all six.

Code written with AI assistance (Claude); see AI_USAGE.md.
"""
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
from astropy.wcs import WCS

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "service"))
from sedna.archive import index, s3  # noqa: E402

recs = index.load()
rng = np.random.default_rng(7)
sample = [recs[i] for i in rng.choice(len(recs), 10, replace=False)]


def key_for(key: str, det: int) -> str:
    parts = key.split("/")
    parts[-2] = str(det)
    parts[-1] = parts[-1].replace("D1_spx", f"D{det}_spx")
    return "/".join(parts)


def ideal_pixel(rec, ra, dec):
    """Pixel offset from detector 1's reference pixel under a pure TAN projection."""
    w = rec["wcs"]
    ra0, dec0 = np.radians(w["CRVAL1"]), np.radians(w["CRVAL2"])
    ra, dec = np.radians(ra), np.radians(dec)
    cosc = np.sin(dec0) * np.sin(dec) + np.cos(dec0) * np.cos(dec) * np.cos(ra - ra0)
    xi = np.degrees(np.cos(dec) * np.sin(ra - ra0) / cosc)
    eta = np.degrees((np.cos(dec0) * np.sin(dec) - np.sin(dec0) * np.cos(dec) * np.cos(ra - ra0)) / cosc)
    pc = np.array([[w["PC1_1"], w["PC1_2"]], [w["PC2_1"], w["PC2_2"]]])
    return np.linalg.solve(pc, np.array([xi, eta]))


def one(rec):
    out = {}
    for det in range(1, 7):
        try:
            h = s3.read_image_header(key_for(rec["key"], det)).header
        except Exception as err:
            out[det] = repr(err)[:60]
            continue
        w = WCS(h)
        c = w.all_pix2world([[1019.5, 1019.5], [1519.5, 1019.5]], 0)
        p0 = ideal_pixel(rec, *c[0])
        p1 = ideal_pixel(rec, *c[1])
        out[det] = (p0[0], p0[1], np.degrees(np.arctan2(p1[1] - p0[1], p1[0] - p0[0])), h["MJD-AVG"] - rec["mjd"])
    return out


with ThreadPoolExecutor(10) as pool:
    results = list(pool.map(one, sample))

for rec, res in zip(sample, results):
    print(rec["obsid"], "epa", rec["epa"])
    for det, v in res.items():
        print("   D%d" % det, v if isinstance(v, str) else "centre (%8.1f, %8.1f) px  rot %7.3f deg  dt %.1e d" % v)

print("\nmean offsets in detector 1's ideal pixel frame:")
for det in range(1, 7):
    vals = np.array([r[det][:3] for r in results if not isinstance(r[det], str)])
    if len(vals):
        print("  D%d: dx %9.2f +- %.2f   dy %9.2f +- %.2f   rot %7.3f +- %.3f   (n=%d)" % (det, vals[:, 0].mean(), vals[:, 0].std(), vals[:, 1].mean(), vals[:, 1].std(), vals[:, 2].mean(), vals[:, 2].std(), len(vals)))
