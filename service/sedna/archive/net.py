"""One HTTPS session for every outside service the data service calls: the SPHEREx bucket, Gaia, SIMBAD, SkyBoT.

Two costs made live requests slow, measured on one new 6' field (about 400 exposures, two requests each):
- a session per worker thread opened new connections for every request, since the workers end with it;
- requests builds a new TLS context for each new connection, and OpenSSL 3 takes about 0.2 s of CPU to load
  a CA bundle into it. One context, loaded once, makes a new connection cost about 1 ms instead.
Certificates are still verified (CERT_REQUIRED and hostname checks, with certifi's bundle).

Code written with AI assistance (Claude); see AI_USAGE.md.
"""
from __future__ import annotations

import os
import ssl
import threading

import certifi
import requests
from requests.adapters import HTTPAdapter

# parallel downloads per request (stacks, films, focus, brightness): tune with SEDNA_WORKERS without rebuilding
WORKERS = int(os.environ.get("SEDNA_WORKERS", "24"))

_session: requests.Session | None = None
_lock = threading.Lock()
_tls: ssl.SSLContext | None = None


def _tls_context() -> ssl.SSLContext:
    # built under the lock: the first request's worker threads all connect at once, and each would load the bundle
    global _tls
    if _tls is None:
        with _lock:
            if _tls is None:
                _tls = ssl.create_default_context(cafile=certifi.where())
    return _tls


class SharedTLSAdapter(HTTPAdapter):
    """Verifies certificates with the shared context instead of building and loading a new one per connection."""

    def build_connection_pool_key_attributes(self, request, verify, cert=None):
        host_params, pool_kwargs = super().build_connection_pool_key_attributes(request, verify, cert)
        if verify is True:
            pool_kwargs["ssl_context"] = _tls_context()
        return host_params, pool_kwargs

    def cert_verify(self, conn, url, verify, cert):
        super().cert_verify(conn, url, verify, cert)
        if verify is True:  # the context already holds the CA bundle; naming it again would reload it per connection
            conn.ca_certs = None
            conn.ca_cert_dir = None


def session() -> requests.Session:
    """The process-wide session, shared by every thread and kept between requests (thread-safe for GETs)."""
    global _session
    if _session is None:
        _tls_context()
        with _lock:
            if _session is None:
                s = requests.Session()
                # one pool per host (bucket, Gaia, SIMBAD mirrors, SkyBoT), up to 64 connections each
                s.mount("https://", SharedTLSAdapter(pool_connections=16, pool_maxsize=max(64, WORKERS), max_retries=3))
                _session = s
    return _session
