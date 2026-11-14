"""The field search on synthetic exposures: a moving body is found at its distance, a fixed source is not.

Code written with AI assistance (Claude); see AI_USAGE.md.
"""
from types import SimpleNamespace

import numpy as np

from sedna.science.focus import distance_ladder
from sedna.science.stack import Grid
from sedna.search_service import _offsets, scan

SIZE = 59


def field(sources, n=30, seed=1):
    """Noise-unit exposures over 4 days with point sources: (x, y at the first exposure, amplitude, distance au or None)."""
    rng = np.random.default_rng(seed)
    grid = Grid(199.94, 21.49, SIZE)
    mjd = 60839.0 + np.linspace(0, 4, n)
    distances = distance_ladder()[:-1]
    dx, dy = _offsets(grid, mjd, distances)
    jj, ii = np.mgrid[0:SIZE, 0:SIZE]
    usable = []
    for t in range(n):
        plane = rng.normal(0, 1, (SIZE, SIZE))
        for x0, y0, amp, au in sources:
            d = None if au is None else int(np.argmin(np.abs(distances - au)))
            sx = x0 + (dx[d, t] if d is not None else 0.0)
            sy = y0 + (dy[d, t] if d is not None else 0.0)
            plane += amp * np.exp(-((ii - sx) ** 2 + (jj - sy) ** 2) / 2.0)
        usable.append((SimpleNamespace(mjd=float(mjd[t])), plane.astype(np.float32)))
    return grid, usable


def test_moving_body_is_found_at_its_distance():
    grid, usable = field([(29, 29, 1.5, 50.0)])
    _, _, found, _ = scan(grid, usable)
    assert found, "the body was not found"
    top = found[0]
    assert abs(top["x"] - 29) <= 1 and abs(top["y"] - 29) <= 1
    assert abs(top["distance_au"] - 50.0) / 50.0 < 0.15
    assert top["snr"] > 8
    assert min(top["halves"]) > 3
    assert len(top["track"]) == len(usable)
    assert top["motion_arcsec"] > 60  # about 20 pixels in 4 days at 50 au


def test_fixed_source_is_not_a_candidate():
    grid, usable = field([(15, 44, 2.0, None)])
    _, _, found, _ = scan(grid, usable)
    assert not [c for c in found if abs(c["x"] - 15) <= 4 and abs(c["y"] - 44) <= 4]


def test_noise_alone_gives_no_candidate():
    grid, usable = field([], seed=7)
    best, _, found, noise = scan(grid, usable)
    assert found == [] and noise == []
    assert np.nanmax(np.where(np.isfinite(best), best, np.nan)) < 5.5
