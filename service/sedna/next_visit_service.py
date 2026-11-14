"""Predict where a body will be at SPHEREx's next visit, months later and degrees away, and look for it there.

The distance focus gives a distance from a few days of motion. The same model
(circular, prograde orbit in the ecliptic) then predicts the position at the next
visit. ``probes/p15_next_visit.py`` measured how far off that is against JPL
Horizons: 5-16 arcmin after 5-7 months, against jumps of 1.7-2.7 degrees. So the
prediction is a region, not a point: the arc of positions for distances within
±10 % of the focus result, plus a margin. SEDNA then shift-and-stacks the whole
region in the next visit at the focus distance. Stars smear out of the median,
and the body, if it is there, becomes a sharp point.

Code written with AI assistance (Claude); see AI_USAGE.md.
"""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field

import numpy as np
from scipy.ndimage import binary_dilation, maximum_filter, uniform_filter
from scipy.spatial import cKDTree

from .archive.cutout import read_cutout
from .archive.skyindex import SkyIndex, split_visits
from .focus_service import densest_window
from .science import parallax
from .science.movers import separation_arcsec, tangent_offsets_arcsec
from .science.stack import PIXEL_ARCSEC, Grid, resample

REGION_ARCMIN = 36.0
DISTANCE_SPREAD = 0.10  # ±10 %: the focus came within 1-7 % on Makemake and Haumea, up to 40 % on Pluto
WINDOW_DAYS = 6.0
MAX_EXPOSURES = 20
MIN_DAYS_AHEAD = 60.0
DETECTION_SNR = 7.0  # of the 3x3-smoothed tracked stack; residual star wings are not Gaussian
MIN_COVERAGE = 0.6  # share of the exposures that must cover a pixel in both stacks before it is searched
DIPOLE_MAX = 1.0  # deepest negative within 3 px over the peak: star dipoles measured 1.3-65, Makemake 0.2-0.7 (probes/p15)
HALF_SNR = 3.5  # the candidate must also stand out in each half of the exposures, at the same place
SEARCH_FROM_ARC_ARCMIN = 8.0  # the model's error across the arc was 3-6 arcmin at the true distance (probes/p15)
DETECTORS = (1, 2, 3, 4)


@dataclass
class NextVisit:
    status: str  # "found" | "not_found" | "not_observed"
    t_mid: float = float("nan")
    predicted: tuple[float, float] = (float("nan"), float("nan"))
    arc: list[tuple[float, float, float]] = field(default_factory=list)  # (distance au, ra, dec)
    centre: tuple[float, float] = (float("nan"), float("nan"))
    size: int = 0
    tracked: np.ndarray | None = None
    static: np.ndarray | None = None
    found: dict | None = None
    window: tuple[float, float] = (float("nan"), float("nan"))
    exposures: int = 0


def _noise_normalised(plane: np.ndarray) -> np.ndarray | None:
    finite = np.isfinite(plane)
    if finite.mean() < 0.3:
        return None
    med = np.median(plane[finite])
    noise = 1.4826 * np.median(np.abs(plane[finite] - med))
    if not noise > 0:
        return None
    return ((plane - med) / noise).astype(np.float32)


def trail_mask(static: np.ndarray, shifts_px: np.ndarray, threshold: float = 3.0) -> np.ndarray:
    """Pixels where a star of the static stack smears into a trail in the tracked one.

    In the tracked frame a fixed star sits at its static position minus the body's
    motion since mid-window, so it sweeps a trail along that motion.
    """
    bright = binary_dilation(np.nan_to_num(static) > threshold, iterations=1)
    mask = bright.copy()
    h, w = bright.shape
    for dx, dy in np.unique(np.round(-shifts_px).astype(int), axis=0):
        moved = np.zeros_like(bright)
        ys, xs = slice(max(0, dy), h + min(0, dy)), slice(max(0, dx), w + min(0, dx))
        yo, xo = slice(max(0, -dy), h + min(0, -dy)), slice(max(0, -dx), w + min(0, -dx))
        moved[ys, xs] = bright[yo, xo]
        mask |= moved
    return mask


def difference_snr(tracked: np.ndarray, static: np.ndarray, sample: np.ndarray | None = None) -> np.ndarray:
    """S/N map of (tracked - static), both smoothed 3x3 (about the point-spread function).

    A fixed star is sharp in the static stack and smeared in the tracked one; a body
    moving at the tracked rate is the reverse, so it is positive here.
    """
    finite = np.isfinite(tracked) & np.isfinite(static)
    diff = uniform_filter(np.nan_to_num(tracked), size=3) - uniform_filter(np.nan_to_num(static), size=3)
    pick = finite & sample if sample is not None and (finite & sample).sum() > 100 else finite  # noise where we search
    med = float(np.median(diff[pick]))
    noise = float(1.4826 * np.median(np.abs(diff[pick] - med)))
    out = (diff - med) / noise if noise > 0 else np.full_like(diff, np.nan)
    return np.where(finite, out, np.nan)


