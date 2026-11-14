"""Known-mover crossings on synthetic sightings: no network.

Code written with AI assistance (Claude); see AI_USAGE.md.
"""
from types import SimpleNamespace

import numpy as np
import pytest

from sedna.archive.skybot import _sexagesimal
from sedna.science.movers import crossings, group_times, move_linear, query_radius_deg, separation_arcsec, tangent_offsets_arcsec

RA0, DEC0 = 199.94124, 21.48776
HALF = 180.0  # a 6 arcmin field


def body(east_arcsec, north_arcsec, rate_ra, rate_dec, mjd, name="Test", number=1, v=17.0):
    dec = DEC0 + north_arcsec / 3600
    ra = RA0 + east_arcsec / 3600 / np.cos(np.radians(DEC0))
    return SimpleNamespace(name=name, number=number, cls="MB>Inner", v=v, ra=ra, dec=dec, rate_ra=rate_ra, rate_dec=rate_dec, distance_au=2.0, mjd=mjd)


def test_group_times_never_spans_more_than_a_day():
    groups = group_times([5.0, 0.0, 0.2, 0.9, 1.1, 0.2])
    assert [g.tolist() for g in groups] == [[0.0, 0.2, 0.9], [1.1], [5.0]]


def test_move_linear_rates_are_arcsec_per_hour_with_cos_dec():
    ra, dec = move_linear(100.0, 60.0, 3600.0, 3600.0, 0.0, 1 / 24)
    assert dec == pytest.approx(61.0)
    assert ra == pytest.approx(100.0 + 1.0 / np.cos(np.radians(60.0)))


def test_tangent_offsets_point_north_and_east():
    east, north = tangent_offsets_arcsec(RA0, DEC0 + 60 / 3600, RA0, DEC0)
    assert north == pytest.approx(60.0, abs=1e-3) and east == pytest.approx(0.0, abs=1e-6)  # tan projection: 2 µas
    east, _ = tangent_offsets_arcsec(RA0 + 60 / 3600 / np.cos(np.radians(DEC0)), DEC0, RA0, DEC0)
    assert east == pytest.approx(60.0, abs=0.01)


def test_body_crossing_the_field_is_kept_only_while_inside():
    t0 = 60834.0
    times = t0 + np.arange(6) / 24  # one exposure an hour
    walker = body(300.0, 0.0, -100.0, 0.0, t0)  # 300" east, moving west at 100"/h
    found = crossings([(times, [walker])], RA0, DEC0, HALF)
    assert len(found) == 1
    c = found[0]
    assert c.mjd == pytest.approx(list(times[2:5]))  # at +100", 0", -100"
    assert c.closest_mjd == pytest.approx(times[3])
    assert c.closest_arcsec == pytest.approx(0.0, abs=0.5)
    assert c.rate_arcsec_h == pytest.approx(100.0)


def test_body_that_stays_outside_is_ignored():
    times = 60834.0 + np.arange(6) / 24
    far = body(0.0, 900.0, 10.0, 0.0, 60834.0)
    assert crossings([(times, [far])], RA0, DEC0, HALF) == []


def test_same_body_in_two_groups_is_one_crossing_in_time_order():
    g1 = 60834.0 + np.array([0.0, 0.1])
    g2 = 60835.0 + np.array([0.0, 0.1])
    slow_a = body(10.0, 0.0, -1.0, 0.0, g1[0], name="Makemake", number=136472)
    slow_b = body(-14.0, 0.0, -1.0, 0.0, g2[0], name="Makemake", number=136472)
    found = crossings([(g2, [slow_b]), (g1, [slow_a])], RA0, DEC0, HALF)
    assert len(found) == 1
    assert found[0].mjd == sorted(found[0].mjd) and len(found[0].mjd) == 4


def test_brightest_first():
    times = 60834.0 + np.array([0.0])
    faint = body(0.0, 0.0, 0.0, 0.0, times[0], name="Faint", number=2, v=20.0)
    bright = body(5.0, 5.0, 0.0, 0.0, times[0], name="Bright", number=3, v=15.0)
    assert [c.name for c in crossings([(times, [faint, bright])], RA0, DEC0, HALF)] == ["Bright", "Faint"]


def test_query_radius_covers_motion_over_half_the_group():
    times = np.array([0.0, 1.0])  # one day: half span 12 h
    radius = query_radius_deg(times, HALF, 60.0) * 3600
    assert radius == pytest.approx(HALF * np.sqrt(2) + 60.0 * 12 + 30.0)


def test_separation_and_sexagesimal():
    assert separation_arcsec(10.0, 0.0, 10.0, 1.0) == pytest.approx(3600.0)
    assert _sexagesimal("13 19 45.8955", hours=True) == pytest.approx(199.941231, abs=1e-6)
    assert _sexagesimal("-07 14 42.53", hours=False) == pytest.approx(-7.245147, abs=1e-6)
    assert _sexagesimal("-00 30 00", hours=False) == pytest.approx(-0.5)
