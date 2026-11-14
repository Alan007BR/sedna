"""Next-visit check on every visit of the known bodies.

For each visit with a focus result, predict the position at SPHEREx's next visit
with the same model, search the predicted region (``service/sedna/next_visit_service.py``)
and compare both the prediction and any detection with JPL Horizons seen from SPHEREx.

Code written with AI assistance (Claude); see AI_USAGE.md.
"""
import json
import sys
import warnings
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "service"))
warnings.filterwarnings("ignore")
from sedna.api import focus, next_visit_body  # noqa: E402

rows = []
for body, n_visits in (("makemake", 3), ("haumea", 3), ("pluto", 4), ("eris", 3)):
    for v in range(n_visits):
        try:
            f = focus(body, v)
        except Exception as err:  # noqa: BLE001
            print(body, v + 1, "focus failed:", getattr(err, "detail", err))
            continue
        if f["confidence"] == "none":
            rows.append(dict(body=body, visit=v + 1, focus_au=f["bestDistanceAu"], true_au=f["trueDistanceAu"], status="no focus"))
            print(rows[-1])
            continue
        p = next_visit_body(body, v)
        rows.append(
            dict(
                body=body,
                visit=v + 1,
                focus_au=f["bestDistanceAu"],
                true_au=f["trueDistanceAu"],
                status=p["status"],
                days_ahead=p["daysAhead"],
                jump_deg=p["jumpDeg"],
                prediction_error_arcmin=p["truth"]["predictionErrorArcmin"] if p["truth"] else None,
                found_snr=p["found"]["snr"] if p["found"] else None,
                found_error_arcsec=p["truth"]["foundErrorArcsec"] if p["truth"] else None,
                exposures=p["window"]["exposures"] if p["window"] else None,
            )
        )
        print(rows[-1])

Path(__file__).with_suffix(".json").write_text(json.dumps(rows, indent=1))
