"""Query SEDNA's own sky index (built by build_index.py).

Code written with AI assistance (Claude); see AI_USAGE.md.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from astropy.io import fits
from astropy.wcs import WCS

INDEX_DIR = Path(__file__).resolve().parents[3] / "data" / "index"
NAXIS = 2040
HALF_DIAGONAL_DEG = 2.6  # a detector is about 3.5 deg on a side


def load(pattern: str = "*.jsonl") -> list[dict]:
    recs: list[dict] = []
    for path in sorted(INDEX_DIR.glob(pattern)):
        with path.open() as fh:
            recs += [json.loads(line) for line in fh]
    return recs


def wcs_of(rec: dict) -> WCS:
    """Celestial WCS (TAN-SIP) of one indexed exposure."""
    h = fits.Header()
    h["NAXIS"] = 2
    h["NAXIS1"] = NAXIS
    h["NAXIS2"] = NAXIS
    h["CTYPE1"] = "RA---TAN-SIP"
    h["CTYPE2"] = "DEC--TAN-SIP"
    h["CUNIT1"] = "deg"
    h["CUNIT2"] = "deg"
    for k, v in rec["wcs"].items():
        h[k] = v
    for k, v in rec["sip"].items():
        h[k] = int(v) if k.endswith("ORDER") else v
    return WCS(h)


def separation_deg(ra1, dec1, ra2, dec2):
    ra1, dec1, ra2, dec2 = map(np.radians, (ra1, dec1, ra2, dec2))
    s = np.sin(dec1) * np.sin(dec2) + np.cos(dec1) * np.cos(dec2) * np.cos(ra1 - ra2)
    return np.degrees(np.arccos(np.clip(s, -1, 1)))


def near(recs: list[dict], ra: float, dec: float, radius: float = HALF_DIAGONAL_DEG) -> list[dict]:
    """Cheap pre-filter: exposures whose reference point lies within ``radius`` of the position."""
    ras = np.array([r["wcs"]["CRVAL1"] for r in recs])
    decs = np.array([r["wcs"]["CRVAL2"] for r in recs])
    keep = separation_deg(ras, decs, ra, dec) < radius
    return [r for r, k in zip(recs, keep) if k]


def pixel_of(rec: dict, ra: float, dec: float) -> tuple[float, float] | None:
    """0-based pixel of a sky position in an exposure, or None if it falls outside the detector."""
    x, y = wcs_of(rec).all_world2pix([[ra, dec]], 0, quiet=True)[0]
    if 0 <= x < NAXIS and 0 <= y < NAXIS:
        return float(x), float(y)
    return None
