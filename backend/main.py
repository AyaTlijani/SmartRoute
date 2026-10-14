"""
main.py — SmartRoute FastAPI application.

    Excel import → validation → assignment to drivers → OR-Tools routing
    → driver app (deliver / fail, cash, photo) → overview and analytics

The endpoints live in:
    auth.py       login, sessions, roles
    dispatch.py   orders, import, assignment, routing, driver actions
    driver_day.py driver's day: start route, end of day, cash handover
    drivers.py    fleet management
    analytics.py  overview and analytics
"""

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

import analytics
import auth
import dispatch
import driver_day
import drivers
import sample_data
from db import connect, init_db

logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(name)s  %(message)s")
logger = logging.getLogger("smartroute_api")

app = FastAPI(
    title="SmartRoute",
    description=(
        "Delivery dispatch for small Tunisian courier companies: Excel import, "
        "zone-based or optimizer assignment, OR-Tools routing with time windows, "
        "driver app with cash-on-delivery tracking, and analytics."
    ),
    version="2.0.0",
)

app.include_router(auth.router)
app.include_router(dispatch.router)
app.include_router(driver_day.router)
app.include_router(drivers.router)
app.include_router(analytics.router)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def _startup() -> None:
    """Create tables; load demo data on first run only."""
    init_db()
    with connect() as conn:
        if conn.execute("SELECT COUNT(*) FROM drivers").fetchone()[0] == 0:
            logger.info("Empty database: loading demo data")
            sample_data.seed_demo(conn)
        sample_data.ensure_accounts(conn)


@app.get("/health", tags=["Meta"])
def health_check() -> dict:
    return {"status": "ok", "service": "SmartRoute"}
