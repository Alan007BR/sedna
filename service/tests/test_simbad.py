"""SIMBAD rows turned into a star card: no network.

Code written with AI assistance (Claude); see AI_USAGE.md.
"""
from sedna.archive.simbad import summarise

BARNARD_IDS = "NAME Barnard's star|NAME Barnard Star|GJ 699|HIP 87937|2MASS J17574849+0441405|LHS    57|TYC  425-2502-1|Gaia DR3 4472832130942575872"


def test_named_star_gets_its_usual_name_type_distance_and_designations():
    s = summarise("NAME Barnard's star", "BY*", "BY Dra Variable", "M4V", 546.9759, BARNARD_IDS)
    assert s["name"] == "Barnard's star"
    assert s["type"] == "BY Dra Variable"
    assert s["spType"] == "M4V"
    assert s["distancePc"] == 1.83
    assert s["designations"][:3] == ["HIP 87937", "GJ 699", "LHS 57"]
    assert "TYC 425-2502-1" in s["designations"]  # runs of spaces collapsed
    assert s["identifiers"] == 8


def test_catalogue_star_without_a_name_keeps_its_main_identifier():
    s = summarise("HD  12345", "*", "Star", None, None, "HD 12345|TYC 1-2-3|Gaia DR3 1")
    assert s["name"] is None
    assert s["mainId"] == "HD 12345"
    assert s["distancePc"] is None
    assert s["designations"] == ["HD 12345", "TYC 1-2-3"]
