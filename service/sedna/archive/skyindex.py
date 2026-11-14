"""SEDNA's sky index: which SPHEREx exposures cover a position, on which detector, and when.

Only detector 1 is indexed. The other five detectors sit at fixed offsets from it
in the same exposure (detectors 4, 5, 6 see the same fields as 1, 2, 3 through the
dichroic), measured in ``probes/p7_detector_geometry.py``. A lookup is a vectorised
tangent-plane projection over the whole index, a few milliseconds for the mission.
The exact WCS of each chosen file is read from its own header afterwards.

Code written with AI assistance (Claude); see AI_USAGE.md.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np

INDEX_DIR = Path(__file__).resolve().parents[3] / "data" / "index"
COMPACT = INDEX_DIR / "compact.npz"
HALF = 1020.0

# centre (dx, dy) in pixels and rotation in degrees of each detector in detector 1's ideal pixel frame
DETECTOR_FRAME = {
    1: (0.4, -1.2, 0.17),
    2: (2262.5, 32.8, 1.74),
    3: (4548.8, 133.5, 3.45),
    4: (-3.6, 10.3, 0.28),
    5: (2260.4, 42.8, 2.01),
    6: (4549.6, 145.2, 3.55),
}


@dataclass
class Hit:
    key: str  # bucket key of the file for this detector
    obsid: str
    det: int
    mjd: float
    epa: float
    x: float  # approximate pixel (refined later with the file's own WCS)
    y: float


def key_for(d1_key: str, det: int) -> str:
    parts = d1_key.split("/")
    parts[-2] = str(det)
    parts[-1] = parts[-1].replace("D1_spx", f"D{det}_spx")
    return "/".join(parts)


class SkyIndex:
    def __init__(self, arrays: dict):
        self.a = arrays
        self.n = len(arrays["mjd"])

    @classmethod
    def build_compact(cls) -> "SkyIndex":
        """Fold the per-week JSONL files into one compact array file."""
        cols = {k: [] for k in ("mjd", "epa", "crval1", "crval2", "pc11", "pc12", "pc21", "pc22")}
        keys, obsids = [], []
        seen = set()
        for path in sorted(INDEX_DIR.glob("*_d1.jsonl")):
            with path.open() as fh:
                for line in fh:
                    r = json.loads(line)
                    if r["obsid"] in seen or r.get("dqa") != "Pass":
                        continue
                    seen.add(r["obsid"])
                    w = r["wcs"]
                    cols["mjd"].append(r["mjd"])
                    cols["epa"].append(r["epa"])
                    cols["crval1"].append(w["CRVAL1"])
                    cols["crval2"].append(w["CRVAL2"])
                    cols["pc11"].append(w["PC1_1"])
                    cols["pc12"].append(w["PC1_2"])
                    cols["pc21"].append(w["PC2_1"])
                    cols["pc22"].append(w["PC2_2"])
                    keys.append(r["key"])
                    obsids.append(r["obsid"])
        arrays = {k: np.array(v, dtype=np.float64) for k, v in cols.items()}
        arrays["key"] = np.array(keys)
        arrays["obsid"] = np.array(obsids)
        order = np.argsort(arrays["mjd"])
        arrays = {k: v[order] for k, v in arrays.items()}
        np.savez_compressed(COMPACT, **arrays)
        return cls(arrays)

    @classmethod
    def load(cls) -> "SkyIndex":
        if not COMPACT.exists():
            return cls.build_compact()
        with np.load(COMPACT, allow_pickle=False) as z:
            return cls({k: z[k] for k in z.files})

    def _ideal_pixels(self, ra, dec, sel=slice(None)):
        """Offsets of (ra, dec) from detector 1's reference pixel under a pure TAN projection."""
        a = self.a
        ra0, dec0 = np.radians(a["crval1"][sel]), np.radians(a["crval2"][sel])
        ra, dec = np.radians(ra), np.radians(dec)
        cosc = np.sin(dec0) * np.sin(dec) + np.cos(dec0) * np.cos(dec) * np.cos(ra - ra0)
        with np.errstate(divide="ignore", invalid="ignore"):
            xi = np.degrees(np.cos(dec) * np.sin(ra - ra0) / cosc)
            eta = np.degrees((np.cos(dec0) * np.sin(dec) - np.sin(dec0) * np.cos(dec) * np.cos(ra - ra0)) / cosc)
        det = a["pc11"][sel] * a["pc22"][sel] - a["pc12"][sel] * a["pc21"][sel]
        px = (a["pc22"][sel] * xi - a["pc12"][sel] * eta) / det
        py = (-a["pc21"][sel] * xi + a["pc11"][sel] * eta) / det
        px = np.where(cosc > 0.9, px, np.nan)  # only the hemisphere around the pointing
        return px, py

    def lookup(self, ra, dec, margin: float = -40.0, detectors=(1, 2, 3, 4, 5, 6), mjd_range=None) -> list[Hit]:
        """Exposures whose detector contains the position.

        ``ra``/``dec`` may be scalars (a fixed position) or arrays of length n (a
        moving object's position at each indexed exposure time). A negative
        ``margin`` accepts positions slightly outside the ideal box; the caller
        confirms with the file's own WCS.
        """
        px, py = self._ideal_pixels(ra, dec)
        ok = np.isfinite(px)
        if mjd_range is not None:
            ok &= (self.a["mjd"] >= mjd_range[0]) & (self.a["mjd"] <= mjd_range[1])
        hits: list[Hit] = []
        for det in detectors:
            dx, dy, rot = DETECTOR_FRAME[det]
            c, s = np.cos(np.radians(rot)), np.sin(np.radians(rot))
            lx = c * (px - dx) + s * (py - dy)
            ly = -s * (px - dx) + c * (py - dy)
            inside = ok & (np.abs(lx) < HALF - margin) & (np.abs(ly) < HALF - margin)
            for i in np.flatnonzero(inside):
                hits.append(
                    Hit(
                        key=key_for(str(self.a["key"][i]), det),
                        obsid=str(self.a["obsid"][i]),
                        det=det,
                        mjd=float(self.a["mjd"][i]),
                        epa=float(self.a["epa"][i]),
                        x=float(lx[i] + HALF - 0.5),
                        y=float(ly[i] + HALF - 0.5),
                    )
                )
        hits.sort(key=lambda h: (h.mjd, h.det))
        return hits


def split_visits(hits: list[Hit], gap_days: float = 30.0) -> list[list[Hit]]:
    visits: list[list[Hit]] = []
    for h in hits:
        if visits and h.mjd - visits[-1][-1].mjd <= gap_days:
            visits[-1].append(h)
        else:
            visits.append([h])
    return visits
