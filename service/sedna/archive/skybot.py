"""IMCCE SkyBoT: which known Solar System objects were inside a cone of sky at a given time.

One cone search per call, cached on disk. Positions are geocentric; SPHEREx orbits
the Earth, so the difference is negligible beyond the Moon. The rates SkyBoT returns
let the caller move each object linearly over a few hours.

Code written with AI assistance (Claude); see AI_USAGE.md.
"""
from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass
from pathlib import Path

import requests
from astropy.time import Time

URL = "https://ssp.imcce.fr/webservices/skybot/api/conesearch.php"
CACHE = Path(__file__).resolve().parents[3] / "data" / "cache" / "skybot"
TIMEOUT = 45


class SkybotUnavailable(RuntimeError):
    """SkyBoT did not answer, or answered with something that is not a result."""


@dataclass
class Sighting:
    name: str
    number: int | None
    cls: str
    v: float | None  # V magnitude
    ra: float  # degrees, ICRS, at ``mjd``
    dec: float
    rate_ra: float  # arcsec per hour, includes cos(dec)
    rate_dec: float
    distance_au: float | None  # from the observer
    mjd: float


def _sexagesimal(text: str, hours: bool) -> float:
    parts = text.split()
    sign = -1.0 if parts[0].startswith("-") else 1.0
    a, b, c = (abs(float(p)) for p in parts)
    value = sign * (a + b / 60 + c / 3600)
    return value * 15 if hours else value


def _float(value) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def cone(ra: float, dec: float, mjd: float, radius_deg: float) -> list[Sighting]:
    """Known asteroids, comets and planets within ``radius_deg`` of (ra, dec) at ``mjd``.

    Returns an empty list when SkyBoT finds nothing. Raises ``SkybotUnavailable``
    when the service fails, so that "nothing there" and "no answer" stay distinct.
    """
    CACHE.mkdir(parents=True, exist_ok=True)
    key = hashlib.sha1(f"{ra:.5f}|{dec:.5f}|{mjd:.5f}|{radius_deg:.4f}".encode()).hexdigest()
    path = CACHE / f"{key}.json"
    if path.exists():
        return [Sighting(**row) for row in json.loads(path.read_text())]
    params = {
        "-ep": Time(mjd, format="mjd").isot,
        "-ra": f"{ra:.6f}",
        "-dec": f"{dec:.6f}",
        "-rd": f"{radius_deg:.5f}",
        "-mime": "json",
        "-output": "all",
        "-loc": "500",
        "-filter": "120",
        "-objFilter": "111",
        "-refsys": "EQJ2000",
        "-from": "SEDNA",
    }
    try:
        r = requests.get(URL, params=params, timeout=TIMEOUT)
    except requests.RequestException as err:
        raise SkybotUnavailable(repr(err)[:160]) from err
    if r.status_code == 204 or (r.ok and not r.text.strip()):
        rows = []
    elif r.ok and r.text.lstrip().startswith("["):
        rows = r.json()
    else:
        raise SkybotUnavailable(f"HTTP {r.status_code}: {r.text[:120]!r}")
    sightings = [
        Sighting(
            name=str(o.get("Name", "")).strip(),
            number=int(o["Num"]) if str(o.get("Num", "")).strip().isdigit() else None,
            cls=str(o.get("Class", "")),
            v=_float(o.get("VMag (mag)")),
            ra=_sexagesimal(o["RA (hms)"], hours=True),
            dec=_sexagesimal(o["DEC (dms)"], hours=False),
            rate_ra=_float(o.get("dRA (arcsec/h)")) or 0.0,
            rate_dec=_float(o.get("dDEC (arcsec/h)")) or 0.0,
            distance_au=_float(o.get("dg (ua)")),
            mjd=mjd,
        )
        for o in rows
    ]
    path.write_text(json.dumps([asdict(s) for s in sightings]))
    return sightings


def known_object(ra: float, dec: float, mjd: float, radius_arcsec: float = 40.0) -> dict:
    """Plain-language answer to "was a known object at this point at this time?"."""
    try:
        rows = cone(ra, dec, mjd, radius_arcsec / 3600)
    except SkybotUnavailable:
        return {"status": "unavailable", "message": "The known-object service (IMCCE SkyBoT) did not answer."}
    if not rows:
        return {"status": "none", "message": f"No known asteroid or comet within {radius_arcsec:.0f} arcsec at that time (IMCCE SkyBoT)."}
    from ..science.movers import separation_arcsec

    best = min(rows, key=lambda s: separation_arcsec(s.ra, s.dec, ra, dec))
    return {
        "status": "known",
        "name": best.name,
        "number": best.number,
        "class": best.cls,
        "vMag": best.v,
        "separationArcsec": round(float(separation_arcsec(best.ra, best.dec, ra, dec)), 3),
        "message": "A known object was here at that time (IMCCE SkyBoT).",
    }
