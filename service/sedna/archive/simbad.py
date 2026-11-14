"""What SIMBAD knows about a Gaia DR3 star: its usual name, type, spectral type and other designations.

CDS in Strasbourg hosts SIMBAD and VizieR; when it is unreachable (as during the
event, when CDS took systems offline), the official mirrors at CfA Harvard and
IDIA answer the same queries. Each lookup tries them in order and remembers which
one answered, so links point to a page that opens. Results are cached on disk.

Code written with AI assistance (Claude); see AI_USAGE.md.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

import requests

CACHE = Path(__file__).resolve().parents[3] / "data" / "cache" / "simbad"
MIRRORS = [
    {"name": "CDS", "simbad": "https://simbad.cds.unistra.fr", "vizier": "https://vizier.cds.unistra.fr"},
    {"name": "CfA mirror", "simbad": "https://simbad.cfa.harvard.edu", "vizier": "https://vizier.cfa.harvard.edu"},
    {"name": "IDIA mirror", "simbad": "https://simbad.idia.ac.za", "vizier": "https://vizier.idia.ac.za"},
]
TIMEOUT = 12
CATALOGUES = ("HD", "HIP", "GJ", "LHS", "Wolf", "Ross", "TYC", "2MASS", "WISEA")


class SimbadUnavailable(RuntimeError):
    """No SIMBAD site answered."""


def summarise(main_id: str, otype: str | None, description: str | None, sp_type: str | None, plx: float | None, ids: str | None) -> dict:
    """Turn a SIMBAD row into what a person wants first: the usual name, what it is, how far, other names."""
    idents = [i.strip() for i in (ids or "").split("|") if i.strip()]
    names = [i[5:].strip() for i in idents if i.startswith("NAME ")]
    main = main_id[5:].strip() if main_id.startswith("NAME ") else main_id
    name = names[0] if names else (main if main_id.startswith("NAME ") else None)
    designations = []
    for cat in CATALOGUES:
        for i in idents:
            if i.split(" ")[0] == cat and len(designations) < 6:
                designations.append(" ".join(i.split()))
                break
    return {
        "name": name,
        "mainId": " ".join(main.split()),
        "type": description or otype,
        "spType": sp_type or None,
        "distancePc": round(1000.0 / plx, 2) if plx and plx > 0 else None,
        "designations": designations,
        "identifiers": len(idents),
    }


def lookup_gaia(source_id: str) -> dict:
    """SIMBAD's record for ``Gaia DR3 <source_id>`` (``found`` False when SIMBAD has none), with working links."""
    CACHE.mkdir(parents=True, exist_ok=True)
    path = CACHE / (hashlib.sha1(source_id.encode()).hexdigest()[:20] + ".json")
    if path.exists():
        return json.loads(path.read_text())
    ident = f"Gaia DR3 {source_id}"
    adql = (
        "SELECT b.main_id, b.otype, d.description, b.sp_type, b.plx_value, ids.ids "
        "FROM basic AS b JOIN ident AS i ON i.oidref = b.oid "
        "LEFT JOIN otypedef AS d ON d.otype = b.otype LEFT JOIN ids ON ids.oidref = b.oid "
        f"WHERE i.id = '{ident}'"
    )
    for mirror in MIRRORS:
        try:
            r = requests.get(f"{mirror['simbad']}/simbad/sim-tap/sync", params={"REQUEST": "doQuery", "LANG": "ADQL", "FORMAT": "json", "QUERY": adql}, timeout=TIMEOUT)
            if not r.ok or not r.text.lstrip().startswith("{"):
                continue
            body = r.json()
        except (requests.RequestException, ValueError):
            continue
        cols = [c["name"] for c in body["metadata"]]
        rows = [dict(zip(cols, row)) for row in body["data"]]
        result = {
            "gaiaId": source_id,
            "found": bool(rows),
            "source": f"SIMBAD ({mirror['name']})",
            "links": {
                "simbad": f"{mirror['simbad']}/simbad/sim-id?Ident=" + requests.utils.quote(ident),
                "gaia": f"{mirror['vizier']}/viz-bin/VizieR-5?-source=I/355/gaiadr3&Source={source_id}",
            },
        }
        if rows:
            r0 = rows[0]
            result.update(summarise(r0["main_id"], r0.get("otype"), r0.get("description"), r0.get("sp_type"), r0.get("plx_value"), r0.get("ids")))
        path.write_text(json.dumps(result))
        return result
    raise SimbadUnavailable("no SIMBAD site answered")
