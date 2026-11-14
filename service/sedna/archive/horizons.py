"""Apparent positions of Solar System bodies as seen from SPHEREx, from JPL Horizons.

Used for the distance-focus controls: the seed position and the true distance the
focus is compared with. Results are cached on disk.

Code written with AI assistance (Claude); see AI_USAGE.md.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

import numpy as np
from astroquery.jplhorizons import Horizons
from ..paths import CACHE_DIR

OBSERVER = "500@-163182"  # the SPHEREx spacecraft
CACHE = CACHE_DIR / "horizons"


def _cached(name: str, compute):
    CACHE.mkdir(parents=True, exist_ok=True)
    path = CACHE / f"{name}.json"
    if path.exists():
        return json.loads(path.read_text())
    value = compute()
    path.write_text(json.dumps(value))
    return value


def daily_track(ident: str, start: str = "2025-04-20", stop: str = "2026-10-10") -> dict:
    """Daily apparent RA, Dec and distance over the mission; enough to find which exposures saw the body."""

    def compute():
        eph = Horizons(id=ident, location=OBSERVER, epochs={"start": start, "stop": stop, "step": "1d"}).ephemerides(quantities="1,20")
        return {
            "mjd": [float(j) - 2400000.5 for j in eph["datetime_jd"]],
            "ra": [float(v) for v in eph["RA"]],
            "dec": [float(v) for v in eph["DEC"]],
            "delta": [float(v) for v in eph["delta"]],
        }

    return _cached(f"track_{ident}_{start}_{stop}", compute)


def at_times(ident: str, mjd: list[float]) -> dict:
    """Apparent position and distance at exact times (MJD UTC)."""
    key = hashlib.sha1((ident + "|" + ",".join(f"{m:.6f}" for m in mjd)).encode()).hexdigest()[:16]

    def compute():
        ra, dec, delta = [], [], []
        jd = [m + 2400000.5 for m in mjd]
        for i in range(0, len(jd), 40):
            eph = Horizons(id=ident, location=OBSERVER, epochs=jd[i : i + 40]).ephemerides(quantities="1,20")
            ra += [float(v) for v in eph["RA"]]
            dec += [float(v) for v in eph["DEC"]]
            delta += [float(v) for v in eph["delta"]]
        return {"ra": ra, "dec": dec, "delta": delta}

    return _cached(f"times_{ident}_{key}", compute)


def interpolate(track: dict, mjd: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    ra = np.degrees(np.unwrap(np.radians(track["ra"])))
    return np.interp(mjd, track["mjd"], ra) % 360, np.interp(mjd, track["mjd"], track["dec"])
