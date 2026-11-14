"""Which known moving bodies crossed a field while SPHEREx was looking at it.

Pure functions: no network. The caller supplies, for groups of exposure times no
longer than a day, the bodies a catalogue service saw near the field at the
group's middle time, with their apparent rates. Each body is moved linearly to
every exposure time of its group and kept where it falls inside the field.

Code written with AI assistance (Claude); see AI_USAGE.md.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np


@dataclass
class Crossing:
    name: str
    number: int | None
    cls: str
    v: float | None
    rate_arcsec_h: float
    distance_au: float | None
    mjd: list[float] = field(default_factory=list)  # exposure times with the body inside the field
    ra: list[float] = field(default_factory=list)
    dec: list[float] = field(default_factory=list)
    closest_mjd: float = 0.0
    closest_arcsec: float = float("inf")


def separation_arcsec(ra1, dec1, ra2, dec2):
    """Great-circle separation in arcseconds (haversine; inputs in degrees)."""
    ra1, dec1, ra2, dec2 = (np.radians(np.asarray(x, dtype=float)) for x in (ra1, dec1, ra2, dec2))
    h = np.sin((dec2 - dec1) / 2) ** 2 + np.cos(dec1) * np.cos(dec2) * np.sin((ra2 - ra1) / 2) ** 2
    return np.degrees(2 * np.arcsin(np.sqrt(np.clip(h, 0, 1)))) * 3600


def tangent_offsets_arcsec(ra, dec, ra0, dec0):
    """East and north offsets of (ra, dec) from the field centre on the tangent plane, in arcseconds."""
    ra, dec, ra0, dec0 = (np.radians(np.asarray(x, dtype=float)) for x in (ra, dec, ra0, dec0))
    cosc = np.sin(dec0) * np.sin(dec) + np.cos(dec0) * np.cos(dec) * np.cos(ra - ra0)
    east = np.cos(dec) * np.sin(ra - ra0) / cosc
    north = (np.cos(dec0) * np.sin(dec) - np.sin(dec0) * np.cos(dec) * np.cos(ra - ra0)) / cosc
    return np.degrees(east) * 3600, np.degrees(north) * 3600


def group_times(mjd, max_span_days: float = 1.0) -> list[np.ndarray]:
    """Split sorted exposure times into consecutive groups, each spanning at most ``max_span_days``."""
    mjd = np.sort(np.unique(np.asarray(mjd, dtype=float)))
    groups: list[list[float]] = []
    for t in mjd:
        if groups and t - groups[-1][0] <= max_span_days:
            groups[-1].append(t)
        else:
            groups.append([t])
    return [np.array(g) for g in groups]


def move_linear(ra, dec, rate_ra, rate_dec, mjd0, mjd):
    """Position at ``mjd`` from a position at ``mjd0`` and rates in arcsec/h (RA rate includes cos dec)."""
    hours = (np.asarray(mjd, dtype=float) - mjd0) * 24.0
    dec_t = dec + rate_dec * hours / 3600.0
    ra_t = ra + rate_ra * hours / 3600.0 / np.cos(np.radians(dec))
    return np.mod(ra_t, 360.0), dec_t


def query_radius_deg(times: np.ndarray, half_field_arcsec: float, max_rate_arcsec_h: float) -> float:
    """Cone radius that holds every body slower than ``max_rate`` that is in the field at any of ``times``."""
    half_span_h = (times.max() - times.min()) * 12.0
    return (half_field_arcsec * np.sqrt(2) + max_rate_arcsec_h * half_span_h + 30.0) / 3600.0


def crossings(groups: list[tuple[np.ndarray, list]], ra0: float, dec0: float, half_field_arcsec: float) -> list[Crossing]:
    """Merge the bodies seen in each time group into one crossing per body.

    ``groups`` holds (exposure times, sightings) pairs. A sighting needs the
    attributes name, number, cls, v, ra, dec, rate_ra, rate_dec, distance_au and
    mjd (the time its position refers to).
    """
    found: dict[str, Crossing] = {}
    for times, sightings in groups:
        for s in sightings:
            ra, dec = move_linear(s.ra, s.dec, s.rate_ra, s.rate_dec, s.mjd, times)
            east, north = tangent_offsets_arcsec(ra, dec, ra0, dec0)
            inside = (np.abs(east) <= half_field_arcsec) & (np.abs(north) <= half_field_arcsec)
            if not inside.any():
                continue
            key = str(s.number) if s.number is not None else s.name
            c = found.get(key)
            if c is None:
                c = found[key] = Crossing(
                    name=s.name, number=s.number, cls=s.cls, v=s.v,
                    rate_arcsec_h=float(np.hypot(s.rate_ra, s.rate_dec)), distance_au=s.distance_au,
                )
            sep = separation_arcsec(ra, dec, ra0, dec0)
            for t, r, d, si, ok in zip(times, ra, dec, sep, inside):
                if not ok:
                    continue
                c.mjd.append(float(t))
                c.ra.append(float(r))
                c.dec.append(float(d))
                if si < c.closest_arcsec:
                    c.closest_arcsec, c.closest_mjd = float(si), float(t)
    for c in found.values():
        order = np.argsort(c.mjd)
        c.mjd = [c.mjd[i] for i in order]
        c.ra = [c.ra[i] for i in order]
        c.dec = [c.dec[i] for i in order]
    return sorted(found.values(), key=lambda c: (c.v if c.v is not None else 99.0, c.closest_mjd))
