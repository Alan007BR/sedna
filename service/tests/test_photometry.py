"""Photometry and change-in-brightness on synthetic images and measurements: no network.

Code written with AI assistance (Claude); see AI_USAGE.md.
"""
import numpy as np
import pytest

from sedna.science.photometry import UJY_PER_PIXEL, aperture, brightness_change, channel, time_bins, wing


def gaussian_star(total=100.0, sigma=0.9, size=27, x=13.3, y=12.7, noise=0.0, seed=1):
    yy, xx = np.indices((size, size))
    img = total / (2 * np.pi * sigma**2) * np.exp(-((xx - x) ** 2 + (yy - y) ** 2) / (2 * sigma**2))
    img += 5.0  # sky level, removed by the annulus
    if noise:
        img += np.random.default_rng(seed).normal(0, noise, img.shape)
    return img


def test_aperture_recovers_most_of_a_star_in_microjansky():
    f = aperture(gaussian_star(), 13.3, 12.7, radius=2.0)
    expected = 100.0 * (1 - np.exp(-(2.0**2) / (2 * 0.9**2))) * UJY_PER_PIXEL  # analytic fraction inside r = 2
    assert f.value == pytest.approx(expected, rel=0.03)
    assert f.nan_core == 0


def test_saturated_core_counts_nan_and_wing_still_scales_with_brightness():
    bright = gaussian_star(total=1000.0)
    faint = gaussian_star(total=500.0)
    for img in (bright, faint):
        img[12:14, 12:15] = np.nan  # saturated core
    assert aperture(bright, 13.3, 12.7).nan_core > 0
    ratio = wing(bright, 13.3, 12.7).value / wing(faint, 13.3, 12.7).value
    assert ratio == pytest.approx(2.0, rel=0.01)


def test_error_grows_with_noise():
    quiet = aperture(gaussian_star(noise=0.1), 13.3, 12.7)
    loud = aperture(gaussian_star(noise=1.0), 13.3, 12.7)
    assert loud.error > 5 * quiet.error


def test_channels_split_the_detector_in_equal_log_steps():
    lo, hi = 0.735, 1.126
    edges = lo * (hi / lo) ** (np.arange(18) / 17)
    centres = np.sqrt(edges[:-1] * edges[1:])
    assert channel(centres, lo, hi).tolist() == list(range(17))
    assert channel([0.5, 2.0], lo, hi).tolist() == [0, 16]


def test_time_bins_follow_visits_and_slice_long_ones():
    short = [0.0, 1.0, 3.0]  # one visit of three days
    later = [200.0, 202.0]  # the next survey visit
    deep = list(300.0 + np.arange(0, 45, 1.0))  # 45 days of continuous coverage
    bins = time_bins(short + later + deep)
    assert bins[:3].tolist() == [0, 0, 0]
    assert bins[3:5].tolist() == [1, 1]
    assert sorted(set(bins[5:].tolist())) == [2, 3, 4, 5, 6]  # 10-day slices


def test_time_bins_keep_input_order():
    assert time_bins([200.0, 0.0, 1.0]).tolist() == [1, 0, 0]


def test_change_compares_each_channel_only_with_itself():
    # a red spectrum: flux rises steeply with channel, and the star fades by 0.5 mag in bin 1.
    # Bin 0 sees only channels 0-9, bin 1 only channels 5-16: naive averaging would mix spectrum and change.
    rng = np.random.default_rng(3)
    chs, bins, flux, err = [], [], [], []
    for b, (c0, c1) in enumerate([(0, 9), (5, 16)]):
        for c in range(c0, c1 + 1):
            for _ in range(3):
                true = 1000.0 * 1.25**c * (10 ** (-0.4 * 0.5) if b == 1 else 1.0)
                chs.append(c)
                bins.append(b)
                flux.append(true * (1 + rng.normal(0, 0.01)))
                err.append(true * 0.01)
    out = brightness_change(chs, bins, flux, err)
    assert [p.bin for p in out] == [0, 1]
    assert out[0].delta_mag + out[1].delta_mag == pytest.approx(0.0, abs=1e-9)  # zero is the median over bins
    assert out[1].delta_mag - out[0].delta_mag == pytest.approx(0.5, abs=0.02)
    assert out[1].channels == 5  # only channels 5-9 are seen in both bins


def test_no_shared_channel_means_no_answer():
    out = brightness_change([0, 0, 9, 9], [0, 0, 1, 1], [100.0, 100.0, 50.0, 50.0], [1.0, 1.0, 1.0, 1.0])
    assert out == []


def test_neighbours_count_only_bright_close_stars(monkeypatch):
    from sedna import brightness_service
    from sedna.archive import gaia

    ra, dec = 133.8, -7.24
    stars = [
        {"ra": ra + 5 / 3600, "dec": dec, "g": 16.3},  # 5" away, bright enough to matter
        {"ra": ra, "dec": dec + 8 / 3600, "g": 22.0},  # close but far too faint
        {"ra": ra + 60 / 3600, "dec": dec, "g": 12.0},  # bright but outside the aperture ring
        {"ra": ra, "dec": dec + 1 / 3600, "g": 15.0},  # the point itself
    ]
    monkeypatch.setattr(gaia, "cone", lambda *a, **k: stars)
    measured = brightness_service.G_ZERO_UJY * 10 ** (-0.4 * 16.3)  # the neighbour carries all of the measured light
    out = brightness_service.neighbours(ra, dec, "aperture", measured)
    assert [round(n["separationArcsec"]) for n in out] == [5]
    assert out[0]["share"] == pytest.approx(1.0, abs=0.02)


def test_low_signal_exposures_are_ignored():
    out = brightness_change([0, 0, 0, 0], [0, 0, 1, 1], [100.0, 100.0, 2.0, 2.0], [1.0, 1.0, 1.0, 1.0], min_snr=3.0)
    assert out == []
