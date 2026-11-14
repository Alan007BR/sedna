"""Smoke test of the stack builder on a challenge target: timing and a quick-look montage.

Usage: python probes/p9_stack.py NAME RA DEC [FOV_ARCMIN]

Code written with AI assistance (Claude); see AI_USAGE.md.
"""
import sys
import time
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from astropy.time import Time

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "service"))
from sedna.archive.skyindex import SkyIndex  # noqa: E402
from sedna.science.stack import build_stack  # noqa: E402

name, ra, dec = sys.argv[1], float(sys.argv[2]), float(sys.argv[3])
fov = float(sys.argv[4]) if len(sys.argv) > 4 else 6.0
ix = SkyIndex.load()
t0 = time.time()
stack = build_stack(ix, ra, dec, fov_arcmin=fov)
dt = time.time() - t0
print(f"{name}: {stack.n_read}/{stack.n_requested} cutouts, {len(stack.frames)} frames, grid {stack.grid.size} px, {dt:.1f} s")

visits = sorted({f.visit for f in stack.frames})
fig, axes = plt.subplots(len(visits), 6, figsize=(12, 2.1 * len(visits)), squeeze=False)
for ax in axes.ravel():
    ax.axis("off")
for det in range(1, 7):
    imgs = [f.image for f in stack.frames if f.det == det]
    if not imgs:
        continue
    allv = np.concatenate([i[np.isfinite(i)] for i in imgs])
    lo, hi = np.percentile(allv, [20, 99.7])
    for f in stack.frames:
        if f.det != det:
            continue
        ax = axes[visits.index(f.visit), det - 1]
        ax.imshow(np.arcsinh(10 * np.clip((f.image - lo) / (hi - lo), 0, 1)), origin="lower", cmap="gray", interpolation="nearest")
        ax.set_title(f"D{det} {Time(f.mjd_start, format='mjd').iso[:10]} n={f.n_exposures}", fontsize=7)
fig.suptitle(f"{name}: north up, east left, one stretch per detector", fontsize=9)
fig.tight_layout()
out = Path(__file__).with_name(f"p9_{name.lower()}.png")
fig.savefig(out, dpi=120)
print("saved", out)
