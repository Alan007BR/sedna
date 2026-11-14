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
from .archive.net import WORKERS

CONTAMINATION_ARCSEC = {"aperture": 18.0, "wing": 45.0}  # how close a neighbour can leak into the measuring ring
CONTAMINATION_SHARE = 0.05  # neighbours fainter than 5 % of the light measured at the point cannot move it by 0.05 mag
G_ZERO_UJY = 3.2e9  # Gaia G = 0 in microjansky, roughly; G spans 0.33-1.05 um, close to detector 1
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


def measure_point(index: SkyIndex, ra: float, dec: float, position_at=None, workers: int = WORKERS):
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


def neighbours(ra: float, dec: float, method: str, measured_ujy: float, track: list[tuple[float, float]] | None = None) -> list[dict] | None:
    """Gaia DR3 stars (G < 18) close enough to the point, and bright enough, to leak into its measurement.

    Close enough: inside the aperture or wing ring. Bright enough: at least 5 % of ``measured_ujy``, the
    flux measured at the point in detector 1 (Gaia's G band ends at 1.05 um). The point itself (within
    4 arcsec) is skipped. For a moving target, distances are measured to its track over the dates
    measured, because its neighbours change as it moves. None when Gaia does not answer.
    """
    from .archive.gaia import cone
    from .science.movers import separation_arcsec

    limit = CONTAMINATION_ARCSEC[method]
    points = track or [(ra, dec)]
    try:
        rows = cone(ra, dec, (limit + 60) / 3600, g_max=18.0, limit=80)
    except Exception:
        return None
    out = []
    for s in rows:
        d = min(float(separation_arcsec(s["ra"], s["dec"], r, c)) for r, c in points)
        share = G_ZERO_UJY * 10 ** (-0.4 * float(s["g"])) / measured_ujy if measured_ujy > 0 else float("inf")
        if 4.0 <= d <= limit and share >= CONTAMINATION_SHARE:
            out.append({"separationArcsec": round(d, 1), "g": round(float(s["g"]), 1), "share": round(min(share, 99.0), 2)})
    return sorted(out, key=lambda n: n["separationArcsec"])
