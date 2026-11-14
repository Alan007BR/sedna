"""Checks of the region search as the product runs it (service/sedna/search_service.py).

Finding: fields near four dwarf planets in each of their visits, centred 1.5' away from the body (JPL Horizons
at mid-window) so the search is not told where it is; a body counts as found when a candidate lies within
2 pixels of its position at the first exposure. False alarms: Makemake's field (visits 1-3), the five challenge
fields (visits 1 and 2) and 2 x 16 random fields (seeds 5 and 11, first visit); every candidate and noise peak
is recorded. A good search finds Makemake in visit 1 of its field and nothing elsewhere.

Run from service/:  ../.venv/Scripts/python ../probes/p19_search_checks.py
Writes probes/p19_search_checks.json.

Code written with AI assistance (Claude); see AI_USAGE.md.
"""
from __future__ import annotations

import json
import sys
import time
import warnings
from pathlib import Path

import numpy as np

warnings.filterwarnings("ignore")
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "service"))
from sedna.api import index  # noqa: E402
from sedna.archive import horizons  # noqa: E402
from sedna.archive.skyindex import split_visits  # noqa: E402
from sedna.focus_service import body_visits, densest_window  # noqa: E402
from sedna.search_service import DETECTORS, search_field  # noqa: E402
from sedna.targets import TARGETS  # noqa: E402

OUT = Path(__file__).resolve().parent / "p19_search_checks.json"
idx = index()

# 1. finding known bodies without being told where they are
bodies = []
for name, ident in (("Makemake", "136472"), ("Haumea", "136108"), ("Pluto", "999"), ("Eris", "136199")):
    for v, visit in enumerate(body_visits(idx, ident)[:3]):
        win = densest_window(visit, 6.0)
        mid = horizons.at_times(ident, [win[len(win) // 2].mjd])
        ra, dec = float(mid["ra"][0]), float(mid["dec"][0])
        cra, cdec = ra + 1.3 / 60 / np.cos(np.radians(dec)), dec - 0.7 / 60
        field_visits = split_visits(idx.lookup(cra, cdec, detectors=DETECTORS))
        fv = next((i for i, f in enumerate(field_visits) if any(abs(h.mjd - win[0].mjd) < 1 for h in f)), None)
        row = {"body": name, "visit": v + 1, "ra": round(cra, 5), "dec": round(cdec, 5)}
        try:
            r = search_field(idx, cra, cdec, 6.0, fv if fv is not None else v)
        except (LookupError, ValueError) as err:
            row["skipped"] = str(err)
            bodies.append(row)
            print(row, flush=True)
            continue
        e0 = horizons.at_times(ident, [float(r.mjd.min())])
        tx, ty = (float(np.asarray(q).ravel()[0]) for q in r.grid.pixel_of(float(e0["ra"][0]), float(e0["dec"][0])))
        hit = [c for c in r.candidates if np.hypot(c["x"] - tx, c["y"] - ty) <= 2]
        row.update(
            exposures=int(len(r.mjd)),
            jpl_distance_au=round(float(e0["delta"][0]), 1),
            found=bool(hit),
            snr=round(hit[0]["snr"], 1) if hit else None,
            distance_au=round(hit[0]["distance_au"], 1) if hit else None,
            other_candidates=len(r.candidates) - len(hit),
            noise_peaks=[round(x, 1) for x in r.noise_peaks],
        )
        bodies.append(row)
        print(row, flush=True)

# 2. false alarms
fields = [("Makemake's field", "makemake", 199.94124, 21.48776, v) for v in (0, 1, 2)]
for k in ("barnard", "wise0855", "epsindib", "rwaur", "rdra"):
    fields += [(TARGETS[k]["name"], "challenge", TARGETS[k]["ra"], TARGETS[k]["dec"], v) for v in (0, 1)]
for seed in (5, 11):
    rng = np.random.default_rng(seed)
    n = 0
    while n < 16:
        ra, dec = float(rng.uniform(0, 360)), float(np.degrees(np.arcsin(rng.uniform(-1, 1))))
        if idx.lookup(ra, dec, detectors=(1,)):
            fields.append((f"random {seed}", "random", ra, dec, 0))
            n += 1

rows = []
for name, group, ra, dec, visit in fields:
    t0 = time.time()
    row = {"field": name, "group": group, "ra": round(ra, 5), "dec": round(dec, 5), "visit": visit + 1}
    try:
        r = search_field(idx, ra, dec, 6.0, visit)
        row.update(
            exposures=int(len(r.mjd)),
            farthest_au=round(r.farthest_au, 1),
            candidates=[{"snr": round(c["snr"], 1), "distance_au": round(c["distance_au"], 1), "x": c["x"], "y": c["y"], "halves": [round(h, 1) for h in c["halves"]]} for c in r.candidates],
            noise_peaks=[round(v, 1) for v in r.noise_peaks],
        )
    except (LookupError, ValueError) as err:
        row["skipped"] = str(err)
    row["seconds"] = round(time.time() - t0, 1)
    rows.append(row)
    print(row, flush=True)

summary = {}
for group in ("makemake", "challenge", "random"):
    done = [r for r in rows if r["group"] == group and "skipped" not in r]
    summary[group] = {
        "searches": len(done),
        "skipped": sum(1 for r in rows if r["group"] == group and "skipped" in r),
        "candidates": sum(len(r["candidates"]) for r in done),
        "noise_peaks": sum(len(r["noise_peaks"]) for r in done),
    }
done = [b for b in bodies if "skipped" not in b]
summary["bodies"] = {"searches": len(done), "skipped": len(bodies) - len(done), "found": sum(b["found"] for b in done), "other_candidates": sum(b["other_candidates"] for b in done)}
print(summary)
OUT.write_text(json.dumps({"summary": summary, "bodies": bodies, "searches": rows}, indent=1))
print("wrote", OUT)
