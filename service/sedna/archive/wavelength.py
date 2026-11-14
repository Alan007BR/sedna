"""Wavelength and bandwidth at any pixel of each SPHEREx detector.

Each detector sits behind a linear variable filter, so the wavelength is a fixed
function of the pixel. The pipeline stores it as a lookup table (extension
WCS-WAVE, alternate WCS key "W"). ``probes/p14_wavelength.py`` showed the table is
identical in exposures months apart and across the dr1 and qr3 releases, so it is
evaluated once on a coarse grid, saved in ``data/wavelength/wavemap.npz`` (under
1 MB, versioned) and interpolated afterwards.

Code written with AI assistance (Claude); see AI_USAGE.md.
"""
from __future__ import annotations

import warnings
from pathlib import Path

import numpy as np
from astropy.io import fits
from astropy.wcs import WCS
from scipy.ndimage import map_coordinates

from . import s3

MAP = Path(__file__).resolve().parents[3] / "data" / "wavelength" / "wavemap.npz"
BLOCK = 2880
END = b"END" + b" " * 77
STEP = 17  # grid spacing in pixels: 121 nodes over 0..2040
NODES = np.arange(0, 2040 + STEP, STEP, dtype=float)
NODES[-1] = 2039.0


def _extensions(key: str):
    """(name, header, data_start, data_bytes) of each extension up to WCS-WAVE, from header reads only."""
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
            return out
        offset = data_start + (size + BLOCK - 1) // BLOCK * BLOCK
    raise LookupError(f"no WCS-WAVE extension in {key}")


def spectral_wcs(key: str) -> WCS:
    """The spectral WCS of one file, as the IRSA tutorial evaluates it (key "W", SIP off)."""
    exts = _extensions(key)
    image_header = next(h for n, h, _, _ in exts if n == "IMAGE")
    _, table_header, start, size = exts[-1]
    raw = s3.get_range(key, start, start + size - 1)
    table = fits.BinTableHDU.fromstring(table_header.tostring(padding=True).encode("ascii") + raw + b"\0" * ((BLOCK - len(raw) % BLOCK) % BLOCK))
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        spec = WCS(image_header, fobj=fits.HDUList([fits.PrimaryHDU(), fits.ImageHDU(header=image_header, name="IMAGE"), table]), key="W")
    spec.sip = None
    return spec


def build(d1_key: str) -> None:
    """Evaluate the six detectors' maps from one exposure (its detector-1 key) and save them."""
    gy, gx = np.meshgrid(NODES, NODES, indexing="ij")
    arrays = {}
    for det in range(1, 7):
        key = d1_key.replace("/1/", f"/{det}/").replace("D1_spx", f"D{det}_spx")
        wl, bw = spectral_wcs(key).pixel_to_world_values(gx.ravel(), gy.ravel())
        arrays[f"wl{det}"] = wl.reshape(gx.shape).astype(np.float32)
        arrays[f"bw{det}"] = bw.reshape(gx.shape).astype(np.float32)
    arrays["nodes"] = NODES
    arrays["source"] = np.array(d1_key)
    MAP.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(MAP, **arrays)


class WaveMap:
    def __init__(self, arrays: dict):
        self.a = arrays
        self.step = float(arrays["nodes"][1] - arrays["nodes"][0])

    @classmethod
    def load(cls) -> "WaveMap":
        with np.load(MAP, allow_pickle=False) as z:
            return cls({k: z[k] for k in z.files})

    def at(self, det: int, x, y) -> tuple[np.ndarray, np.ndarray]:
        """Wavelength and bandwidth in µm at full-frame pixel (x, y), 0-based."""
        coords = [np.atleast_1d(np.asarray(y, dtype=float)) / self.step, np.atleast_1d(np.asarray(x, dtype=float)) / self.step]
        wl = map_coordinates(self.a[f"wl{det}"], coords, order=1, mode="nearest")
        bw = map_coordinates(self.a[f"bw{det}"], coords, order=1, mode="nearest")
        return wl, bw

    def range_um(self, det: int) -> tuple[float, float]:
        wl = self.a[f"wl{det}"]
        return float(wl.min()), float(wl.max())


if __name__ == "__main__":
    from .skyindex import SkyIndex

    ix = SkyIndex.load()
    build(str(ix.a["key"][1000]))
    wm = WaveMap.load()
    for det in range(1, 7):
        lo, hi = wm.range_um(det)
        exact = spectral_wcs(str(ix.a["key"][1000]).replace("/1/", f"/{det}/").replace("D1_spx", f"D{det}_spx"))
        xs, ys = np.array([333.3, 1020.0, 1777.7]), np.array([101.1, 1020.0, 1900.9])
        err = np.max(np.abs(wm.at(det, xs, ys)[0] - exact.pixel_to_world_values(xs, ys)[0]))
        print(f"D{det}: {lo:.3f}-{hi:.3f} um; interpolation error at test pixels {err:.1e} um")
