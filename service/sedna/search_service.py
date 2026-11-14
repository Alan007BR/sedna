"""Search a whole field for moving bodies, without a starting point: shift-and-stack per trial distance.

The distance focus needs a point to start from, and someone looking at a region does
not know where an unseen body is. Within a few arcminutes a distant body moves the
same way anywhere in the field, so every exposure of one visit (stars removed with a
static sky from other visits) is shifted as a whole for each trial distance and
stacked. A body at that distance adds up to a point wherever it is. The best S/N over
all distances, per pixel, is the search map; its peaks are candidates. The same
search on the negated exposures, where no real source exists, counts the peaks that
noise alone gives in this field. ``probes/p18_field_search.py`` is the reasoning:
Makemake's field gives Makemake alone, at S/N 33; Sedna, at S/N 4-5 per visit,
stays among the noise peaks.

Code written with AI assistance (Claude); see AI_USAGE.md.
"""
from __future__ import annotations

import warnings
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field

import numpy as np
from scipy.ndimage import map_coordinates, maximum_filter, uniform_filter

from .archive.cutout import read_cutout
from .archive.net import WORKERS
from .archive.skyindex import Hit, SkyIndex, split_visits
from .focus_service import densest_window
from .follow_service import _normalised
from .next_visit_service import grid_sky_at
from .science import parallax
from .science.focus import distance_ladder
from .science.movers import separation_arcsec
from .science.stack import PIXEL_ARCSEC, Grid, resample, robust_mean

DETECTORS = (1, 2, 3, 4)  # the same as the single exposures and the distance focus
WINDOW_DAYS = 6.0
STAR_SIGMA = 4.0  # static sky brighter than this (in exposure noise) is a star: masked, with 2 pixels around
MIN_MOTION_PX = 4.0  # a body moving less than this in the window cannot be told from a star that changed (2 px let one through in 16 random fields)
MIN_COVER = 0.6  # share of the exposures that must cover a pixel at a trial distance
CANDIDATE_SNR = 5.0
HALF_SNR = 3.5  # a candidate must also show in each half of the exposures that cover it, as in the next-visit check (2.5 let one through: probes/p19)
MAX_TEMPLATES = 40  # static-sky exposures per detector, spread over the other visits
MAX_CANDIDATES = 6
EDGE = 3
MIN_EXPOSURES = 8
FIXED_SHARE = 0.5  # with no shift, a moving body must stay under this share of its S/N when followed (Makemake: 0.2)
MIN_HALF = 4  # exposures in each half
RULES = 5  # bump when a rule above changes, so cached answers are not reused
DEBUG = False


@dataclass
class FieldSearch:
    grid: Grid
    visits: int
    visit: int
    mjd: np.ndarray  # the exposures searched, in time order
    templates: int
    snr_map: np.ndarray  # best S/N over all trial distances, per pixel
    distance_map: np.ndarray
    candidates: list[dict] = field(default_factory=list)
    noise_peaks: list[float] = field(default_factory=list)  # S/N of the peaks the negated search gives, rules applied
    farthest_au: float = 0.0  # the largest trial distance at which a body moves enough in this window to be searched


def _residuals(index: SkyIndex, ra: float, dec: float, size: int, visit: int, workers: int):
    grid = Grid(ra, dec, size)
    gra, gdec = grid.sky()
    hits = index.lookup(ra, dec, detectors=DETECTORS)
    visits = split_visits(hits)
    if not visits:
        raise LookupError("SPHEREx has no usable exposure of this field in the indexed data.")
    visit = min(max(visit, 0), len(visits) - 1)
    own = densest_window(visits[visit], WINDOW_DAYS)
    t0, t1 = visits[visit][0].mjd - 20, visits[visit][-1].mjd + 20
    others: list[Hit] = []
    for det in DETECTORS:
        pool = [h for h in hits if h.det == det and not (t0 <= h.mjd <= t1)]
        if len(pool) > MAX_TEMPLATES:
            pool = [pool[i] for i in np.linspace(0, len(pool) - 1, MAX_TEMPLATES).round().astype(int)]
        others += pool

    def on_grid(h: Hit):
        try:
            cut = read_cutout(h.key, ra, dec, half=int(size * 0.75) + 4)
        except Exception:
            return None
        if cut is None or _normalised(cut) is None:
            return None
        return resample(cut, gra, gdec)

    with ThreadPoolExecutor(workers) as pool:
        own_p = list(pool.map(on_grid, own))
        sky_p = list(pool.map(on_grid, others))
    static = {}
    for det in DETECTORS:
        planes = [p for h, p in zip(others, sky_p) if p is not None and h.det == det]
        if len(planes) >= 3:
            static[det] = np.nanmedian(np.array(planes), axis=0)
    bright = np.zeros((size, size), bool)
    for tpl in static.values():
        bright |= np.nan_to_num(tpl) > STAR_SIGMA
    bright = maximum_filter(bright.astype(np.uint8), size=5).astype(bool)
    usable = [(h, np.where(bright, np.nan, p - static[h.det])) for h, p in zip(own, own_p) if p is not None and h.det in static]
    usable.sort(key=lambda u: u[0].mjd)
    return grid, usable, len(visits), visit, sum(1 for p in sky_p if p is not None)


