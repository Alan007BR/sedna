"""Brightness of one sky point in every SPHEREx exposure: the spectrum per time bin and the change over time.

Measured on the native pixels of each exposure (no resampling), at the exact
position given by the file's own WCS. Bright stars whose cores are saturated are
measured in their unsaturated wings, for every exposure, so values stay comparable.

Code written with AI assistance (Claude); see AI_USAGE.md.
"""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass

import numpy as np

from .archive.cutout import read_cutout
from .archive.skyindex import SkyIndex
from .archive.wavelength import WaveMap
from .science.photometry import aperture, brightness_change, channel, time_bins, wing

HALF = 13  # cutout half-size in pixels: room for the wing background ring (9-12 px)
MAX_EXPOSURES = 1200
SATURATED_SHARE = 0.2  # above this share of exposures with NaN cores, measure the wings

_wavemap: WaveMap | None = None


def wavemap() -> WaveMap:
    global _wavemap
    if _wavemap is None:
        _wavemap = WaveMap.load()
    return _wavemap


@dataclass
class Exposure:
    mjd: float
    det: int
    x: float
    y: float
    wavelength: float
    bandwidth: float
    flux: float
    error: float
    nan_core: int
    bin: int = 0
    channel: int = 0


def measure_point(index: SkyIndex, ra: float, dec: float, position_at=None, workers: int = 24):
    """Returns (method, exposures measured, exposures available, change per detector)."""
    hits = index.lookup(ra, dec)
    available = len(hits)
    if len(hits) > MAX_EXPOSURES:  # keep an even sample in time
        hits = [hits[i] for i in np.linspace(0, len(hits) - 1, MAX_EXPOSURES).round().astype(int)]

    def one(h):
        r, d = position_at(h.mjd) if position_at else (ra, dec)
        try:
            c = read_cutout(h.key, r, d, half=HALF)
        except Exception:
            return None
        if c is None:
            return None
        x, y = c.x - c.x0, c.y - c.y0
        return c, aperture(c.image, x, y), wing(c.image, x, y)

    with ThreadPoolExecutor(workers) as pool:
        rows = [row for row in pool.map(one, hits) if row is not None]
    if not rows:
        return "aperture", [], available, {}
    saturated = np.mean([ap.nan_core > 0 for _, ap, _ in rows])
    method = "wing" if saturated > SATURATED_SHARE else "aperture"
    wm = wavemap()
    exposures = []
    for c, ap, wg in rows:
        f = wg if method == "wing" else ap
        wl, bw = wm.at(c.det, c.x, c.y)
        exposures.append(Exposure(c.mjd, c.det, c.x, c.y, float(wl[0]), float(bw[0]), f.value, f.error, ap.nan_core))
    exposures.sort(key=lambda e: e.mjd)
    bins = time_bins([e.mjd for e in exposures])
    for e, b in zip(exposures, bins):
        e.bin = int(b)
        e.channel = int(channel(e.wavelength, *wm.range_um(e.det))) if np.isfinite(e.wavelength) else -1
    change = {}
    for det in range(1, 7):
        sel = [e for e in exposures if e.det == det]
        if sel:
            change[det] = brightness_change([e.channel for e in sel], [e.bin for e in sel], [e.flux for e in sel], [e.error for e in sel])
    return method, exposures, available, change
