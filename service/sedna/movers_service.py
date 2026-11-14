"""Known Solar System bodies that crossed a field while SPHEREx was observing it.

For every group of exposure times no longer than a day, one SkyBoT cone search at
the group's middle time, wide enough to catch any body slower than ``MAX_RATE``
that enters the field during the group. Visits are numbered like the
single-exposure film (detectors 1-4), so a crossing can open the film at its moment.

Code written with AI assistance (Claude); see AI_USAGE.md.
"""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor

from .archive import skybot
from .archive.skyindex import SkyIndex, split_visits
from .science.movers import Crossing, crossings, group_times, query_radius_deg

# A body of V = 17.1 (Makemake) reaches a median peak S/N of 16 in one detector-1
# exposure (docs/decision-tests.md, test 1). Scaled by brightness, S/N 3 is near V = 19.
VISIBLE_V = 19.0
MAX_RATE_ARCSEC_H = 60.0  # main-belt asteroids and slower; fast near-Earth objects can be missed
DETECTORS = (1, 2, 3, 4)


def movers_in_field(index: SkyIndex, ra: float, dec: float, fov_arcmin: float, workers: int = 6):
    """Returns (visits, [(visit index, Crossing)], number of queries, number of failed queries)."""
    visits = split_visits(index.lookup(ra, dec, detectors=DETECTORS))
    half = fov_arcmin * 60 / 2
    jobs = [(vi, times) for vi, visit in enumerate(visits) for times in group_times([h.mjd for h in visit])]

    def ask(job):
        vi, times = job
        mid = float((times.min() + times.max()) / 2)
        try:
            return vi, times, skybot.cone(ra, dec, mid, query_radius_deg(times, half, MAX_RATE_ARCSEC_H)), False
        except skybot.SkybotUnavailable:
            return vi, times, [], True

    with ThreadPoolExecutor(workers) as pool:
        answers = list(pool.map(ask, jobs))
    found: list[tuple[int, Crossing]] = []
    for vi in range(len(visits)):
        groups = [(times, rows) for v, times, rows, failed in answers if v == vi and not failed]
        found.extend((vi, c) for c in crossings(groups, ra, dec, half))
    return visits, found, len(jobs), sum(a[3] for a in answers)