def _offsets(grid: Grid, mjd: np.ndarray, distances: np.ndarray):
    """Where a body at each trial distance has moved since the first exposure, in grid pixels: (D, T) each."""
    t0 = float(mjd.min())
    earth = parallax.earth_position(mjd)
    earth0 = parallax.earth_position([t0])[0]
    ra_t, dec_t = parallax.predict_track(grid.ra, grid.dec, t0, distances, mjd, earth=earth, earth0=earth0)
    px, py = grid.pixel_of(ra_t, dec_t)
    c = (grid.size - 1) / 2
    return np.asarray(px) - c, np.asarray(py) - c


def _snr(planes: list[np.ndarray]) -> np.ndarray:
    """3x3 box S/N of a robust-mean stack, against the scatter of 3x3 boxes over the field."""
    cube = np.array(planes)
    cover = np.isfinite(cube).mean(axis=0)
    with warnings.catch_warnings():  # pixels no exposure covers at this shift: NaN, masked just below
        warnings.simplefilter("ignore", RuntimeWarning)
        stack = robust_mean(cube)
    stack = np.where(cover >= MIN_COVER, stack, np.nan)
    ok = np.isfinite(stack)
    if ok.sum() < 50:
        return np.full(stack.shape, -np.inf)
    box = uniform_filter(np.nan_to_num(stack), size=3) * 9
    med = np.median(box[ok])
    noise = 1.4826 * np.median(np.abs(box[ok] - med))
    return np.where(ok, (box - med) / noise, -np.inf) if noise > 0 else np.full(stack.shape, -np.inf)


def _shifted(resid: np.ndarray, dx: float, dy: float, jj: np.ndarray, ii: np.ndarray) -> np.ndarray:
    return map_coordinates(resid, [jj + dy, ii + dx], order=1, mode="constant", cval=np.nan)


def _search(usable, dx, dy, distances, sign: float):
    size = usable[0][1].shape[0]
    jj, ii = np.mgrid[0:size, 0:size].astype(float)
    best = np.full((size, size), -np.inf)
    best_d = np.zeros((size, size))
    for d in range(len(distances)):
        if np.hypot(np.ptp(dx[d]), np.ptp(dy[d])) < MIN_MOTION_PX:
            continue
        snr = _snr([sign * _shifted(r, dx[d, t], dy[d, t], jj, ii) for t, (_, r) in enumerate(usable)])
        better = snr > best
        best[better], best_d[better] = snr[better], distances[d]
    return best, best_d


def _peaks(best: np.ndarray, threshold: float) -> list[tuple[int, int, float]]:
    score = np.where(np.isfinite(best), best, -np.inf)
    score[:EDGE, :] = score[-EDGE:, :] = score[:, :EDGE] = score[:, -EDGE:] = -np.inf
    local = (score == maximum_filter(score, size=7)) & (score >= threshold)
    ys, xs = np.nonzero(local)
    order = np.argsort(-score[ys, xs])
    return [(int(xs[k]), int(ys[k]), float(score[ys[k], xs[k]])) for k in order]


def _near(snr: np.ndarray, x: int, y: int, radius: int = 1) -> float:
    win = snr[max(0, y - radius) : y + radius + 1, max(0, x - radius) : x + radius + 1]
    return float(np.max(win)) if np.isfinite(win).any() else float("-inf")


def _halves(usable, dx, dy, d: int, x: int, y: int, sign: float) -> list[float]:
    """S/N near (x, y) in the stacks of the first and the second half of the exposures that cover it, at trial distance d.

    Only the exposures where the candidate's track is inside the field (and off the star mask) are split: a body
    near the edge leaves the field during the visit, and splitting all exposures would leave one half empty.
    """
    size = usable[0][1].shape[0]
    jj, ii = np.mgrid[0:size, 0:size].astype(float)
    planes = [sign * _shifted(r, dx[d, t], dy[d, t], jj, ii) for t, (_, r) in enumerate(usable)]
    covering = [p for p in planes if np.isfinite(p[y, x])]
    if len(covering) < 2 * MIN_HALF:
        return [float("-inf"), float("-inf")]
    k = len(covering) // 2
    return [_near(_snr(covering[:k]), x, y), _near(_snr(covering[k:]), x, y)]


