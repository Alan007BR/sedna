"""Cut a small patch around a sky position out of one Level-2 exposure in the bucket.

Two small range requests per exposure: the header (cached on disk afterwards) for
the exact WCS, then only the rows that contain the patch.

Code written with AI assistance (Claude); see AI_USAGE.md.
"""
from __future__ import annotations

import hashlib
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import requests
from astropy.io import fits
from astropy.wcs import WCS

from . import s3

CACHE = Path(__file__).resolve().parents[3] / "data" / "cache" / "headers"
NAXIS = 2040


@dataclass
class Cutout:
    key: str
    det: int
    obsid: str
    mjd: float
    x: float  # exact 0-based pixel of the requested position in the full frame
    y: float
    x0: int  # full-frame pixel of the patch's first column / row
    y0: int
    image: np.ndarray  # (2*half+1, 2*half+1) float32, NaN where off the detector
    wcs: WCS


def header_of(key: str) -> tuple[fits.Header, int]:
    """IMAGE header and pixel-data offset of a file, cached on disk after the first read."""
    CACHE.mkdir(parents=True, exist_ok=True)
    path = CACHE / (hashlib.sha1(key.encode()).hexdigest() + ".hdr")
    if path.exists():
        text = path.read_text()
        data_start, _, body = text.partition("\n")
        return fits.Header.fromstring(body), int(data_start)
    h = s3.read_image_header(key)
    path.write_text(f"{h.data_start}\n{h.header.tostring()}")
    return h.header, h.data_start


def read_cutout(key: str, ra: float, dec: float, half: int = 16) -> Cutout | None:
    """Patch of (2*half+1)^2 pixels centred on (ra, dec), or None if the position is off the detector."""
    try:
        header, data_start = header_of(key)
    except requests.HTTPError:  # this detector's file is missing for the exposure
        return None
    wcs = WCS(header)
    x, y = wcs.all_world2pix([[ra, dec]], 0, quiet=True)[0]
    if not (0 <= x < NAXIS and 0 <= y < NAXIS):
        return None
    xi, yi = int(round(float(x))), int(round(float(y)))
    y_lo, y_hi = max(0, yi - half), min(NAXIS, yi + half + 1)
    x_lo, x_hi = max(0, xi - half), min(NAXIS, xi + half + 1)
    rows = s3.read_rows(key, data_start, y_lo, y_hi)
    image = np.full((2 * half + 1, 2 * half + 1), np.nan, dtype=np.float32)
    image[y_lo - (yi - half) : y_hi - (yi - half), x_lo - (xi - half) : x_hi - (xi - half)] = rows[:, x_lo:x_hi]
    return Cutout(
        key=key,
        det=int(header["DETECTOR"]),
        obsid=str(header["OBSID"]),
        mjd=float(header["MJD-AVG"]),
        x=float(x),
        y=float(y),
        x0=xi - half,
        y0=yi - half,
        image=image,
        wcs=wcs,
    )
