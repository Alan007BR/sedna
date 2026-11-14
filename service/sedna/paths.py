"""Where the service reads its data and writes its caches.

The index and the wavelength map ship with the code (data/index, data/wavelength). Caches go to data/cache,
or to SEDNA_CACHE_DIR when the code's folder is read-only, as on AWS Lambda (SEDNA_CACHE_DIR=/tmp/sedna-cache).

Code written with AI assistance (Claude); see AI_USAGE.md.
"""
from __future__ import annotations

import os
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parents[2] / "data"
CACHE_DIR = Path(os.environ["SEDNA_CACHE_DIR"]) if os.environ.get("SEDNA_CACHE_DIR") else DATA_DIR / "cache"
