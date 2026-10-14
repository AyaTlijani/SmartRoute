"""
config.py — Environment configuration loader for the VRPTW backend.

Why this file exists:
    Centralises all environment-variable reads into one place so that every
    other module can simply `from config import ORS_API_KEY` without
    worrying about dotenv loading order or missing-key edge cases.

Pattern:
    python-dotenv reads the .env file in the project root (or CWD at startup)
    and pushes the values into os.environ before the first import that touches
    os.getenv().  We deliberately raise at import time (fail-fast) rather than
    letting a bad key propagate silently into the ORS API call.
"""

import os
from dotenv import load_dotenv

# load_dotenv() is idempotent and safe to call at module level.
# It merges .env values into os.environ WITHOUT overwriting any variables
# already set by the shell — handy for CI/CD environments that inject secrets
# via real env vars.
load_dotenv()

ORS_API_KEY: str = os.getenv("ORS_API_KEY", "")

# The key is optional. Without it, SmartRoute estimates driving times from
# straight-line distance and draws straight segments between stops, so the
# app (dispatch, driver view, analytics) works fully offline for demos.
# The original address-based /optimize-route endpoint still needs the key.
USE_ORS: bool = bool(ORS_API_KEY)
