"""Parallax ruler and next-visit search on synthetic data: no network.

Code written with AI assistance (Claude); see AI_USAGE.md.
"""
import numpy as np
import pytest

from sedna.next_visit_service import _offset, candidates, difference_snr, dipole_ratio, grid_sky_at, trail_mask
from sedna.science.movers import separation_arcsec, tangent_offsets_arcsec
from sedna.science.parallax import PARSEC_AU, ruler, stays_in_field_beyond
from sedna.science.stack import Grid

RA, DEC, T0 = 200.0, 21.5, 60834.0  # Makemake's field in June 2025


def test_ruler_same_date_does_not_move():
    ras, decs = ruler(RA, DEC, T0, T0)
    assert np.all(separation_arcsec(ras, decs, RA, DEC) < 1e-6)


def test_ruler_nearer_bodies_move_further():
    ras, decs = ruler(RA, DEC, T0, T0 + 200)
    shift = separation_arcsec(ras, decs, RA, DEC)
    assert np.all(np.diff(shift) < 0)  # 50, 100, 300, 500 au, 2 pc
    assert 1.0 < shift[0] / 3600 < 4.0  # a body at 50 au jumps degrees in 200 days
    assert shift[-1] < 1.1  # a star at 2 pc: under an arcsecond of parallax


def test_star_parallax_matches_textbook_size():
    # two views half a year apart swing a star at 2 pc by up to twice its parallax (0.5")
    ras, decs = ruler(RA, DEC, T0, T0 + 182.6, [2 * PARSEC_AU])
    assert separation_arcsec(ras[0], decs[0], RA, DEC) <= 1.0 + 1e-3


def test_bigger_fields_hold_nearer_bodies():
    small = stays_in_field_beyond(RA, DEC, T0, T0 + 200, 180.0)
    large = stays_in_field_beyond(RA, DEC, T0, T0 + 200, 450.0)
    assert small is not None and large is not None and large < small


def test_offset_round_trip_and_grid_position():
    r, d = _offset(RA, DEC, 120.0, -45.0)
    east, north = tangent_offsets_arcsec(r, d, RA, DEC)
    assert east == pytest.approx(120.0, abs=1e-3) and north == pytest.approx(-45.0, abs=1e-3)
    g = Grid(RA, DEC, 51)
    gra, gdec = g.sky()
    r2, d2 = grid_sky_at(g, 40, 12)
    assert separation_arcsec(r2, d2, gra[12, 40], gdec[12, 40]) < 1e-3


def gaussian(shape, x, y, amp, sigma=0.9):
    yy, xx = np.indices(shape)
    return amp * np.exp(-((xx - x) ** 2 + (yy - y) ** 2) / (2 * sigma**2))


def test_moving_body_is_found_and_star_dipoles_are_rejected():
    rng = np.random.default_rng(5)
    shape = (81, 81)
    noise = lambda: rng.normal(0, 0.3, shape)  # noqa: E731
    star = gaussian(shape, 20, 60, 30.0)
    # a bright star shifted by one pixel between the stacks (the dipole a small tracking shift leaves)
    static = star + gaussian(shape, 60, 20, 30.0) + noise()
    tracked = star + gaussian(shape, 61, 20, 30.0) + noise()
    # the body: sharp in the tracked stack, smeared along its motion in the static one
    tracked += gaussian(shape, 40, 40, 4.0)
    static += sum(gaussian(shape, 36 + k, 40, 4.0 / 9) for k in range(9))
    snr = difference_snr(tracked, static)
    shifts = np.array([[-4.0, 0.0], [4.0, 0.0]])
    found = [(x, y) for x, y, s in candidates(snr, static, shifts) if s >= 7 and dipole_ratio(snr, x, y) <= 1.0]
    assert found and found[0] == (40, 40)


def test_trail_mask_covers_a_star_swept_by_the_motion():
    static = np.zeros((41, 41))
    static[20, 20] = 10.0
    mask = trail_mask(static, np.array([[-5.0, 0.0], [5.0, 0.0]]))
    assert mask[20, 15] and mask[20, 25] and not mask[30, 20]
