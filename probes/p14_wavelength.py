"""Where is the wavelength of each pixel, and is it the same in every exposure of a detector?

Walks the extensions of a Level-2 file with range requests (headers only), reads
the WCS-WAVE lookup table, and evaluates the spectral WCS (alternate key "W") the
way the IRSA tutorial does. Then compares two exposures taken months apart on the
same detector.

Code written with AI assistance (Claude); see AI_USAGE.md.
"""
import sys
import warnings
from pathlib import Path

import numpy as np
from astropy.io import fits
from astropy.wcs import WCS

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "service"))
from sedna.archive import s3  # noqa: E402
from sedna.archive.skyindex import SkyIndex  # noqa: E402

warnings.filterwarnings("ignore")
BLOCK = 2880
END = b"END" + b" " * 77


def walk(key):
    """(name, header, data_start, data_bytes) of every extension, reading headers only."""
    out, offset = [], 0
    while len(out) < 10:
        raw = b""
        while END not in [raw[i : i + 80] for i in range(0, len(raw), 80)]:
            raw += s3.get_range(key, offset + len(raw), offset + len(raw) + 4 * BLOCK - 1)
        end = [raw[i : i + 80] for i in range(0, len(raw), 80)].index(END)
        n_blocks = (end * 80 + 80 + BLOCK - 1) // BLOCK
        header = fits.Header.fromstring(raw[: n_blocks * BLOCK].decode("ascii"))
        naxis = header.get("NAXIS", 0)
        size = abs(header.get("BITPIX", 8)) // 8 * int(np.prod([header[f"NAXIS{i}"] for i in range(1, naxis + 1)])) if naxis else 0
        size = (size + header.get("PCOUNT", 0)) * header.get("GCOUNT", 1)
        data_start = offset + n_blocks * BLOCK
        out.append((header.get("EXTNAME", "PRIMARY"), header, data_start, size))
        if header.get("EXTNAME") == "WCS-WAVE":
            break
        offset = data_start + (size + BLOCK - 1) // BLOCK * BLOCK
    return out


def spectral_wcs(key):
    exts = walk(key)
    img_h = next(h for n, h, _, _ in exts if n == "IMAGE")
    _, wh, start, size = exts[-1]
    raw = s3.get_range(key, start, start + size - 1)
    tab = fits.BinTableHDU.fromstring(wh.tostring(padding=True).encode("ascii") + raw + b"\0" * ((BLOCK - len(raw) % BLOCK) % BLOCK))
    spec = WCS(img_h, fobj=fits.HDUList([fits.PrimaryHDU(), fits.ImageHDU(header=img_h, name="IMAGE"), tab]), key="W")
    spec.sip = None
    return exts, start, spec


ix = SkyIndex.load()
d1_keys = [str(k) for k in ix.a["key"][[1000, 200000]]]
gx, gy = np.meshgrid(np.linspace(0, 2039, 9), np.linspace(0, 2039, 9))
for det in range(1, 7):
    maps = []
    for d1 in d1_keys:
        key = d1.replace("/1/", f"/{det}/").replace("D1_spx", f"D{det}_spx")
        exts, start, spec = spectral_wcs(key)
        wl, bw = spec.pixel_to_world_values(gx.ravel(), gy.ravel())
        maps.append(wl)
    print(f"D{det}: extensions {[n for n, *_ in exts]}, WCS-WAVE data at byte {start:,}")
    print(f"     wavelength {wl.min():.3f}-{wl.max():.3f} um; along y at x=1020: {np.round(wl.reshape(9, 9)[:, 4], 3)}; spread along x at y=1020: {np.ptp(wl.reshape(9, 9)[4]):.4f} um")
    print(f"     bandwidth {bw.min():.4f}-{bw.max():.4f} um; largest difference between the two exposures: {np.max(np.abs(maps[0] - maps[1])):.2e} um")
