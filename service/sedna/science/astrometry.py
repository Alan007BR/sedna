"""Where a catalogued star should appear at a given time, seen from the Earth's centre.

Linear proper motion plus annual parallax; no aberration, because SPHEREx WCS is
tied to astrometric (Gaia) positions.

Code written with AI assistance (Claude); see AI_USAGE.md.
"""
from __future__ import annotations

import numpy as np

from . import parallax


def julian_year(mjd):
    return 2000.0 + (np.asarray(mjd, dtype=float) - 51544.5) / 365.25


def star_position(ra, dec, pm_ra_mas, pm_dec_mas, parallax_mas, ref_epoch, mjd):
    """(ra, dec) in degrees at each ``mjd``. pm_ra includes cos(dec). Missing values count as zero."""
    mjd = np.atleast_1d(np.asarray(mjd, dtype=float))
    pm_ra = 0.0 if pm_ra_mas is None else pm_ra_mas
    pm_dec = 0.0 if pm_dec_mas is None else pm_dec_mas
    years = julian_year(mjd) - ref_epoch
    dec_t = dec + pm_dec * years / 3.6e6
    ra_t = ra + pm_ra * years / 3.6e6 / np.cos(np.radians(dec))
    if parallax_mas and parallax_mas > 0:
        d_au = 206264.806 / (parallax_mas / 1000.0)
        u = parallax.unit_vector(ra_t, dec_t) * d_au
        v = u - parallax.earth_position(mjd)
        ra_t, dec_t = parallax.radec(v)
    return ra_t, dec_t
