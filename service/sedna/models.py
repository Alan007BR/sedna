"""Response models of the SEDNA data service (Pydantic). The web app validates the same shapes with Zod.

Only the newer endpoints have models so far; the others return plain dicts.

Code written with AI assistance (Claude); see AI_USAGE.md.
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel


class SkyPoint(BaseModel):
    ra: float
    dec: float


class TrackPoint(BaseModel):
    mjd: float
    ra: float
    dec: float


class VisitSpan(BaseModel):
    index: int
    start: str
    end: str


class Mover(BaseModel):
    name: str
    number: int | None
    category: str  # SkyBoT class, e.g. "MB>Inner" or "KBO>Classical>Main"
    vMag: float | None
    visible: bool  # bright enough to show in single exposures (vMag <= visibleV)
    rateArcsecPerHour: float
    distanceAu: float | None
    visit: int
    firstInField: str
    lastInField: str
    closestDate: str
    closestMjd: float
    closestArcsec: float
    track: list[TrackPoint]


class MoversResponse(BaseModel):
    schemaVersion: int
    release: str
    center: SkyPoint
    fovArcmin: float
    status: Literal["ok", "partial", "unavailable"]
    queries: int
    failedQueries: int
    visibleV: float
    maxRateArcsecPerHour: float
    visits: list[VisitSpan]
    movers: list[Mover]
    fainter: int
    method: str
    seconds: float
    source: Literal["archive", "cache"]
