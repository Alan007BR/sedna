"""Build SEDNA's own sky index straight from the public bucket.

For every Level-2 file of the chosen weeks and detectors, reads the small IMAGE
header and stores what is needed to answer "which exposures cover this position,
and when?" without calling any IRSA service.

Usage:
    python -m sedna.archive.build_index RELEASE WEEK_FROM WEEK_TO [--detectors 1,2,3,4,5,6]
    e.g. python -m sedna.archive.build_index qr2 2025W20 2025W28 --detectors 1

Output: data/index/<release>_<week>.jsonl (one line per file).

Code written with AI assistance (Claude); see AI_USAGE.md.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from . import s3

WCS_KEYS = ["CRPIX1", "CRPIX2", "CRVAL1", "CRVAL2", "PC1_1", "PC1_2", "PC2_1", "PC2_2", "CDELT1", "CDELT2"]
OUT_DIR = Path(__file__).resolve().parents[3] / "data" / "index"


def record(key: str) -> dict:
    h = s3.read_image_header(key)
    hd = h.header
    rec = {
        "key": key,
        "obsid": hd.get("OBSID"),
        "det": int(hd.get("DETECTOR")),
        "mjd": float(hd.get("MJD-AVG")),
        "mjd_beg": float(hd.get("MJD-BEG")),
        "mjd_end": float(hd.get("MJD-END")),
        "epa": float(hd.get("SPS_EPA", "nan")),
        "elon": float(hd.get("SPS_ELON", "nan")),
        "elat": float(hd.get("SPS_ELAT", "nan")),
        "dqa": hd.get("L2DQAFLG"),
        "version": hd.get("VERSION"),
        "data_start": h.data_start,
        "wcs": {k: float(hd[k]) for k in WCS_KEYS if k in hd},
        "sip": {k: float(v) for k, v in hd.items() if k[:2] in ("A_", "B_") or k[:3] in ("AP_", "BP_")},
    }
    return rec


def week_folders(release: str, week_from: str, week_to: str) -> list[str]:
    weeks, _ = s3.list_prefix(f"{release}/level2/")
    chosen = []
    for w in weeks:
        name = w.rstrip("/").split("/")[-1]  # e.g. 2025W20_2B
        if week_from <= name[:7] <= week_to:
            chosen.append(w)
    return chosen


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("release")
    ap.add_argument("week_from")
    ap.add_argument("week_to")
    ap.add_argument("--detectors", default="1,2,3,4,5,6")
    ap.add_argument("--workers", type=int, default=48)
    args = ap.parse_args()
    dets = args.detectors.split(",")
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    for week in week_folders(args.release, args.week_from, args.week_to):
        name = week.rstrip("/").split("/")[-1]
        out = OUT_DIR / f"{args.release}_{name}_d{''.join(dets)}.jsonl"
        if out.exists():
            print(f"{name}: already indexed, skipping")
            continue
        versions, _ = s3.list_prefix(week)
        keys: dict[tuple[str, str], str] = {}
        for v in sorted(versions):  # later versions (e.g. retries) replace earlier ones
            for d in dets:
                _, ks = s3.list_prefix(f"{v}{d}/", delimiter="")
                for k, _size in ks:
                    if k.endswith(".fits"):
                        obs = k.split("/")[-1].split("_spx_")[0]
                        keys[(obs, d)] = k
        t0 = time.time()
        recs, failed = [], 0
        with ThreadPoolExecutor(args.workers) as pool:
            futures = {pool.submit(record, k): k for k in keys.values()}
            for f in as_completed(futures):
                try:
                    recs.append(f.result())
                except Exception as err:  # keep going; report the count
                    failed += 1
                    if failed <= 3:
                        print("  failed:", futures[f], repr(err)[:120], file=sys.stderr)
        recs.sort(key=lambda r: (r["mjd"], r["det"]))
        if not recs:
            print(f"{name}: nothing indexed ({failed} failed); not writing a file")
            continue
        with out.open("w") as fh:
            for r in recs:
                fh.write(json.dumps(r) + "\n")
        dt = time.time() - t0
        print(f"{name}: {len(recs)} files indexed, {failed} failed, {dt:.0f} s ({len(recs) / max(dt, 1e-6):.0f}/s)")


if __name__ == "__main__":
    main()