def candidates(snr: np.ndarray, static: np.ndarray, shifts_px: np.ndarray, allowed: np.ndarray | None = None, n: int = 10, edge: int = 4) -> list[tuple[int, int, float]]:
    """The ``n`` strongest local maxima of an S/N map, away from star trails and inside the allowed band."""
    score = np.where(np.isfinite(snr) & ~trail_mask(static, shifts_px), snr, -np.inf)
    if allowed is not None:
        score = np.where(allowed, score, -np.inf)
    score[:edge, :] = score[-edge:, :] = score[:, :edge] = score[:, -edge:] = -np.inf
    peaks = (score == maximum_filter(score, size=9)) & np.isfinite(score)
    ys, xs = np.nonzero(peaks)
    order = np.argsort(score[ys, xs])[::-1][:n]
    return [(int(xs[i]), int(ys[i]), float(score[ys[i], xs[i]])) for i in order]


def dipole_ratio(snr: np.ndarray, x: int, y: int, radius: int = 3) -> float:
    """How deep the strongest negative lobe next to a peak is, relative to the peak.

    A star shifted by a pixel between the two stacks leaves a positive lobe stuck to
    a negative one; a moving body leaves no negative lobe beside it.
    """
    win = snr[max(0, y - radius) : y + radius + 1, max(0, x - radius) : x + radius + 1]
    peak = snr[y, x]
    return float(-np.nanmin(win) / peak) if peak > 0 and np.isfinite(win).any() else float("inf")


def near_max(snr: np.ndarray, x: int, y: int, radius: int = 1) -> float:
    win = snr[max(0, y - radius) : y + radius + 1, max(0, x - radius) : x + radius + 1]
    return float(np.nanmax(win)) if np.isfinite(win).any() else float("nan")


