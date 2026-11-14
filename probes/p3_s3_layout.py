"""Decision test 3a: how is the SPHEREx bucket organised, and what is in a file header?

Lists the weekly folders of a release, counts the files of one folder, and reads
the first bytes of one Level-2 file to see which pointing keywords come first.

Code written with AI assistance (Claude); see AI_USAGE.md.
"""
import re
import sys
import time

import requests

BUCKET = "https://nasa-irsa-spherex.s3.amazonaws.com"
release = sys.argv[1] if len(sys.argv) > 1 else "qr3"
s = requests.Session()


def list_prefix(prefix, delimiter="/", max_pages=50):
    prefixes, keys, token = [], [], None
    for _ in range(max_pages):
        params = {"list-type": "2", "prefix": prefix, "delimiter": delimiter}
        if token:
            params["continuation-token"] = token
        t = s.get(BUCKET + "/", params=params, timeout=60).text
        prefixes += re.findall(r"<Prefix>([^<]+)</Prefix>", t)[1:] if delimiter else []
        keys += [(k, int(z)) for k, z in re.findall(r"<Key>([^<]+)</Key>.*?<Size>(\d+)</Size>", t, flags=re.S)]
        m = re.search(r"<NextContinuationToken>([^<]+)</NextContinuationToken>", t)
        if not m:
            break
        token = m.group(1)
    return prefixes, keys


weeks, _ = list_prefix(f"{release}/level2/")
print(f"{release}: {len(weeks)} weekly folders; first {weeks[:3]} last {weeks[-3:]}")
sub, _ = list_prefix(weeks[len(weeks) // 2])
print("inside a week:", sub[:4])
sub2, _ = list_prefix(sub[0])
print("inside that:", sub2[:8])
t0 = time.time()
_, keys = list_prefix(sub2[0], delimiter="")
print(f"files in {sub2[0]}: {len(keys)} (listed in {time.time() - t0:.1f} s); example:")
key, size = keys[0]
print("  ", key, f"{size / 1e6:.1f} MB")

t0 = time.time()
r = s.get(f"{BUCKET}/{key}", headers={"Range": "bytes=0-28799"}, timeout=60)
print(f"first 28.8 kB: http {r.status_code} in {time.time() - t0:.2f} s")
cards = [r.content[i : i + 80].decode("ascii", "replace") for i in range(0, len(r.content), 80)]
hdu, shown = 0, 0
for c in cards:
    if c.startswith("END" + " " * 77):
        hdu += 1
        print(f"--- END of header {hdu - 1}")
        continue
    if any(c.startswith(k) for k in ("SIMPLE", "XTENSION", "EXTNAME", "NAXIS", "BITPIX", "CRVAL", "CRPIX", "CTYPE", "CD1_", "CD2_", "PC1_", "PC2_", "CDELT", "RA", "DEC", "DATE", "MJD", "DETECTOR", "OBSID", "EXPTIME", "VERSION", "A_ORDER", "B_ORDER", "SPS_", "BUNIT", "PA", "TELAPSE", "EXPIDN", "L1", "L2")):
        print("  ", c.rstrip())
        shown += 1
    if shown > 90:
        break
