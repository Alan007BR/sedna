"""Position and brightness measurements on aligned SPHEREx frames.

All positions are grid pixels (column x, row y) of a ``stack.Grid``. Saturated
pixels are NaN in SPHEREx Level-2 images, so they drop out of every sum here; a
saturated star is then centred on its unsaturated wings.

Code written with AI assistance (Claude); see AI_USAGE.md.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np


@dataclass
class Measure:
    x: float
    y: float
    flux: float  # background-subtracted sum inside the aperture (image units x pixels)
    snr: float  # peak over local noise
    saturated: int  # NaN pixels within 1.5 px of the centre
    ok: bool


def local_background(img: np.ndarray, x: float, y: float, r_in: float = 5.0, r_out: float = 9.0) -> tuple[float, float]:
    yy, xx = np.indices(img.shape)
    r = np.hypot(xx - x, yy - y)
    ring = img[(r >= r_in) & (r < r_out)]
    ring = ring[np.isfinite(ring)]
    if ring.size < 8:
        return float("nan"), float("nan")
    med = float(np.median(ring))
    return med, float(1.4826 * np.median(np.abs(ring - med)))


def centroid(img: np.ndarray, x0: float, y0: float, radius: float = 2.5, iterations: int = 4, search: float = 1.5) -> Measure:
    """Background-subtracted first-moment centroid near (x0, y0).

    Starts from the brightest pixel within ``search`` px of the guess, then iterates
    the moment inside ``radius``. NaN (saturated or missing) pixels are ignored.
    """
    h, w = img.shape
    if not (radius + 1 < x0 < w - radius - 2 and radius + 1 < y0 < h - radius - 2):
        return Measure(x0, y0, float("nan"), float("nan"), 0, False)
    yy, xx = np.indices(img.shape)
    bg, noise = local_background(img, x0, y0)
    if not np.isfinite(bg) or not noise > 0:
        return Measure(x0, y0, float("nan"), float("nan"), 0, False)
    near = (np.hypot(xx - x0, yy - y0) <= search) & np.isfinite(img)
    if near.any():
        k = np.argmax(np.where(near, img, -np.inf))
        x, y = float(xx.flat[k]), float(yy.flat[k])
    else:  # saturated core: start from the guess and let the wings pull
        x, y = x0, y0
    for _ in range(iterations):
        r = np.hypot(xx - x, yy - y)
        m = (r <= radius) & np.isfinite(img)
        v = np.clip(img[m] - bg, 0, None)
        if v.sum() <= 0:
            return Measure(x, y, float("nan"), float("nan"), 0, False)
        x = float((xx[m] * v).sum() / v.sum())
        y = float((yy[m] * v).sum() / v.sum())
    r = np.hypot(xx - x, yy - y)
    m = (r <= radius) & np.isfinite(img)
    flux = float((img[m] - bg).sum())
    peak = np.nanmax(np.where(r <= 1.5, img, np.nan)) if np.isfinite(np.where(r <= 1.5, img, np.nan)).any() else np.nan
    saturated = int((~np.isfinite(img[r <= 1.5])).sum())
    snr = float((peak - bg) / noise) if np.isfinite(peak) else float("inf") if saturated else float("nan")
    return Measure(x, y, flux, snr, saturated, True)


def annulus_flux(img: np.ndarray, x: float, y: float, r_in: float, r_out: float, bg: float) -> tuple[float, int]:
    """Background-subtracted flux in an annulus, and how many of its pixels were usable."""
    yy, xx = np.indices(img.shape)
    r = np.hypot(xx - x, yy - y)
    m = (r >= r_in) & (r < r_out)
    good = m & np.isfinite(img)
    if good.sum() < 0.8 * m.sum():
        return float("nan"), int(good.sum())
    return float((img[good] - bg).sum() * m.sum() / good.sum()), int(good.sum())
