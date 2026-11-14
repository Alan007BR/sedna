"""Apparent motion of a distant Solar System object as a function of one unknown: distance.

Model: at the seed time the object is seen in direction ``n0`` at distance ``d``
from the observer. From there it follows a circular, prograde orbit in the
ecliptic plane, and the observer rides with the Earth. For bodies beyond about
40 au this reproduces true tracks to about a pixel over a SPHEREx visit and
recovers distance to 1-20 % (tested against JPL Horizons for Haumea, Makemake,
Sedna, Eris and Pluto; the error grows with eccentricity and inclination).

The observer is the geocentre: SPHEREx's 7,000 km orbit radius shifts an object at
40 au by 0.24 arcsec, far below a 6.15 arcsec pixel.

Code written with AI assistance (Claude); see AI_USAGE.md.
"""
from __future__ import annotations

import numpy as np
from astropy import units as u
from astropy.coordinates import get_body_barycentric
from astropy.time import Time

AU_KM = 1.495978707e8
EARTH_SPEED_KMS = 29.7847  # circular speed at 1 au
OBLIQUITY = np.radians(23.4392911)
ECLIPTIC_POLE = np.array([0.0, -np.sin(OBLIQUITY), np.cos(OBLIQUITY)])  # in ICRS axes


def unit_vector(ra_deg, dec_deg) -> np.ndarray:
    ra, dec = np.radians(ra_deg), np.radians(dec_deg)
    return np.stack([np.cos(dec) * np.cos(ra), np.cos(dec) * np.sin(ra), np.sin(dec)], axis=-1)


def radec(v: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    v = v / np.linalg.norm(v, axis=-1, keepdims=True)
    return np.degrees(np.arctan2(v[..., 1], v[..., 0])) % 360.0, np.degrees(np.arcsin(v[..., 2]))


def earth_position(mjd) -> np.ndarray:
    """Barycentric position of the Earth in au, ICRS axes, for an array of MJD (UTC)."""
    p = get_body_barycentric("earth", Time(np.atleast_1d(mjd), format="mjd", scale="utc"))
    return np.stack([p.x.to_value(u.au), p.y.to_value(u.au), p.z.to_value(u.au)], axis=-1)


def predict_track(ra0, dec0, mjd0, distance_au, mjd, earth=None, earth0=None, orbit=True):
    """Predicted (ra, dec) at each ``mjd`` for an object seeded at (ra0, dec0, mjd0) and a trial distance.

    ``distance_au`` may be an array; the result then has shape (len(distance), len(mjd)).
    ``earth``/``earth0`` let callers reuse precomputed Earth positions.
    """
    mjd = np.atleast_1d(np.asarray(mjd, dtype=float))
    d = np.atleast_1d(np.asarray(distance_au, dtype=float))
    earth = earth_position(mjd) if earth is None else earth
    earth0 = earth_position([mjd0])[0] if earth0 is None else earth0
    n0 = unit_vector(ra0, dec0)
    p0 = earth0[None, :] + d[:, None] * n0[None, :]  # (D, 3)
    pos = np.repeat(p0[:, None, :], len(mjd), axis=1)  # (D, T, 3)
    if orbit:
        r = np.linalg.norm(p0, axis=1)  # (D,)
        speed = EARTH_SPEED_KMS / np.sqrt(r) / AU_KM * 86400.0  # au per day
        tangent = np.cross(ECLIPTIC_POLE[None, :], p0 / r[:, None])
        tangent /= np.linalg.norm(tangent, axis=1, keepdims=True)
        pos = pos + (mjd - mjd0)[None, :, None] * (speed[:, None] * tangent)[:, None, :]
    ra, dec = radec(pos - earth[None, :, :])
    if np.ndim(distance_au) == 0:
        return ra[0], dec[0]
    return ra, dec


PARSEC_AU = 206264.806
RULER_AU = (50.0, 100.0, 300.0, 500.0, 2 * PARSEC_AU)


def ruler(ra: float, dec: float, mjd_a: float, mjd_b: float, distances_au=RULER_AU) -> tuple[np.ndarray, np.ndarray]:
    """Where a body seen at (ra, dec) on date A would be on date B, for each trial distance."""
    ras, decs = predict_track(ra, dec, mjd_a, np.asarray(distances_au, dtype=float), np.array([mjd_b]))
    return ras[:, 0], decs[:, 0]


def stays_in_field_beyond(ra: float, dec: float, mjd_a: float, mjd_b: float, half_field_arcsec: float) -> float | None:
    """Smallest distance beyond which a body seen at (ra, dec) on date A is still inside the square field on date B."""
    from .movers import tangent_offsets_arcsec

    d = np.geomspace(10.0, 1e7, 700)
    ras, decs = ruler(ra, dec, mjd_a, mjd_b, d)
    east, north = tangent_offsets_arcsec(ras, decs, ra, dec)
    inside = (np.abs(east) <= half_field_arcsec) & (np.abs(north) <= half_field_arcsec)
    if not inside[-1]:
        return None
    k = len(d) - 1
    while k > 0 and inside[k - 1]:
        k -= 1
    return float(d[k])


def parallax_swing_arcsec(distance_au: float) -> float:
    """Largest shift between two views taken from opposite sides of the Earth's orbit."""
    return 2 * 206264.806 / distance_au