def _fixed_along(fixed: np.ndarray, dx, dy, d: int, x: int, y: int) -> float:
    """Highest S/N of the unshifted stack along the path a body at trial distance d would take from (x, y).

    A source that did not move (a variable star, a star that changed between visits) is as strong or
    stronger with no shift; a body that moves is smeared out there.
    """
    best = float("-inf")
    for t in np.linspace(0, dx.shape[1] - 1, 7).round().astype(int):
        px, py = int(round(x + dx[d, t])), int(round(y + dy[d, t]))
        if 0 <= px < fixed.shape[1] and 0 <= py < fixed.shape[0]:
            best = max(best, _near(fixed, px, py))
    return best


def search_field(index: SkyIndex, ra: float, dec: float, fov_arcmin: float = 6.0, visit: int = 0, workers: int = WORKERS) -> FieldSearch:
    size = int(round(fov_arcmin * 60 / PIXEL_ARCSEC)) | 1
    grid, usable, n_visits, visit, templates = _residuals(index, ra, dec, size, visit, workers)
    if len(usable) < MIN_EXPOSURES:
        raise ValueError("too few usable exposures in this visit")
    best, best_d, found, noise = scan(grid, usable)
    return FieldSearch(
        grid=grid,
        visits=n_visits,
        visit=visit,
        mjd=np.array([h.mjd for h, _ in usable]),
        templates=templates,
        snr_map=np.where(np.isfinite(best), best, np.nan).astype(np.float32),
        distance_map=best_d.astype(np.float32),
        candidates=found,
        noise_peaks=noise,
        farthest_au=farthest_searched(grid, np.array([h.mjd for h, _ in usable])),
    )


def farthest_searched(grid: Grid, mjd: np.ndarray) -> float:
    distances = distance_ladder()[:-1]
    dx, dy = _offsets(grid, mjd, distances)
    moving = np.flatnonzero(np.hypot(np.ptp(dx, axis=1), np.ptp(dy, axis=1)) >= MIN_MOTION_PX)
    return float(distances[moving.max()]) if len(moving) else 0.0


def scan(grid: Grid, usable: list) -> tuple[np.ndarray, np.ndarray, list[dict], list[float]]:
    """The search on prepared exposures: ``usable`` holds (anything with ``.mjd``, residual plane) in time order.

    Returns the search map, the distance map, the candidates and the S/N of the noise peaks.
    """
    distances = distance_ladder()[:-1]
    mjd = np.array([h.mjd for h, _ in usable])
    dx, dy = _offsets(grid, mjd, distances)
    index_of = {float(d): i for i, d in enumerate(distances)}
    if not (np.hypot(np.ptp(dx, axis=1), np.ptp(dy, axis=1)) >= MIN_MOTION_PX).any():
        raise ValueError("the exposures span too little time for any trial distance to move enough")

    def screened(best, best_d, sign):
        fixed = _snr([sign * r for _, r in usable])
        kept = []
        for x, y, snr in _peaks(best, CANDIDATE_SNR):
            d = index_of[float(best_d[y, x])]
            halves = _halves(usable, dx, dy, d, x, y, sign)
            still = _fixed_along(fixed, dx, dy, d, x, y)
            if DEBUG:
                print(f"    {'+' if sign > 0 else '-'} ({x},{y}) S/N {snr:.1f} at {distances[d]:.0f} au, halves {halves[0]:.1f} {halves[1]:.1f}, unshifted {still:.1f}")
            if min(halves) >= HALF_SNR and still < FIXED_SHARE * snr:
                kept.append((x, y, snr, d, halves))
        return kept

    best, best_d = _search(usable, dx, dy, distances, 1.0)
    neg, neg_d = _search(usable, dx, dy, distances, -1.0)
    noise = [snr for _, _, snr, _, _ in screened(neg, neg_d, -1.0)]

    t0 = float(mjd.min())
    t_mid = float(np.median(mjd))
    found = []
    for x, y, snr, d, halves in screened(best, best_d, 1.0)[:MAX_CANDIDATES]:
        ra0, dec0 = grid_sky_at(grid, x, y)  # where it was at the first exposure: the stack is aligned there
        track_ra, track_dec = parallax.predict_track(ra0, dec0, t0, float(distances[d]), mjd)
        mid_ra, mid_dec = parallax.predict_track(ra0, dec0, t0, float(distances[d]), np.array([t_mid]))
        found.append(
            {
                "x": x,
                "y": y,
                "snr": snr,
                "halves": halves,
                "distance_au": float(distances[d]),
                "ra": float(mid_ra[0]),
                "dec": float(mid_dec[0]),
                "mjd": t_mid,
                "motion_arcsec": float(separation_arcsec(track_ra[0], track_dec[0], track_ra[-1], track_dec[-1])),
                "track": [(float(t), float(r), float(c)) for t, r, c in zip(mjd, track_ra, track_dec)],
            }
        )
    return best, best_d, found, noise
