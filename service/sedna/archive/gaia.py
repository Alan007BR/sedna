"""Gaia DR3 cone searches through the ESA archive (no key needed), cached on disk.

Code written with AI assistance (Claude); see AI_USAGE.md.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

from ..paths import CACHE_DIR
from .net import session

TAP = "https://gea.esac.esa.int/tap-server/tap/sync"
CACHE = CACHE_DIR / "gaia"
REF_EPOCH = 2016.0


def cone(ra: float, dec: float, radius_deg: float, g_max: float = 16.5, limit: int = 300) -> list[dict]:
    """Gaia DR3 sources within ``radius_deg``, brightest first, with proper motion and parallax (mas, mas/yr)."""
    CACHE.mkdir(parents=True, exist_ok=True)
    key = hashlib.sha1(f"{ra:.5f}|{dec:.5f}|{radius_deg:.4f}|{g_max}|{limit}".encode()).hexdigest()[:16]
    path = CACHE / f"{key}.json"
    if path.exists():
        return json.loads(path.read_text())
    adql = (
        f"SELECT TOP {limit} source_id, ra, dec, pmra, pmdec, parallax, phot_g_mean_mag FROM gaiadr3.gaia_source "
        f"WHERE 1=CONTAINS(POINT('ICRS', ra, dec), CIRCLE('ICRS', {ra}, {dec}, {radius_deg})) AND phot_g_mean_mag < {g_max} "
        "ORDER BY phot_g_mean_mag"
    )
    r = session().get(TAP, params={"REQUEST": "doQuery", "LANG": "ADQL", "FORMAT": "json", "QUERY": adql}, timeout=40)
    r.raise_for_status()
    body = r.json()
    cols = [c["name"] for c in body["metadata"]]
    rows = []
    for row in body["data"]:
        s = dict(zip(cols, row))
        rows.append(
            {
                "id": str(s["source_id"]),
                "ra": s["ra"],
                "dec": s["dec"],
                "pmRa": s["pmra"],
                "pmDec": s["pmdec"],
                "parallax": s["parallax"],
                "g": s["phot_g_mean_mag"],
            }
        )
    path.write_text(json.dumps(rows))
    return rows
