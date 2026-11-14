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


def parallax_swing_arcsec(distance_au: float) -> float:
    """Largest shift between two views taken from opposite sides of the Earth's orbit."""
    return 2 * 206264.806 / distance_au
