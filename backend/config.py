"""
config.py — environment settings for the backend.

Every other module does `from config import ORS_API_KEY` so the .env file is
read in one place.

Where the key is read from, first match wins:
    1. a real environment variable ORS_API_KEY (if it is not empty)
    2. backend/.env   (next to this file, whatever folder the server starts from)
    3. .env in the repository root
The files are read as UTF-8 with or without a byte-order mark, which Windows
Notepad sometimes adds and which would otherwise hide the first line.
"""

import os
from pathlib import Path

from dotenv import dotenv_values, load_dotenv

_HERE = Path(__file__).resolve().parent

# Other settings in .env (SMARTROUTE_CLOCK, SMARTROUTE_DB, ...) go into the
# environment as before; real environment variables are not overwritten.
for _env in (_HERE / ".env", _HERE.parent / ".env"):
    if _env.is_file():
        load_dotenv(_env, encoding="utf-8-sig")


def _read_key() -> str:
    value = os.getenv("ORS_API_KEY", "").strip()
    if value:
        return value
    for path in (_HERE / ".env", _HERE.parent / ".env"):
        if path.is_file():
            value = (dotenv_values(path, encoding="utf-8-sig").get("ORS_API_KEY") or "").strip().strip('"').strip("'")
            if value:
                return value
    return ""


ORS_API_KEY: str = _read_key()

# The key is optional. Without it, SmartRoute estimates driving times from
# straight-line distance and draws straight segments between stops, so the
# app works fully offline for demos.
USE_ORS: bool = bool(ORS_API_KEY)
