"""From a sky position to aligned SPHEREx frames, one per visit and detector.

Every exposure is resampled onto one north-up tangent-plane grid centred on the
requested position (east to the left, 6.15 arcsec pixels), after subtracting its
own median background. Exposures of the same visit and detector are averaged
with outlier rejection. Pixels never observed stay NaN.

Code written with AI assistance (Claude); see AI_USAGE.md.
"""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field

import numpy as np
from scipy.ndimage import map_coordinates

from ..archive.cutout import Cutout, read_cutout
from ..archive.skyindex import Hit, SkyIndex, split_visits

PIXEL_ARCSEC = 6.15
# from the pipeline's wavelength maps (archive/wavelength.py), rounded outward
DETECTOR_RANGE_UM = {1: (0.73, 1.13), 2: (1.08, 1.67), 3: (1.61, 2.44), 4: (2.39, 3.87), 5: (3.79, 4.45), 6: (4.40, 5.03)}


@dataclass
class Grid:
    """North-up TAN grid centred on (ra, dec). Row 0 is the southern edge; column 0 the eastern edge."""

    ra: float
    dec: float
    size: int
    scale_arcsec: float = PIXEL_ARCSEC

    def sky(self) -> tuple[np.ndarray, np.ndarray]:
        half = (self.size - 1) / 2
        j, i = np.mgrid[0 : self.size, 0 : self.size]
        xi = np.radians(-(i - half) * self.scale_arcsec / 3600)  # east is left, so RA grows to the left
        eta = np.radians((j - half) * self.scale_arcsec / 3600)
        ra0, dec0 = np.radians(self.ra), np.radians(self.dec)
        rho = np.hypot(xi, eta)
        c = np.arctan(rho)
        with np.errstate(invalid="ignore", divide="ignore"):
            dec = np.arcsin(np.cos(c) * np.sin(dec0) + np.where(rho > 0, eta * np.sin(c) * np.cos(dec0) / rho, 0))
            ra = ra0 + np.arctan2(xi * np.sin(c), rho * np.cos(dec0) * np.cos(c) - eta * np.sin(dec0) * np.sin(c))
        ra = np.where(rho > 0, ra, ra0)
        dec = np.where(rho > 0, dec, dec0)
        return np.degrees(ra) % 360, np.degrees(dec)

    def pixel_of(self, ra, dec) -> tuple[np.ndarray, np.ndarray]:
        """Grid (column, row) of sky positions; inverse of ``sky`` for points near the centre."""
        ra0, dec0 = np.radians(self.ra), np.radians(self.dec)
        ra, dec = np.radians(ra), np.radians(dec)
        cosc = np.sin(dec0) * np.sin(dec) + np.cos(dec0) * np.cos(dec) * np.cos(ra - ra0)
        xi = np.cos(dec) * np.sin(ra - ra0) / cosc
        eta = (np.cos(dec0) * np.sin(dec) - np.sin(dec0) * np.cos(dec) * np.cos(ra - ra0)) / cosc
        half = (self.size - 1) / 2
        return half - np.degrees(xi) * 3600 / self.scale_arcsec, half + np.degrees(eta) * 3600 / self.scale_arcsec


def resample(cut: Cutout, grid_ra: np.ndarray, grid_dec: np.ndarray) -> np.ndarray:
    """Bilinear resampling of one cutout onto the grid; NaN where the cutout has no data."""
    pix = cut.wcs.all_world2pix(np.column_stack([grid_ra.ravel(), grid_dec.ravel()]), 0, quiet=True)
    x = pix[:, 0].reshape(grid_ra.shape) - cut.x0
    y = pix[:, 1].reshape(grid_ra.shape) - cut.y0
    img = cut.image.astype(np.float64)
    bad = ~np.isfinite(img)
    filled = np.where(bad, 0.0, img)
    out = map_coordinates(filled, [y, x], order=1, mode="constant", cval=np.nan)
    weight = map_coordinates((~bad).astype(float), [y, x], order=1, mode="constant", cval=0.0)
    out[weight < 0.999] = np.nan
    return out.astype(np.float32)


def robust_mean(cube: np.ndarray, clip: float = 3.0) -> np.ndarray:
    """Mean along axis 0 after rejecting values far from the median (cosmic rays, passing objects)."""
    if cube.shape[0] < 3:
        return np.nanmean(cube, axis=0)
    med = np.nanmedian(cube, axis=0)
    mad = 1.4826 * np.nanmedian(np.abs(cube - med), axis=0)
    floor = np.nanmedian(mad[np.isfinite(mad)]) if np.isfinite(mad).any() else 0.0
    keep = np.abs(cube - med) <= clip * np.maximum(mad, floor)
    with np.errstate(invalid="ignore"):
        return np.nanmean(np.where(keep, cube, np.nan), axis=0)


@dataclass
class Frame:
    visit: int
    det: int
    mjd_start: float
    mjd_end: float
    n_exposures: int
    image: np.ndarray
    exposures: list[dict] = field(default_factory=list)


@dataclass
class Stack:
    grid: Grid
    frames: list[Frame]
    n_requested: int
    n_read: int


