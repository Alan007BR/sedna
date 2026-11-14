"""The name resolver: Sesame's XML, unknown names, tidy identifiers, and a mirror that is down.

Code written with AI assistance (Claude); see AI_USAGE.md.
"""
import requests

from sedna.api import _tidy_identifier
from sedna.archive import sesame

BETELGEUSE = """<?xml version="1.0" encoding="UTF-8"?>
<Sesame><Target option="SNV"><name>betelgeuse</name>
  <Resolver name="Sc=Simbad (CDS, via client/server)">
    <oid>843879</oid><otype>s*r</otype>
    <jradeg>88.79293899</jradeg><jdedeg>7.407064</jdedeg>
    <pm><v>29.77</v><pmRA>27.54</pmRA><pmDE>11.30</pmDE></pm>
    <oname>* alf Ori</oname>
  </Resolver>
</Target></Sesame>"""

CERES = """<?xml version="1.0" encoding="UTF-8"?>
<Sesame><Target option="SNV"><name>Ceres</name>
  <Resolver name="Sc=Simbad (CDS, via client/server)"><INFO>*** Nothing found ***</INFO></Resolver>
  <Resolver name="N=NED"><INFO>*** Nothing found ***</INFO></Resolver>
</Target></Sesame>"""


def test_reads_position_motion_and_identifier():
    r = sesame.parse(BETELGEUSE, "betelgeuse", "CfA mirror")
    assert r.name == "* alf Ori"
    assert (r.ra, r.dec) == (88.79293899, 7.407064)
    assert (r.pm_ra, r.pm_dec) == (27.54, 11.30)
    assert r.resolver == "Simbad" and r.otype == "s*r"


def test_unknown_names_resolve_to_none():
    assert sesame.parse(CERES, "Ceres", "CfA mirror") is None


def test_identifiers_are_tidied_for_people():
    assert _tidy_identifier("M  42") == "M 42"
    assert _tidy_identifier("NAME Barnard's star") == "Barnard's star"
    assert _tidy_identifier("Cl Melotte   22") == "Cl Melotte 22"


def test_a_mirror_that_is_down_falls_through_to_the_next(tmp_path, monkeypatch):
    monkeypatch.setattr(sesame, "CACHE", tmp_path)
    asked = []

    class Fake:
        def get(self, url, timeout):
            asked.append(url)
            if "cfa" in url:
                raise requests.ConnectionError("down")
            return type("R", (), {"text": BETELGEUSE, "raise_for_status": lambda self: None})()

    monkeypatch.setattr(sesame, "session", lambda: Fake())
    r = sesame.resolve("Betelgeuse")
    assert r.source == "IDIA mirror" and len(asked) == 2
    # answered from the cache afterwards, whatever the case
    monkeypatch.setattr(sesame, "session", lambda: None)
    assert sesame.resolve("betelgeuse").name == "* alf Ori"
