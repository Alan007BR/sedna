"""The distance focus, as the product runs it, on several known bodies.

Usage: python probes/p10_focus_bodies.py [NAME=ID ...]

Code written with AI assistance (Claude); see AI_USAGE.md.
"""
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "service"))
from sedna.archive.skyindex import SkyIndex  # noqa: E402
from sedna.focus_service import body_visits, focus_body  # noqa: E402

bodies = dict(a.split("=") for a in sys.argv[1:]) or {"Makemake": "136472", "Haumea": "136108", "Eris": "136199", "Pluto": "999"}
ix = SkyIndex.load()
print(f"{'body':9s} visits  used  span(d)  true(au)  focus(au)  half-max range   score  at-infinity  seconds")
for name, ident in bodies.items():
    try:
        n_visits = len(body_visits(ix, ident))
        for visit in range(n_visits):
            t0 = time.time()
            res, truth = focus_body(ix, ident, visit=visit)
            d = res.distances[res.best]
            print(
                f"{name:9s} {visit + 1}/{n_visits}   {res.n_exposures:4d}  {res.mjd.max() - res.mjd.min():6.1f}   {truth['distanceAu']:7.1f}   {d:8.1f}   "
                f"{res.half_range[0]:5.0f}-{res.half_range[1]:<5.0f}     {res.scores[res.best]:6.1f}  {res.scores[-1]:8.1f}   {time.time() - t0:6.1f}"
            )
    except Exception as err:
        print(f"{name:9s} failed: {err!r}")
