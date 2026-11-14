"""Brightness of a point in single SPHEREx exposures, and how it changed over time.

Pure functions on arrays: no network.

Each exposure sees the point through a different part of the linear variable
filter, so at a different wavelength. A change in time can therefore only be read
by comparing like with like: exposures are grouped into spectral channels (17 per
detector, equal steps in log wavelength) and time bins, and a median polish
splits the magnitudes into a channel term (the spectrum) and a time term (the
change). Only channels seen in two or more time bins carry information about change.
This generalises what the R Draconis test showed (docs/target-matrix.md): mixing
channels turned the Mira's molecular bands into fake 4-magnitude jumps.

Code written with AI assistance (Claude); see AI_USAGE.md.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

PIXEL_ARCSEC = 6.15
PIXEL_SR = (PIXEL_ARCSEC / 206264.806) ** 2
UJY_PER_PIXEL = 1e12 * PIXEL_SR  # 1 MJy/sr over one pixel, in microjansky
CHANNELS_PER_DETECTOR = 17


@dataclass
class Flux:
    value: float  # µJy, background subtracted, NaN when too few usable pixels
    error: float  # µJy, from the background scatter only
    nan_core: int  # NaN (saturated or missing) pixels within 1.5 px of the point


def _rings(img: np.ndarray, x: float, y: float):
    yy, xx = np.indices(img.shape)
    return np.hypot(xx - x, yy - y)


def _sum(img: np.ndarray, r: np.ndarray, inside: np.ndarray, bg_in: float, bg_out: float) -> Flux:
    ring = img[(r >= bg_in) & (r < bg_out)]
    ring = ring[np.isfinite(ring)]
    nan_core = int((~np.isfinite(img[r <= 1.5])).sum())
    if ring.size < 10:
        return Flux(float("nan"), float("nan"), nan_core)
    bg = float(np.median(ring))
    noise = float(1.4826 * np.median(np.abs(ring - bg)))
    good = inside & np.isfinite(img)
    n = int(inside.sum())
    if good.sum() < 0.8 * n:
        return Flux(float("nan"), float("nan"), nan_core)
    value = float((img[good] - bg).sum() * n / good.sum())
    error = noise * np.sqrt(n) * np.sqrt(1 + n / ring.size)
    return Flux(value * UJY_PER_PIXEL, float(error * UJY_PER_PIXEL), nan_core)


def aperture(img: np.ndarray, x: float, y: float, radius: float = 2.0, bg: tuple[float, float] = (5.0, 8.0)) -> Flux:
    """Flux inside ``radius`` pixels of (x, y), not corrected for the light outside it."""
    r = _rings(img, x, y)
    return _sum(img, r, r <= radius, *bg)


def wing(img: np.ndarray, x: float, y: float, ring: tuple[float, float] = (3.0, 7.0), bg: tuple[float, float] = (9.0, 12.0)) -> Flux:
    """Flux in an annulus around (x, y): for stars whose core is saturated (NaN). Only relative values mean something."""
    r = _rings(img, x, y)
    return _sum(img, r, (r >= ring[0]) & (r < ring[1]), *bg)


def channel(wavelength_um, lo_um: float, hi_um: float, n: int = CHANNELS_PER_DETECTOR) -> np.ndarray:
    """Spectral channel (0..n-1) of each wavelength: equal steps in log wavelength across the detector."""
    w = np.asarray(wavelength_um, dtype=float)
    return np.clip(np.floor(n * np.log(w / lo_um) / np.log(hi_um / lo_um)), 0, n - 1).astype(int)


def time_bins(mjd, visit_gap_days: float = 30.0, bin_days: float = 10.0) -> np.ndarray:
    """Time bin of each exposure: one per survey visit, or ``bin_days`` slices when a visit lasts longer than two bins.

    Deep fields near the ecliptic poles are observed for months on end; a single
    bin there would average a Mira's whole cycle away.
    """
    mjd = np.asarray(mjd, dtype=float)
    order = np.argsort(mjd)
    t = mjd[order]
    out = np.empty(len(t), dtype=int)
    bin_id, start = -1, 0
    i = 0
    while i < len(t):
        j = i
        while j + 1 < len(t) and t[j + 1] - t[j] <= visit_gap_days:
            j += 1
        span = t[j] - t[i]
        sub = np.zeros(j - i + 1, dtype=int) if span <= 2 * bin_days else np.floor((t[i : j + 1] - t[i]) / bin_days).astype(int)
        _, sub = np.unique(sub, return_inverse=True)
        out[i : j + 1] = bin_id + 1 + sub
        bin_id = out[j]
        i = j + 1
    result = np.empty_like(out)
    result[order] = out
    return result


@dataclass
class ChangePoint:
    bin: int
    delta_mag: float  # relative to the median over bins; positive is fainter
    error: float
    channels: int
    exposures: int


def _largest_component(cells: dict[tuple[int, int], float]) -> set[int]:
    """Bins connected through shared channels (a median polish is only defined within one connected group)."""
    parent: dict = {}

    def find(a):
        while parent.setdefault(a, a) != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    for ch, b in cells:
        parent[find(("c", ch))] = find(("b", b))
    groups: dict = {}
    for _, b in cells:
        groups.setdefault(find(("b", b)), set()).add(b)
    return max(groups.values(), key=len) if groups else set()


def brightness_change(channels, bins, flux, error, min_snr: float = 3.0, iterations: int = 20) -> list[ChangePoint]:
    """Change in magnitude per time bin for one detector, comparing each channel only with itself."""
    channels, bins = np.asarray(channels), np.asarray(bins)
    flux, error = np.asarray(flux, dtype=float), np.asarray(error, dtype=float)
    ok = np.isfinite(flux) & np.isfinite(error) & (flux > 0) & (flux >= min_snr * error)
    mag = np.full(len(flux), np.nan)
    mag[ok] = -2.5 * np.log10(flux[ok])
    mag_err = np.where(ok, 1.0857 * error / np.where(flux > 0, flux, 1.0), np.nan)
    cells: dict[tuple[int, int], list[int]] = {}
    for i in np.flatnonzero(ok):
        cells.setdefault((int(channels[i]), int(bins[i])), []).append(i)
    bins_of: dict[int, set[int]] = {}
    for ch, b in cells:
        bins_of.setdefault(ch, set()).add(b)
    cells = {k: v for k, v in cells.items() if len(bins_of[k[0]]) >= 2}
    if not cells:
        return []
    keep = _largest_component({k: 0.0 for k in cells})
    cells = {k: v for k, v in cells.items() if k[1] in keep}
    if len({b for _, b in cells}) < 2:
        return []
    m = {k: float(np.median(mag[v])) for k, v in cells.items()}
    chs = sorted({c for c, _ in m})
    bs = sorted({b for _, b in m})
    a = {c: 0.0 for c in chs}
    t = {b: 0.0 for b in bs}
    for _ in range(iterations):
        a = {c: float(np.median([m[(c, b)] - t[b] for b in bs if (c, b) in m])) for c in chs}
        t = {b: float(np.median([m[(c, b)] - a[c] for c in chs if (c, b) in m])) for b in bs}
    zero = float(np.median([t[b] for b in bs]))  # the first bin can be poorly sampled; the median is not
    out = []
    for b in bs:
        resid = np.array([m[(c, b)] - a[c] - t[b] for c in chs if (c, b) in m])
        n_ch = len(resid)
        idx = [i for (c, bb), v in cells.items() if bb == b for i in v]
        if n_ch >= 3:
            err = float(1.4826 * np.median(np.abs(resid)) / np.sqrt(n_ch))
        else:
            err = float(np.median(mag_err[idx]) / np.sqrt(max(len(idx), 1)))
        out.append(ChangePoint(bin=b, delta_mag=t[b] - zero, error=max(err, 0.005), channels=n_ch, exposures=len(idx)))
    return out
