"""Decision test 4: is WISE 0855-0714 visible in SPHEREx, and only at long wavelengths?

Looks up the exposures covering its propagated position, reads cutouts straight
from the bucket, and stacks them per detector for one visit.

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
from astropy.time import Time

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "service"))
from sedna.archive.cutout import read_cutout  # noqa: E402
from sedna.archive.skyindex import SkyIndex, split_visits  # noqa: E402

# Challenge coordinate (WISE discovery-era position) and published motion (Luhman 2014)
RA_REF, DEC_REF, EPOCH_REF = 133.795129, -7.245147, 2010.5
PM_RA, PM_DEC = -8.118, 0.680  # arcsec / yr (RA term includes cos dec)
HALF = 14


def position(mjd):
    years = Time(mjd, format="mjd").decimalyear - EPOCH_REF
    dec = DEC_REF + PM_DEC * years / 3600
    ra = RA_REF + PM_RA * years / 3600 / np.cos(np.radians(DEC_REF))
    return ra, dec


ix = SkyIndex.load()
ra0, dec0 = position(60800.0)
print(f"propagated position near 2025.3: RA {ra0:.4f} Dec {dec0:.4f}  ({(ra0 - RA_REF) * 3600 * np.cos(np.radians(DEC_REF)):.0f}\", {(dec0 - DEC_REF) * 3600:.0f}\" from the catalogue position)")
visits = split_visits(ix.lookup(ra0, dec0))
visit = visits[int(sys.argv[1]) if len(sys.argv) > 1 else 0]
print(f"visit {Time(visit[0].mjd, format='mjd').iso[:10]}: {len(visit)} detector images")

t0 = time.time()
with ThreadPoolExecutor(16) as pool:
    cuts = [c for c in pool.map(lambda h: read_cutout(h.key, *position(h.mjd), half=HALF), visit) if c is not None]
print(f"read {len(cuts)} cutouts in {time.time() - t0:.1f} s")

yy, xx = np.mgrid[-HALF : HALF + 1, -HALF : HALF + 1]
ring = np.hypot(yy, xx) > 5
fig, axes = plt.subplots(1, 6, figsize=(13, 2.6))
for det, ax in zip(range(1, 7), axes):
    stack = [c.image - np.nanmedian(c.image) for c in cuts if c.det == det]
    ax.axis("off")
    if not stack:
        ax.set_title(f"D{det}: no data", fontsize=8)
        continue
    med = np.nanmedian(np.array(stack), axis=0) if len(stack) > 2 else np.nanmean(np.array(stack), axis=0)
    noise = 1.4826 * np.nanmedian(np.abs(med[ring] - np.nanmedian(med[ring])))
    core = med[HALF - 2 : HALF + 3, HALF - 2 : HALF + 3]
    snr = (np.nanmax(core) - np.nanmedian(med[ring])) / noise
    iy, ix_ = np.unravel_index(np.nanargmax(core), core.shape)
    print(f"  D{det}: {len(stack)} exposures, peak S/N within 2 px of the predicted position: {snr:5.1f}  (offset {ix_ - 2:+d},{iy - 2:+d} px)")
    ax.imshow(med, origin="lower", cmap="gray", vmin=-2 * noise, vmax=10 * noise, interpolation="nearest")
    for a, b in (((HALF - 6, HALF - 3), (HALF, HALF)), ((HALF + 3, HALF + 6), (HALF, HALF))):
        ax.plot(a, b, color="#e0694a", lw=0.9)
    ax.set_title(f"D{det}  n={len(stack)}  S/N {snr:.0f}", fontsize=8)
fig.suptitle("WISE 0855-0714 in SPHEREx, one visit, stacked per detector (detector frame)", fontsize=9)
fig.tight_layout()
out = Path(__file__).with_name(f"p8_wise0855_v{sys.argv[1] if len(sys.argv) > 1 else 0}.png")
fig.savefig(out, dpi=130)
print("saved", out)
