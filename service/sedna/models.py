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


class TimeBin(BaseModel):
    index: int
    start: str
    end: str
    midMjd: float
    exposures: int


class ExposurePoint(BaseModel):
    mjd: float
    date: str
    detector: int
    wavelengthUm: float
    bandwidthUm: float
    flux: float | None  # µJy; null when the exposure could not be measured
    fluxErr: float | None
    saturatedPixels: int
    bin: int


class ChangePoint(BaseModel):
    bin: int
    midMjd: float
    deltaMag: float  # relative to this detector's median over time bins; positive is fainter
    error: float
    channels: int
    exposures: int
    reliable: bool  # three or more channels compared


class DetectorChange(BaseModel):
    detector: int
    rangeUm: tuple[float, float]
    points: list[ChangePoint]


class BrightnessResponse(BaseModel):
    schemaVersion: int
    release: str
    point: SkyPoint
    target: str | None
    method: Literal["aperture", "wing"]
    methodNote: str
    unit: str
    exposuresAvailable: int
    exposuresMeasured: int
    bins: list[TimeBin]
    exposures: list[ExposurePoint]
    change: list[DetectorChange]
    seconds: float
    source: Literal["archive", "cache"]


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
