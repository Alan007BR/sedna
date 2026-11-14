"""The distance focus: shift-and-stack along the track a body would follow at each trial distance.

Seeded on a position at one instant, the model in ``parallax.py`` says where a
body at distance d would be in every other exposure of the visit. For each d the
exposures are sampled at those positions and median-stacked. At the right
distance the body adds up to a point while stars smear out; the sharpness of the
stack as a function of d is the measurement.

Code written with AI assistance (Claude); see AI_USAGE.md.
"""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass

import numpy as np
from astropy.wcs import WCS
from scipy.ndimage import map_coordinates

from ..archive import s3
from ..archive.cutout import header_of
from ..archive.skyindex import Hit
from . import parallax

NAXIS = 2040
INFINITY_AU = 1.0e7


def distance_ladder(n: int = 72, nearest: float = 25.0, farthest: float = 600.0) -> np.ndarray:
    """Trial distances in au, log-spaced, ending with 'infinity' (no shift: the fixed stars)."""
    return np.concatenate([np.geomspace(nearest, farthest, n), [INFINITY_AU]])


@dataclass
class FocusResult:
    distances: np.ndarray  # (D,) au; the last one is infinity
    scores: np.ndarray  # (D,) sharpness of each stack (peak over noise)
    stacks: np.ndarray  # (D, S, S) float32, in units of each exposure's noise
    best: int  # index of the sharpest finite distance
    half_range: tuple[float, float]  # distances where the score is above half its peak
    n_exposures: int
    mjd: np.ndarray  # times of the exposures used
    seed: tuple[float, float, float]  # ra, dec, mjd
    film_static: np.ndarray  # (T, S, S) single exposures centred on the seed position: stars fixed, body walks
    film_follow: np.ndarray  # (T, S, S) single exposures centred on the body's track at the best distance


def _stamps(hit: Hit, ra: np.ndarray, dec: np.ndarray, half: int) -> np.ndarray | None:
    """Stamps of one exposure centred on each predicted position; values in units of the exposure's noise."""
    try:
        header, data_start = header_of(hit.key)
    except Exception:
        return None
    wcs = WCS(header)
    pix = wcs.all_world2pix(np.column_stack([ra, dec]), 0, quiet=True)
    xs, ys = pix[:, 0], pix[:, 1]
    inside = (xs > half) & (xs < NAXIS - half) & (ys > half) & (ys < NAXIS - half)
    if not inside.any():
        return None
    pad = half + 3
    y_lo, y_hi = int(max(0, np.floor(ys[inside].min()) - pad)), int(min(NAXIS, np.ceil(ys[inside].max()) + pad + 1))
    x_lo, x_hi = int(max(0, np.floor(xs[inside].min()) - pad)), int(min(NAXIS, np.ceil(xs[inside].max()) + pad + 1))
    if y_hi - y_lo > 700:  # an exposure too far from the seed in time to be worth the transfer
        return None
    try:
        img = s3.read_rows(hit.key, data_start, y_lo, y_hi)[:, x_lo:x_hi].astype(np.float64)
    except Exception:
        return None
    finite = np.isfinite(img)
    if finite.mean() < 0.5:
        return None
    med = np.median(img[finite])
    noise = 1.4826 * np.median(np.abs(img[finite] - med))
    if not noise > 0:
        return None
    img = np.where(finite, (img - med) / noise, 0.0)
    yy, xx = np.mgrid[-half : half + 1, -half : half + 1]
    out = np.full((len(ra), 2 * half + 1, 2 * half + 1), np.nan, dtype=np.float32)
    for i in np.flatnonzero(inside):
        out[i] = map_coordinates(img, [yy + ys[i] - y_lo, xx + xs[i] - x_lo], order=1, mode="constant", cval=np.nan)
    return out


def sharpness(stack: np.ndarray) -> float:
    """Peak of the central 3x3 pixels above the surrounding ring, in units of the ring's scatter."""
    half = stack.shape[0] // 2
    yy, xx = np.mgrid[-half : half + 1, -half : half + 1]
    ring = stack[np.hypot(yy, xx) > 4]
    ring = ring[np.isfinite(ring)]
    if ring.size < 10:
        return float("nan")
    centre = np.nanmedian(ring)
    noise = 1.4826 * np.nanmedian(np.abs(ring - centre))
    core = stack[half - 1 : half + 2, half - 1 : half + 2]
    if not noise > 0 or not np.isfinite(core).any():
        return float("nan")
    return float((np.nanmax(core) - centre) / noise)


def judge(result: "FocusResult") -> tuple[str, str]:
    """Plain-language confidence of a focus result: (level, reason). Levels: clear, uncertain, none."""
    peak = float(result.scores[result.best])
    still = float(result.scores[-1])
    span = float(result.mjd.max() - result.mjd.min())
    lo, hi = result.half_range
    if result.n_exposures < 8 or span < 1.0:
        return "none", "Too few exposures, or all taken within a day: the body barely moved, so distance cannot be told."
    if not np.isfinite(peak) or peak < 6:
        return "none", "The stack never sharpens into a source: the body is too faint in single exposures."
    if still > 0.5 * peak:
        return "none", "A fixed source sits at the starting point, so the stack looks sharp at any distance."
    if hi / lo > 1.6 or peak < 12:
        return "uncertain", "The stack sharpens, but over a wide range of distances."
    return "clear", "The stack sharpens at one distance and blurs on either side."


def run_focus(hits: list[Hit], seed_ra: float, seed_dec: float, seed_mjd: float, distances: np.ndarray | None = None, half: int = 16, workers: int = 24) -> FocusResult:
    """Sweep the distance ladder over the given exposures, seeded at (seed_ra, seed_dec, seed_mjd)."""
    distances = distance_ladder() if distances is None else distances
    mjd = np.array([h.mjd for h in hits])
    earth = parallax.earth_position(mjd)
    earth0 = parallax.earth_position([seed_mjd])[0]
    ra, dec = parallax.predict_track(seed_ra, seed_dec, seed_mjd, distances, mjd, earth=earth, earth0=earth0)  # (D, T)

    with ThreadPoolExecutor(workers) as pool:
        cubes = list(pool.map(lambda i: _stamps(hits[i], ra[:, i], dec[:, i], half), range(len(hits))))
    used = [i for i, c in enumerate(cubes) if c is not None]
    if len(used) < 4:
        raise ValueError("too few usable exposures around the seed")
    cube = np.array([cubes[i] for i in used])  # (T, D, S, S)
    with np.errstate(all="ignore"):
        stacks = np.nanmedian(cube, axis=0).astype(np.float32)
    scores = np.array([sharpness(s) for s in stacks])
    finite = scores[:-1]
    best = int(np.nanargmax(finite))
    above = np.flatnonzero(finite >= finite[best] / 2)
    lo = hi = best
    while lo - 1 in above:
        lo -= 1
    while hi + 1 in above:
        hi += 1
    return FocusResult(
        distances=distances,
        scores=scores,
        stacks=stacks,
        best=best,
        half_range=(float(distances[lo]), float(distances[hi])),
        n_exposures=len(used),
        mjd=mjd[used],
        seed=(seed_ra, seed_dec, seed_mjd),
        film_static=cube[:, -1],
        film_follow=cube[:, best],
    )
