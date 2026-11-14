"""False-alarm check of the region search as the product runs it (service/sedna/search_service.py).

Searches Makemake's field (visits 1-3), the five challenge fields (visits 1 and 2) and 2 x 16 random fields
(seeds 5 and 11, first visit), and records every candidate and noise peak. A good search finds Makemake in
visit 1 of its field and nothing elsewhere.

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
from sedna.search_service import search_field  # noqa: E402
from sedna.targets import TARGETS  # noqa: E402

OUT = Path(__file__).resolve().parent / "p19_search_checks.json"
idx = index()
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
print(summary)
OUT.write_text(json.dumps({"summary": summary, "searches": rows}, indent=1))
print("wrote", OUT)
