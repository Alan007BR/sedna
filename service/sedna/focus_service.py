"""Distance focus for a known Solar System body: the control case with a JPL Horizons answer.

Finds the exposures that saw the body, seeds the model on its position in the
first exposure of the densest window, runs the focus, and returns the result next
to the true distance.

Code written with AI assistance (Claude); see AI_USAGE.md.
"""
from __future__ import annotations

import numpy as np

from .archive import horizons
from .archive.skyindex import Hit, SkyIndex, split_visits
from .science.focus import FocusResult, run_focus


def body_visits(index: SkyIndex, ident: str, detectors=(1, 2, 3, 4)) -> list[list[Hit]]:
    """Exposures that contain the body, grouped into visits."""
    track = horizons.daily_track(ident)
    ra, dec = horizons.interpolate(track, index.a["mjd"])
    return split_visits(index.lookup(ra, dec, margin=40.0, detectors=detectors))


def densest_window(hits: list[Hit], days: float) -> list[Hit]:
    mjd = np.array([h.mjd for h in hits])
    counts = [(np.abs(mjd - m) <= days / 2).sum() for m in mjd]
    centre = mjd[int(np.argmax(counts))]
    return [h for h in hits if abs(h.mjd - centre) <= days / 2]


def focus_body(index: SkyIndex, ident: str, visit: int = 0, window_days: float = 6.0, detectors=(1, 2, 3, 4)) -> tuple[FocusResult, dict]:
    visits = body_visits(index, ident, detectors)
    if not visits:
        raise LookupError("SPHEREx has no indexed exposure of this body")
    visit = min(max(visit, 0), len(visits) - 1)
    hits = densest_window(visits[visit], window_days)
    exact = horizons.at_times(ident, [h.mjd for h in hits])
    seed_ra, seed_dec, seed_mjd = exact["ra"][0], exact["dec"][0], hits[0].mjd
    result = run_focus(hits, seed_ra, seed_dec, seed_mjd)
    truth = {
        "distanceAu": exact["delta"][0],
        "visits": len(visits),
        "visit": visit,
        "exposuresInVisit": len(visits[visit]),
        "detectors": list(detectors),
    }
    return result, truth