def build_stack(index: SkyIndex, ra: float, dec: float, fov_arcmin: float = 6.0, detectors=(1, 2, 3, 4, 5, 6), position_at=None, workers: int = 24) -> Stack:
    """Aligned frames for a position. ``position_at(mjd)`` centres cutouts on a moving target; the grid stays fixed on the sky."""
    size = int(round(fov_arcmin * 60 / PIXEL_ARCSEC)) | 1
    grid = Grid(ra, dec, size)
    gra, gdec = grid.sky()
    half = int(np.ceil(size * 0.75)) + 2  # covers the grid at any detector orientation
    hits = index.lookup(ra, dec, detectors=detectors)
    visits = split_visits(hits)

    def load(h: Hit):
        try:
            return read_cutout(h.key, ra, dec, half=half)
        except Exception:
            return None

    with ThreadPoolExecutor(workers) as pool:
        cuts = list(pool.map(load, hits))

    by_hit = {id(h): c for h, c in zip(hits, cuts)}
    frames: list[Frame] = []
    for vi, visit in enumerate(visits):
        for det in detectors:
            members = [(h, by_hit[id(h)]) for h in visit if h.det == det and by_hit[id(h)] is not None]
            if not members:
                continue
            planes = []
            for _, c in members:
                plane = resample(c, gra, gdec)
                if np.isfinite(plane).mean() < 0.2:
                    continue
                planes.append(plane - np.nanmedian(plane))
            if not planes:
                continue
            frames.append(
                Frame(
                    visit=vi,
                    det=det,
                    mjd_start=min(c.mjd for _, c in members),
                    mjd_end=max(c.mjd for _, c in members),
                    n_exposures=len(planes),
                    image=robust_mean(np.array(planes)),
                    exposures=[{"obsid": c.obsid, "mjd": c.mjd, "key": c.key, "y": c.y} for _, c in members],
                )
            )
    return Stack(grid=grid, frames=frames, n_requested=len(hits), n_read=sum(c is not None for c in cuts))


def build_film(index: SkyIndex, ra: float, dec: float, fov_arcmin: float = 6.0, visit: int = 0, detectors=(1, 2, 3, 4), workers: int = 24, limit: int = 96):
    """Single exposures of one visit on the north-up grid, each divided by its own noise, in time order.

    Unlike the per-visit frames, nothing is averaged, so a body that moves within the visit is still there.
    Returns (grid, number of visits, visit used, list of {mjd, det, obsid, image}).
    """
    size = int(round(fov_arcmin * 60 / PIXEL_ARCSEC)) | 1
    grid = Grid(ra, dec, size)
    gra, gdec = grid.sky()
    half = int(np.ceil(size * 0.75)) + 2
    visits = split_visits(index.lookup(ra, dec, detectors=detectors))
    if not visits:
        return grid, 0, 0, []
    visit = min(max(visit, 0), len(visits) - 1)
    hits = visits[visit]
    if len(hits) > limit:  # keep an even sample in time
        hits = [hits[i] for i in np.linspace(0, len(hits) - 1, limit).round().astype(int)]

    def load(h: Hit):
        try:
            c = read_cutout(h.key, ra, dec, half=half)
        except Exception:
            return None
        if c is None:
            return None
        plane = resample(c, gra, gdec)
        finite = np.isfinite(plane)
        if finite.mean() < 0.6:
            return None
        med = np.median(plane[finite])
        noise = 1.4826 * np.median(np.abs(plane[finite] - med))
        if not noise > 0:
            return None
        return {"mjd": c.mjd, "det": c.det, "obsid": c.obsid, "image": ((plane - med) / noise).astype(np.float32)}

    with ThreadPoolExecutor(workers) as pool:
        frames = [f for f in pool.map(load, hits) if f is not None]
    frames.sort(key=lambda f: f["mjd"])
    return grid, len(visits), visit, frames


def build_timebins(index: SkyIndex, ra: float, dec: float, fov_arcmin: float = 8.0, bin_days: float = 10.0, detectors=(1, 2, 3, 4, 5, 6), workers: int = 24) -> Stack:
    """Like ``build_stack``, but frames are time bins of ``bin_days`` instead of whole visits.

    Meant for fields observed continuously, such as SPHEREx's deep fields near the
    ecliptic poles, where one 'visit' can last months. ``Frame.visit`` holds the bin number.
    """
    size = int(round(fov_arcmin * 60 / PIXEL_ARCSEC)) | 1
    grid = Grid(ra, dec, size)
    gra, gdec = grid.sky()
    half = int(np.ceil(size * 0.75)) + 2
    hits = index.lookup(ra, dec, detectors=detectors)
    if not hits:
        return Stack(grid=grid, frames=[], n_requested=0, n_read=0)
    t0 = hits[0].mjd

    def load(h: Hit):
        try:
            c = read_cutout(h.key, ra, dec, half=half)
        except Exception:
            return None
        if c is None:
            return None
        plane = resample(c, gra, gdec)
        if np.isfinite(plane).mean() < 0.2:
            return None
        return h, c, plane - np.nanmedian(plane)

    with ThreadPoolExecutor(workers) as pool:
        loaded = [x for x in pool.map(load, hits) if x is not None]
    groups: dict[tuple[int, int], list] = {}
    for h, c, plane in loaded:
        groups.setdefault((int((h.mjd - t0) // bin_days), h.det), []).append((c, plane))
    frames = []
    for (b, det), members in sorted(groups.items()):
        frames.append(
            Frame(
                visit=b,
                det=det,
                mjd_start=min(c.mjd for c, _ in members),
                mjd_end=max(c.mjd for c, _ in members),
                n_exposures=len(members),
                image=robust_mean(np.array([p for _, p in members])),
            )
        )
    return Stack(grid=grid, frames=frames, n_requested=len(hits), n_read=len(loaded))
