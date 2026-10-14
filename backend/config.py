"""
config.py — environment settings for the backend.

Every other module does `from config import ORS_API_KEY` so the .env file is
read in one place.

Where the key is read from, first match wins:
    1. a real environment variable ORS_API_KEY (if it is not empty)
    2. backend/.env   (next to this file, whatever folder the server starts from)
    3. .env in the repository root
The files may be UTF-8 (with or without a byte-order mark) or UTF-16, which
is what Notepad and PowerShell produce on Windows.
"""

import os
from pathlib import Path

_HERE = Path(__file__).resolve().parent
_ENV_FILES = (_HERE / ".env", _HERE.parent / ".env")


def _read_env(path: Path) -> dict:
    """KEY=value lines of a .env file, whatever editor saved it.

    Handles UTF-8 with or without a byte-order mark and UTF-16 (what
    PowerShell's `echo ... > .env` writes), CRLF line ends, spaces around
    `=`, quotes, `export ` prefixes and comments.
    """
    raw = path.read_bytes()
    if raw.startswith((b"\xff\xfe", b"\xfe\xff")):
        text = raw.decode("utf-16")
    elif len(raw) > 1 and raw[1:2] == b"\x00":
        text = raw.decode("utf-16-le")
    elif raw[:1] == b"\x00":
        text = raw.decode("utf-16-be")
    else:
        text = raw.decode("utf-8-sig", errors="replace")
    values = {}
    for line in text.replace("\ufeff", "").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip().removeprefix("export ").strip()
        value = value.strip().strip('"').strip("'").strip()
        if key:
            values[key] = value
    return values


# Settings in .env (ORS_API_KEY, SMARTROUTE_CLOCK, SMARTROUTE_DB, ...) go into
# the environment. A real, non-empty environment variable is kept, and
# backend/.env wins over the root one because it is read first.
for _env in _ENV_FILES:
    if _env.is_file():
        try:
            _values = _read_env(_env)
        except (OSError, UnicodeDecodeError):
            continue  # unreadable file: run without it rather than crash
        for _k, _v in _values.items():
            if _v and "\x00" not in _k + _v and not os.environ.get(_k):
                os.environ[_k] = _v


def _read_key() -> str:
    return os.getenv("ORS_API_KEY", "").strip()


ORS_API_KEY: str = _read_key()

# The key is optional. Without it, SmartRoute estimates driving times from
# straight-line distance and draws straight segments between stops, so the
# app works fully offline for demos.
USE_ORS: bool = bool(ORS_API_KEY)
