"""Decision test 2: can one unknown (distance) reproduce a distant object's apparent track?

For each control object, takes the true apparent track from JPL Horizons (SPHEREx
as observer) and compares it with two models seeded at one instant:

  A. pure parallax: the object stands still in space at distance d;
  B. parallax + a circular, prograde, in-ecliptic orbit at heliocentric distance r(d).

Reports the residual on the sky within +-2, +-5 and +-10 days of the seed, and the
distance each model would recover by minimising the residual.

Code written with AI assistance (Claude); see AI_USAGE.md.
"""
import numpy as np
from astropy import units as u
from astropy.coordinates import get_body_barycentric
from astropy.time import Time
from astroquery.jplhorizons import Horizons

OBSERVER = "500@-163182"
AU_KM = 1.495978707e8
PIX = 6.15  # arcsec
ECL_POLE = np.array([0.0, -np.sin(np.radians(23.4392911)), np.cos(np.radians(23.4392911))])

CASES = {
    "Makemake": ("136472", "2025-06-07", "2025-07-06"),
    "Pluto": ("999", "2025-05-05", "2025-05-29"),
    "Eris": ("136199", "2025-07-15", "2025-08-20"),
    "Haumea": ("136108", "2025-06-12", "2025-07-25"),
    "Sedna": ("90377", "2025-08-22", "2025-09-30"),
}


def unit(ra, dec):
    ra, dec = np.radians(ra), np.radians(dec)
    return np.stack([np.cos(dec) * np.cos(ra), np.cos(dec) * np.sin(ra), np.sin(dec)], axis=-1)


def sep_arcsec(a, b):
    return np.degrees(np.arccos(np.clip(np.sum(a * b, axis=-1), -1, 1))) * 3600


def earth(times):
    p = get_body_barycentric("earth", times)
    return np.stack([p.x.to_value(u.au), p.y.to_value(u.au), p.z.to_value(u.au)], axis=-1)


def predict(d, n0, e0, e_t, dt_days, orbit):
    """Unit vectors toward an object seeded at direction n0, distance d from the observer."""
    p0 = e0 + d * n0  # barycentric position at the seed time
    p = np.repeat(p0[None, :], len(dt_days), axis=0)
    if orbit:
        r = np.linalg.norm(p0)
        speed = 29.7847 / np.sqrt(r) / AU_KM * 86400  # au per day, circular orbit
        tangent = np.cross(ECL_POLE, p0 / r)
        tangent /= np.linalg.norm(tangent)
        p = p + np.outer(dt_days, speed * tangent)
    v = p - e_t
    return v / np.linalg.norm(v, axis=1)[:, None]


print(f"{'object':9s} {'d_true':>7s} | model | resid +-2d  +-5d  +-10d (px) | d recovered from +-5d (au)")
for name, (ident, start, stop) in CASES.items():
    eph = Horizons(id=ident, location=OBSERVER, epochs={"start": start, "stop": stop, "step": "6h"}).ephemerides(quantities="1,20")
    jd = np.array(eph["datetime_jd"], dtype=float)
    truth = unit(np.array(eph["RA"], dtype=float), np.array(eph["DEC"], dtype=float))
    delta = np.array(eph["delta"], dtype=float)
    times = Time(jd, format="jd", scale="utc")
    e_t = earth(times)
    i0 = len(jd) // 2
    dt = jd - jd[i0]
    for label, orbit in (("A", False), ("B", True)):
        res = sep_arcsec(predict(delta[i0], truth[i0], e_t[i0], e_t, dt, orbit), truth)
        row = [res[np.abs(dt) <= w].max() / PIX for w in (2, 5, 10)]
        grid = np.geomspace(20, 400, 600)
        sel = np.abs(dt) <= 5
        rms = [np.sqrt(np.mean(sep_arcsec(predict(d, truth[i0], e_t[i0], e_t[sel], dt[sel], orbit), truth[sel]) ** 2)) for d in grid]
        best = grid[int(np.argmin(rms))]
        print(f"{name:9s} {delta[i0]:7.1f} |   {label}   | {row[0]:9.2f} {row[1]:5.2f} {row[2]:6.2f}      | {best:6.1f}  (rms {min(rms) / PIX:.2f} px)")
