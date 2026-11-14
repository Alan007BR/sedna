"""Built-in targets: the five the challenge names, plus distant control bodies.

Catalogue positions and proper motions are fixed here so the tool works even when
name resolvers are unreachable. Sources are listed per entry. Positions of the
high-proper-motion targets are propagated to each observation date.

Code written with AI assistance (Claude); see AI_USAGE.md.
"""
from __future__ import annotations

import numpy as np
from astropy.time import Time

# pm in arcsec/yr; pmRa includes cos(dec). epoch = epoch of the listed position (decimal year).
TARGETS = {
    "barnard": {
        "name": "Barnard's Star",
        "kind": "motion",
        "ra": 269.448503, "dec": 4.739420, "epoch": 2016.0,
        "pmRa": -0.80171, "pmDec": 10.36254, "parallaxMas": 546.98,
        "source": "Gaia DR3 4472832130942575872",
        "note": "Fastest known stellar proper motion: about 10 arcsec a year, 1.7 SPHEREx pixels. Try Difference: the star leaves a dark and a bright half.",
    },
    "wise0855": {
        "name": "WISE 0855-0714",
        "kind": "motion",
        "ra": 133.795129, "dec": -7.245147, "epoch": 2010.5,
        "pmRa": -8.118, "pmDec": 0.680, "parallaxMas": 449.0,
        "source": "Position from the challenge statement; motion from Luhman (2014)",
        "note": "Coldest known brown dwarf. Visible to SPHEREx only at 4-5 um; switch to detector 5 or 6.",
    },
    "epsindib": {
        "name": "Epsilon Indi B",
        "kind": "motion",
        "ra": 331.076453, "dec": -56.793812, "epoch": 2016.0,
        "pmRa": 3.98198, "pmDec": -2.46683, "parallaxMas": 270.66,
        "source": "Gaia DR3 6412596012146801152 (G = 18.0)",
        "note": "A pair of nearby brown dwarfs seen as one source. SPHEREx measures its motion to within 0.1 arcsec of Gaia.",
    },
    "rwaur": {
        "name": "RW Aurigae",
        "kind": "brightness",
        "ra": 76.95654, "dec": 30.40144, "epoch": 2000.0,
        "pmRa": 0.00723, "pmDec": -0.02033, "parallaxMas": 6.1,
        "source": "AAVSO VSX (OID 3777): classical T Tauri star, irregular",
        "note": "Young star with irregular dimming. Its infrared glow faded by 0.5-0.75 mag between September 2025 and September 2026.",
    },
    "rdra": {
        "name": "R Draconis",
        "kind": "brightness",
        "ra": 248.16762, "dec": 66.75497, "epoch": 2000.0,
        "pmRa": -0.02068, "pmDec": 0.00707, "parallaxMas": 1.5,
        "periodDays": 246.12, "maxEpochJd": 2457370.0,
        "source": "AAVSO VSX (OID 13673): Mira, period 246.12 d, V 6.7-13.2",
        "note": "Mira variable in SPHEREx's northern deep field: 2,589 exposures follow its 246-day pulsation.",
    },
    "sedna": {
        "name": "90377 Sedna",
        "kind": "follow",
        "horizons": "90377",
        "ra": 60.7, "dec": 8.6, "epoch": 2025.8,
        "vMag": 20.8,
        "source": "JPL Horizons, SPHEREx as observer (V from JPL Horizons)",
        "note": "The world this tool is named after, 83 au away. Invisible in any single SPHEREx exposure; stack 161 along its orbit and it appears.",
    },
    "makemake": {
        "name": "Makemake",
        "kind": "distance",
        "horizons": "136472",
        "ra": 200.0, "dec": 21.4, "epoch": 2025.45,
        "source": "JPL Horizons, SPHEREx as observer",
        "note": "Dwarf planet about 52 au away. Turn the distance focus and it snaps into a point.",
    },
    "haumea": {
        "name": "Haumea",
        "kind": "distance",
        "horizons": "136108",
        "ra": 218.6, "dec": 14.9, "epoch": 2025.5,
        "source": "JPL Horizons, SPHEREx as observer",
        "note": "Dwarf planet about 49 au away, on a nearly circular orbit: the cleanest control.",
    },
    "pluto": {
        "name": "Pluto",
        "kind": "distance",
        "horizons": "999",
        "ra": 306.6, "dec": -22.9, "epoch": 2025.4,
        "source": "JPL Horizons, SPHEREx as observer",
        "note": "About 35 au away on an eccentric orbit, where the circular-orbit assumption is weakest.",
    },
    "eris": {
        "name": "Eris",
        "kind": "distance",
        "horizons": "136199",
        "ra": 27.3, "dec": -0.15, "epoch": 2025.6,
        "source": "JPL Horizons, SPHEREx as observer",
        "note": "About 95 au away and faint: near the limit of what single exposures can show.",
    },
}


def propagate(target: dict, mjd: float) -> tuple[float, float]:
    """Catalogue position moved to ``mjd`` with linear proper motion (parallax ignored: under 0.1 pixel)."""
    years = Time(mjd, format="mjd").decimalyear - target["epoch"]
    dec = target["dec"] + target.get("pmDec", 0.0) * years / 3600
    ra = target["ra"] + target.get("pmRa", 0.0) * years / 3600 / np.cos(np.radians(target["dec"]))
    return float(ra % 360), float(dec)
