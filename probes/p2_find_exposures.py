"""Decision test 1b: which SPHEREx exposures covered a sky position, and when?

Queries the IRSA TAP service for every Level-2 spectral image whose footprint
contains the given position, then groups the exposures into visits by time gaps.

Usage: python p2_find_exposures.py NAME RA DEC

Code written with AI assistance (Claude); see AI_USAGE.md.
"""
import json
import sys
import time
from pathlib import Path

import requests
from astropy.time import Time

TAP = "https://irsa.ipac.caltech.edu/TAP/sync"
name, ra, dec = sys.argv[1], float(sys.argv[2]), float(sys.argv[3])

query = f"""
SELECT a.uri, p.time_bounds_lower, p.time_bounds_upper, p.energy_bandpassname, o.obsid
FROM spherex.artifact a
JOIN spherex.plane p ON a.planeid = p.planeid
JOIN spherex.observation o ON p.obsid = o.obsid
WHERE 1 = CONTAINS(POINT('ICRS', {ra}, {dec}), p.poly)
ORDER BY p.time_bounds_lower
"""
fallback = f"""
SELECT a.uri, p.time_bounds_lower, p.time_bounds_upper, p.energy_bandpassname
FROM spherex.artifact a
JOIN spherex.plane p ON a.planeid = p.planeid
WHERE 1 = CONTAINS(POINT('ICRS', {ra}, {dec}), p.poly)
ORDER BY p.time_bounds_lower
"""

t0 = time.time()
rows = None
for q in (query, fallback):
    r = requests.post(TAP, data={"QUERY": q, "LANG": "ADQL", "FORMAT": "json"}, timeout=180)
    if r.ok and "data" in r.text[:2000]:
        payload = r.json()
        cols = [c["name"] for c in payload["metadata"]]
        rows = [dict(zip(cols, row)) for row in payload["data"]]
        break
    print("query failed, trying fallback:", r.status_code, r.text[:300].replace("\n", " "))
elapsed = time.time() - t0
print(f"{name}: {len(rows)} artifacts in {elapsed:.1f} s; columns {cols}")

for x in rows:
    x["mjd"] = float(x["time_bounds_lower"])
visits, cur = [], []
for x in rows:
    if cur and x["mjd"] - cur[-1]["mjd"] > 30:
        visits.append(cur)
        cur = []
    cur.append(x)
if cur:
    visits.append(cur)

for i, v in enumerate(visits):
    dets = {}
    for x in v:
        dets[x["energy_bandpassname"]] = dets.get(x["energy_bandpassname"], 0) + 1
    releases = sorted({x["uri"].split("/")[3] if x["uri"].count("/") > 3 else "?" for x in v})
    print(
        f"  visit {i}: {Time(v[0]['mjd'], format='mjd').iso[:16]} -> {Time(v[-1]['mjd'], format='mjd').iso[:16]}"
        f"  n={len(v)}  span={v[-1]['mjd'] - v[0]['mjd']:.1f} d  releases={releases}  {dict(sorted(dets.items()))}"
    )
print("example uri:", rows[0]["uri"])
Path(__file__).with_name(f"p2_{name.lower()}.json").write_text(json.dumps(rows, indent=1))
