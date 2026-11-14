"""Direct access to the public SPHEREx bucket on AWS (no IRSA service involved).

The bucket is anonymous. Level-2 spectral images are laid out as
``<release>/level2/<week>/<pipeline version>/<detector>/<file>.fits``. The first
few kilobytes of each file hold the primary header and the IMAGE header, which
carries the full celestial WCS and the observation time. IMAGE, VARIANCE and ZODI
are uncompressed float32, so a strip of rows can be read with one HTTP range
request.

Code written with AI assistance (Claude); see AI_USAGE.md.
"""
from __future__ import annotations

import re
import threading
from dataclasses import dataclass

import numpy as np
import requests
from astropy.io import fits
from requests.adapters import HTTPAdapter

BUCKET_URL = "https://nasa-irsa-spherex.s3.amazonaws.com"
BLOCK = 2880
HEADER_BYTES = 10 * BLOCK  # primary header (1 block) + IMAGE header (9 blocks in pipeline 7.0.5)
NAXIS = 2040

_local = threading.local()


def session() -> requests.Session:
    """One pooled HTTP session per thread."""
    s = getattr(_local, "session", None)
    if s is None:
        s = requests.Session()
        s.mount("https://", HTTPAdapter(pool_connections=4, pool_maxsize=64, max_retries=3))
        _local.session = s
    return s


def list_prefix(prefix: str, delimiter: str = "/") -> tuple[list[str], list[tuple[str, int]]]:
    """List sub-prefixes and (key, size) pairs under a prefix, following pagination."""
    prefixes: list[str] = []
    keys: list[tuple[str, int]] = []
    token = None
    while True:
        params = {"list-type": "2", "prefix": prefix}
        if delimiter:
            params["delimiter"] = delimiter
        if token:
            params["continuation-token"] = token
        text = session().get(BUCKET_URL + "/", params=params, timeout=60).text
        prefixes += re.findall(r"<CommonPrefixes><Prefix>([^<]+)</Prefix>", text)
        keys += [(k, int(z)) for k, z in re.findall(r"<Key>([^<]+)</Key>.*?<Size>(\d+)</Size>", text, flags=re.S)]
        m = re.search(r"<NextContinuationToken>([^<]+)</NextContinuationToken>", text)
        if not m:
            return prefixes, keys
        token = m.group(1)


def get_range(key: str, start: int, end_inclusive: int, timeout: float = 60) -> bytes:
    r = session().get(f"{BUCKET_URL}/{key}", headers={"Range": f"bytes={start}-{end_inclusive}"}, timeout=timeout)
    r.raise_for_status()
    return r.content


@dataclass
class ImageHeader:
    """Parsed IMAGE header of one Level-2 file plus where its pixel data starts."""

    key: str
    header: fits.Header
    data_start: int  # byte offset of the first IMAGE pixel


def _split_header(raw: bytes, offset: int) -> tuple[fits.Header, int]:
    """Parse the header starting at ``offset``; return it and the offset just after its last block."""
    n = 0
    while True:
        card = raw[offset + n * 80 : offset + (n + 1) * 80]
        if len(card) < 80:
            raise ValueError("header longer than the bytes read")
        n += 1
        if card.rstrip() == b"END":
            break
    length = -(-n * 80 // BLOCK) * BLOCK
    text = raw[offset : offset + n * 80].decode("ascii", "replace")
    return fits.Header.fromstring(text), offset + length


def read_image_header(key: str) -> ImageHeader:
    """Read the primary and IMAGE headers of a Level-2 file with one small range request."""
    raw = get_range(key, 0, HEADER_BYTES - 1)
    try:
        primary, off1 = _split_header(raw, 0)
        image, data_start = _split_header(raw, off1)
    except ValueError:  # a longer header than usual: read more and try once again
        raw = get_range(key, 0, 3 * HEADER_BYTES - 1)
        primary, off1 = _split_header(raw, 0)
        image, data_start = _split_header(raw, off1)
    image["VERSION"] = primary.get("VERSION", "")
    return ImageHeader(key=key, header=image, data_start=data_start)


def read_rows(key: str, data_start: int, y0: int, y1: int) -> np.ndarray:
    """Read IMAGE rows y0..y1-1 (0-based, FITS order) as a float32 array of shape (y1-y0, 2040)."""
    y0, y1 = max(0, y0), min(NAXIS, y1)
    start = data_start + 4 * NAXIS * y0
    end = data_start + 4 * NAXIS * y1 - 1
    raw = get_range(key, start, end)
    return np.frombuffer(raw, dtype=">f4").reshape(y1 - y0, NAXIS).astype(np.float32)
