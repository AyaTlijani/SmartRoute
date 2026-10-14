"""
driver_day.py — A driver's working day.

    1. Load packages, then "Start route"   → ETAs are recomputed from now
    2. Deliver / fail stops                 (dispatch.py)
    3. "Re-plan from here" when late        → remaining stops re-sequenced
                                              from the current position/time
    4. "End day": declare the cash handed over
    5. Admin confirms the cash received     → the day is reconciled

Deliveries can't be recorded before step 1 or after step 4.
"""

from datetime import date, datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from auth import CurrentUser, require_admin, require_driver
import clock
from db import connect
from dispatch import day_state, dispatch_view, driver_payload, FAIL_REASONS
from planning import route_driver

router = APIRouter(tags=["Driver day"])


def _now() -> str:
    return datetime.now().isoformat(sep=" ", timespec="seconds")


def _me(conn, user):
    return dict(conn.execute("SELECT * FROM drivers WHERE id = ?", (user.driver_id,)).fetchone())


def _my_day_payload(conn, drv, d):
    return {"day": d, "fail_reasons": FAIL_REASONS, **driver_payload(conn, drv, d)}


@router.post("/me/start")
def start_route(user: CurrentUser = Depends(require_driver)):
    d = date.today().isoformat()
    with connect() as conn:
        drv = _me(conn, user)
        ds = day_state(conn, drv["id"], d)
        if ds and ds["started_at"]:
            raise HTTPException(409, "Your route is already started.")
        n = conn.execute("SELECT COUNT(*) FROM orders WHERE delivery_date = ? AND driver_id = ? AND status = 'assigned'",
                         (d, drv["id"])).fetchone()[0]
        if not n:
            raise HTTPException(409, "You have no deliveries assigned today.")
        conn.execute("INSERT INTO driver_days (driver_id, day, started_at) VALUES (?, ?, ?) "
                     "ON CONFLICT(driver_id, day) DO UPDATE SET started_at = excluded.started_at",
                     (drv["id"], d, clock.start_time(d)))
        route_driver(conn, drv, d)  # arrival times now count from the real departure time
        return _my_day_payload(conn, drv, d)


class Position(BaseModel):
    lat: Optional[float] = Field(None, ge=30, le=38)
    lng: Optional[float] = Field(None, ge=7, le=12)


@router.post("/me/replan")
def replan(pos: Position, user: CurrentUser = Depends(require_driver)):
    """Re-sequence the remaining stops from here (phone position or last stop), from now."""
    d = date.today().isoformat()
    with connect() as conn:
        drv = _me(conn, user)
        ds = day_state(conn, drv["id"], d)
        if not ds or not ds["started_at"] or ds["ended_at"]:
            raise HTTPException(409, "Re-planning is available while your route is in progress.")
        if pos.lat is not None and pos.lng is not None:
            conn.execute("UPDATE driver_days SET last_lat = ?, last_lng = ? WHERE driver_id = ? AND day = ?",
                         (pos.lat, pos.lng, drv["id"], d))
        route_driver(conn, drv, d)
        return _my_day_payload(conn, drv, d)


class EndDay(BaseModel):
    cash_declared: float = Field(..., ge=0, le=100000)


@router.post("/me/end")
def end_day(req: EndDay, user: CurrentUser = Depends(require_driver)):
    d = date.today().isoformat()
    with connect() as conn:
        drv = _me(conn, user)
        ds = day_state(conn, drv["id"], d)
        if not ds or not ds["started_at"]:
            raise HTTPException(409, "Start your route first.")
        if ds["ended_at"]:
            raise HTTPException(409, "Your day is already closed.")
        left = conn.execute("SELECT COUNT(*) FROM orders WHERE delivery_date = ? AND driver_id = ? "
                            "AND status = 'assigned' AND stop_number IS NOT NULL", (d, drv["id"])).fetchone()[0]
        if left:
            raise HTTPException(409, f"Mark the {left} remaining stop(s) as delivered or failed first.")
        # Stops that never fitted the route go back to dispatch.
        conn.execute("UPDATE orders SET driver_id = NULL, status = 'pending', stop_number = NULL, eta = NULL "
                     "WHERE delivery_date = ? AND driver_id = ? AND status = 'assigned'", (d, drv["id"]))
        conn.execute("UPDATE driver_days SET ended_at = ?, cash_declared = ? WHERE driver_id = ? AND day = ?",
                     (clock.end_time(conn, drv["id"], d), req.cash_declared, drv["id"], d))
        return _my_day_payload(conn, drv, d)


class Receipt(BaseModel):
    cash_received: float = Field(..., ge=0, le=100000)


@router.post("/drivers/{driver_id}/days/{day}/receive")
def confirm_cash(driver_id: int, day: str, req: Receipt, admin: CurrentUser = Depends(require_admin)):
    """The admin counts the cash the driver handed over and records it."""
    with connect() as conn:
        ds = day_state(conn, driver_id, day)
        if not ds or not ds["ended_at"]:
            raise HTTPException(409, "The driver hasn't ended this day yet.")
        if ds["received_at"]:
            raise HTTPException(409, "Cash for this day was already confirmed.")
        conn.execute("UPDATE driver_days SET cash_received = ?, received_at = ?, received_by = ? "
                     "WHERE driver_id = ? AND day = ?", (req.cash_received, _now(), admin.id, driver_id, day))
    return dispatch_view(day)