def next_visit(index: SkyIndex, seed_ra: float, seed_dec: float, seed_mjd: float, distance_au: float, workers: int = 20) -> NextVisit:
    mjd = index.a["mjd"]
    later = mjd > seed_mjd + MIN_DAYS_AHEAD
    if not later.any():
        return NextVisit("not_observed")
    ra_t = np.full(len(mjd), np.nan)
    dec_t = np.full(len(mjd), np.nan)
    ra_t[later], dec_t[later] = parallax.predict_track(seed_ra, seed_dec, seed_mjd, distance_au, mjd[later])
    hits = index.lookup(ra_t, dec_t, margin=-200.0, detectors=DETECTORS)
    if not hits:
        return NextVisit("not_observed")
    window = densest_window(split_visits(hits)[0], WINDOW_DAYS)
    centre_time = float(np.median([h.mjd for h in window]))
    window = sorted(sorted(window, key=lambda h: abs(h.mjd - centre_time))[:MAX_EXPOSURES], key=lambda h: h.mjd)
    t_mid = float(np.median([h.mjd for h in window]))

    distances = distance_au * np.geomspace(1 / (1 + DISTANCE_SPREAD), 1 + DISTANCE_SPREAD, 9)
    arc_ra, arc_dec = parallax.predict_track(seed_ra, seed_dec, seed_mjd, distances, np.array([t_mid]))
    arc = [(float(d), float(r), float(c)) for d, r, c in zip(distances, arc_ra[:, 0], arc_dec[:, 0])]
    p_ra, p_dec = parallax.predict_track(seed_ra, seed_dec, seed_mjd, distance_au, np.array([t_mid]))
    pred_ra, pred_dec = float(p_ra[0]), float(p_dec[0])
    # centre the region on the middle of the arc's extent
    e, n = tangent_offsets_arcsec(arc_ra[:, 0], arc_dec[:, 0], pred_ra, pred_dec)
    c_ra, c_dec = _offset(pred_ra, pred_dec, (e.min() + e.max()) / 2, (n.min() + n.max()) / 2)
    size = int(round(REGION_ARCMIN * 60 / PIXEL_ARCSEC)) | 1
    grid = Grid(c_ra, c_dec, size)
    gra, gdec = grid.sky()

    # the body's motion within the window, at the focus distance
    track_ra, track_dec = parallax.predict_track(seed_ra, seed_dec, seed_mjd, distance_au, np.array([h.mjd for h in window]))
    half = int(np.ceil(size * 0.75)) + 30

    def one(i_h):
        i, h = i_h
        try:
            cut = read_cutout(h.key, c_ra, c_dec, half=half)
        except Exception:
            return None
        if cut is None:
            return None
        de, dn = tangent_offsets_arcsec(track_ra[i], track_dec[i], pred_ra, pred_dec)
        t_ra, t_dec = _offset(c_ra, c_dec, float(np.asarray(de).item()), float(np.asarray(dn).item()))
        moving = Grid(t_ra, t_dec, size)
        mra, mdec = moving.sky()
        static = _noise_normalised(resample(cut, gra, gdec))
        tracked = _noise_normalised(resample(cut, mra, mdec))
        if static is None or tracked is None:
            return None
        return static, tracked

    with ThreadPoolExecutor(workers) as pool:
        planes = [p for p in pool.map(one, enumerate(window)) if p is not None]
    if len(planes) < 5:
        return NextVisit("not_observed", t_mid=t_mid, predicted=(pred_ra, pred_dec), arc=arc, exposures=len(planes))
    with np.errstate(all="ignore"):
        s_cube = np.array([p[0] for p in planes])
        t_cube = np.array([p[1] for p in planes])
        static = np.nanmedian(s_cube, axis=0)
        tracked = np.nanmedian(t_cube, axis=0)
        k = len(planes) // 2  # planes are in time order: the first and second half of the window
        halves = [(np.nanmedian(t_cube[:k], axis=0), np.nanmedian(s_cube[:k], axis=0)), (np.nanmedian(t_cube[k:], axis=0), np.nanmedian(s_cube[k:], axis=0))]
    # where few exposures overlap (detector edges) the medians are noisy and breed false peaks
    need = max(5, int(np.ceil(MIN_COVERAGE * len(planes))))
    covered = (np.isfinite(s_cube).sum(axis=0) >= need) & (np.isfinite(t_cube).sum(axis=0) >= need)
    del s_cube, t_cube
    # the body's motion in grid pixels since mid-window (east is left), and the search band around the arc
    de, dn = tangent_offsets_arcsec(track_ra, track_dec, pred_ra, pred_dec)
    shifts = np.column_stack([-np.asarray(de) / PIXEL_ARCSEC, np.asarray(dn) / PIXEL_ARCSEC])
    dense = np.geomspace(distances[0], distances[-1], 120)
    dra, ddec = parallax.predict_track(seed_ra, seed_dec, seed_mjd, dense, np.array([t_mid]))
    ax, ay = grid.pixel_of(dra[:, 0], ddec[:, 0])
    yy, xx = np.indices((size, size))
    near, _ = cKDTree(np.column_stack([ax, ay])).query(np.column_stack([xx.ravel(), yy.ravel()]))
    allowed = ((near.reshape(size, size) * PIXEL_ARCSEC / 60) <= SEARCH_FROM_ARC_ARCMIN) & covered
    snr_map = difference_snr(tracked, static, allowed)
    half_maps = [difference_snr(t, st, allowed) for t, st in halves]
    found = None
    for x, y, snr in candidates(snr_map, static, shifts, allowed):
        if snr < DETECTION_SNR:
            break
        if dipole_ratio(snr_map, x, y) > DIPOLE_MAX:
            continue
        split = [near_max(m, x, y) for m in half_maps]
        if all(np.isfinite(v) and v >= HALF_SNR for v in split):
            sky_ra, sky_dec = grid_sky_at(grid, x, y)
            found = {"x": x, "y": y, "ra": sky_ra, "dec": sky_dec, "snr": snr, "halves": split, "offset_arcsec": float(separation_arcsec(sky_ra, sky_dec, pred_ra, pred_dec))}
            break
    return NextVisit(
        status="found" if found else "not_found",
        t_mid=t_mid,
        predicted=(pred_ra, pred_dec),
        arc=arc,
        centre=(c_ra, c_dec),
        size=size,
        tracked=tracked.astype(np.float32),
        static=static.astype(np.float32),
        found=found,
        window=(window[0].mjd, window[-1].mjd),
        exposures=len(planes),
    )


def _offset(ra: float, dec: float, east_arcsec: float, north_arcsec: float) -> tuple[float, float]:
    """Sky position at a tangent-plane offset from (ra, dec)."""
    xi, eta = np.radians(east_arcsec / 3600), np.radians(north_arcsec / 3600)
    ra0, dec0 = np.radians(ra), np.radians(dec)
    den = np.cos(dec0) - eta * np.sin(dec0)
    r = ra0 + np.arctan2(xi, den)
    d = np.arctan2(np.sin(dec0) + eta * np.cos(dec0), np.hypot(xi, den))
    return float(np.degrees(r) % 360), float(np.degrees(d))


def grid_sky_at(grid: Grid, x: float, y: float) -> tuple[float, float]:
    """Sky position of grid pixel (column x, row y)."""
    half = (grid.size - 1) / 2
    return _offset(grid.ra, grid.dec, -(x - half) * grid.scale_arcsec, (y - half) * grid.scale_arcsec)
