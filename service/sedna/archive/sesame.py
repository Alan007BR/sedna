"""From a name to a sky position, with CDS Sesame (SIMBAD first, then NED and VizieR).

Sesame forgives what people type: "m42", "betelgeuse", "Orion Nebula", "NGC 1976" all resolve. It returns the
J2000 position and, for stars, the proper motion, so a fast star can be moved to the dates SPHEREx observed.
The CDS site went offline during the event; its mirrors at the CfA and at IDIA kept answering, so they are
asked first and CDS last.

Code written with AI assistance (Claude); see AI_USAGE.md.
"""
from __future__ import annotations

import hashlib
import json
import xml.etree.ElementTree as ET
from urllib.parse import quote
from dataclasses import asdict, dataclass

import requests

from ..paths import CACHE_DIR
from .net import session

CACHE = CACHE_DIR / "sesame"
MIRRORS = [
    ("CfA mirror", "https://vizier.cfa.harvard.edu/viz-bin/nph-sesame"),
    ("IDIA mirror", "https://vizier.idia.ac.za/viz-bin/nph-sesame"),
    ("CDS", "https://cdsweb.u-strasbg.fr/cgi-bin/nph-sesame"),
]
TIMEOUT = 8


class SesameUnavailable(RuntimeError):
    """No Sesame site answered."""


@dataclass
class Resolved:
    query: str
    name: str  # the database's main identifier, e.g. "* alf Ori"
    ra: float  # J2000, degrees
    dec: float
    pm_ra: float | None  # mas/yr, already multiplied by cos(dec)
    pm_dec: float | None
    otype: str | None
    resolver: str  # "Simbad", "NED" or "VizieR"
    source: str  # which site answered


def _text(el: ET.Element, path: str) -> str | None:
    found = el.find(path)
    return found.text.strip() if found is not None and found.text else None


def parse(xml: str, query: str, site: str) -> Resolved | None:
    """The first resolver that gave a position, or None when no database knows the name."""
    root = ET.fromstring(xml)
    for resolver in root.iter("Resolver"):
        ra, dec = _text(resolver, "jradeg"), _text(resolver, "jdedeg")
        if ra is None or dec is None:
            continue
        pm_ra, pm_dec = _text(resolver, "pm/pmRA"), _text(resolver, "pm/pmDE")
        label = resolver.get("name", "")
        return Resolved(
            query=query,
            name=_text(resolver, "oname") or query,
            ra=float(ra) % 360,
            dec=float(dec),
            pm_ra=float(pm_ra) if pm_ra else None,
            pm_dec=float(pm_dec) if pm_dec else None,
            otype=_text(resolver, "otype"),
            resolver="NED" if "NED" in label else "VizieR" if "VizieR" in label else "Simbad",
            source=site,
        )
    return None


def resolve(name: str) -> Resolved | None:
    """Position of a named object; None if no database knows it. Raises SesameUnavailable if no site answers."""
    query = " ".join(name.split())
    CACHE.mkdir(parents=True, exist_ok=True)
    path = CACHE / (hashlib.sha1(query.lower().encode()).hexdigest()[:20] + ".json")
    if path.exists():
        cached = json.loads(path.read_text())
        return Resolved(**cached) if cached else None
    for site, url in MIRRORS:
        try:
            # -oxp: XML with every field; SNV: SIMBAD, then NED, then VizieR. The name is the bare query string
            # (Sesame reads "?m42", not "?m42=").
            r = session().get(f"{url}/-oxp/SNV?{quote(query)}", timeout=TIMEOUT)
            r.raise_for_status()
            found = parse(r.text, query, site)
        except (requests.RequestException, ET.ParseError):
            continue
        path.write_text(json.dumps(asdict(found) if found else None))
        return found
    raise SesameUnavailable("no Sesame site answered")
