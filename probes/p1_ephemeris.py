"""Decision test 1a: where were the distant control objects, as seen from SPHEREx?

Asks JPL Horizons for the apparent position of each object with SPHEREx itself as
the observer (spacecraft -163182), then keeps the dates on which the solar
elongation falls inside the range SPHEREx actually observes (81 to 129 degrees).

Code written with AI assistance (Claude); see AI_USAGE.md.
"""
import json
import sys
from pathlib import Path

from astroquery.jplhorizons import Horizons

OBSERVER = "500@-163182"  # SPHEREx spacecraft as the observing site
TARGETS = {
    "Pluto": "999",
    "Makemake": "136472",
    "Eris": "136199",
    "Haumea": "136108",
    "Sedna": "90377",
}
EPOCHS = {"start": "2025-05-01", "stop": "2026-10-10", "step": "5d"}
ELONG_RANGE = (81.0, 129.0)

out = {}
for name, ident in TARGETS.items():
    id_type = "majorbody" if ident == "999" else "smallbody"
    eph = Horizons(id=ident, location=OBSERVER, epochs=EPOCHS, id_type=id_type).ephemerides(quantities="1,9,19,20,23")
    rows = []
    for r in eph:
        rows.append(
            {
                "date": str(r["datetime_str"]),
                "jd": float(r["datetime_jd"]),
                "ra": float(r["RA"]),
                "dec": float(r["DEC"]),
                "r_au": float(r["r"]),
                "delta_au": float(r["delta"]),
                "elong": float(r["elong"]),
                "v": float(r["V"]) if "V" in r.colnames and str(r["V"]) != "--" else None,
            }
        )
    visible = [x for x in rows if ELONG_RANGE[0] <= x["elong"] <= ELONG_RANGE[1]]
    out[name] = rows
    first = rows[0]
    print(f"\n{name}: r={first['r_au']:.1f} au, V={first['v']}, RA={first['ra']:.3f} Dec={first['dec']:.3f} on {first['date']}")
    # contiguous windows of observable elongation
    windows, cur = [], []
    for x in rows:
        if ELONG_RANGE[0] <= x["elong"] <= ELONG_RANGE[1]:
            cur.append(x)
        elif cur:
            windows.append(cur)
            cur = []
    if cur:
        windows.append(cur)
    for w in windows:
        print(
            f"  window {w[0]['date'][:11]} -> {w[-1]['date'][:11]}  elong {w[0]['elong']:.0f}->{w[-1]['elong']:.0f}"
            f"  RA {w[0]['ra']:.3f}->{w[-1]['ra']:.3f}  Dec {w[0]['dec']:.3f}->{w[-1]['dec']:.3f}"
        )

Path(__file__).with_name("p1_ephemeris.json").write_text(json.dumps(out, indent=1))
print("\nsaved p1_ephemeris.json", file=sys.stderr)
