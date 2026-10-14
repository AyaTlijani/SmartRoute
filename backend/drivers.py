"""
drivers.py — Fleet management (admin only).

A driver record (zones, depot, capacity, active) drives assignment and
routing. Each driver also has a login account (users table, role 'driver').
"""

from datetime import date
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from auth import CurrentUser, hash_password, require_admin
from db import connect, rows
from dispatch import _route_all
from tunisia import GOVERNORATES

router = APIRouter(tags=["Drivers"])

# Starting points offered in the driver form.
DEPOTS = [
    {"name": "SmartRoute Hub, Charguia", "lat": 36.8400, "lng": 10.2050},
    {"name": "Sousse relay point", "lat": 35.8256, "lng": 10.6084},
    {"name": "Sfax relay point", "lat": 34.7406, "lng": 10.7603},
    {"name": "Nabeul relay point", "lat": 36.4561, "lng": 10.7376},
    {"name": "Bizerte relay point", "lat": 37.2744, "lng": 9.8739},
    {"name": "Djerba relay point", "lat": 33.8750, "lng": 10.8570},
]


@router.get("/meta")
def meta(_: CurrentUser = Depends(require_admin)):
    return {"governorates": sorted(GOVERNORATES), "depots": DEPOTS, "vehicles": ["scooter", "car", "van"]}


def _driver_list(conn):
    today = date.today().isoformat()
    return rows(conn, """
        SELECT d.*, u.username, u.id AS user_id,
          (SELECT COUNT(*) FROM orders o WHERE o.driver_id = d.id AND o.delivery_date = ?) AS today_orders,
          (SELECT COUNT(*) FROM attempts a WHERE a.driver_id = d.id AND a.voided_at IS NULL) AS total_attempts,
          (SELECT COUNT(*) FROM attempts a WHERE a.driver_id = d.id AND a.voided_at IS NULL
              AND a.result = 'delivered') AS total_delivered
        FROM drivers d LEFT JOIN users u ON u.driver_id = d.id
        ORDER BY d.active DESC, d.name""", (today,))


@router.get("/drivers")
def list_drivers(_: CurrentUser = Depends(require_admin)):
    with connect() as conn:
        return _driver_list(conn)


class DriverIn(BaseModel):
    name: str = Field(..., min_length=2, max_length=80)
    phone: str = Field(..., pattern=r"^[2-9]\d{7}$")
    vehicle: str = "scooter"
    zones: List[str] = Field(..., min_length=1)
    depot_name: str
    depot_lat: float = Field(..., ge=30, le=38)
    depot_lng: float = Field(..., ge=7, le=12)
    max_orders: int = Field(20, ge=1, le=100)
    active: bool = True


class DriverCreate(DriverIn):
    username: str = Field(..., min_length=3, max_length=40, pattern=r"^[a-zA-Z0-9._-]+$")
    password: str = Field(..., min_length=6)


def _check_zones(zones):
    bad = [z for z in zones if z not in GOVERNORATES]
    if bad:
        raise HTTPException(400, f"Unknown governorate(s): {', '.join(bad)}")


@router.post("/drivers")
def create_driver(req: DriverCreate, _: CurrentUser = Depends(require_admin)):
    _check_zones(req.zones)
    with connect() as conn:
        if conn.execute("SELECT 1 FROM users WHERE username = ?", (req.username,)).fetchone():
            raise HTTPException(400, f"Username '{req.username}' is already taken.")
        cur = conn.execute(
            "INSERT INTO drivers (name, phone, vehicle, zones, depot_name, depot_lat, depot_lng, max_orders, active) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (req.name, req.phone, req.vehicle, ",".join(req.zones), req.depot_name,
             req.depot_lat, req.depot_lng, req.max_orders, int(req.active)))
        conn.execute("INSERT INTO users (username, password_hash, role, driver_id, full_name) "
                     "VALUES (?, ?, 'driver', ?, ?)",
                     (req.username, hash_password(req.password), cur.lastrowid, req.name))
        return next(d for d in _driver_list(conn) if d["id"] == cur.lastrowid)


@router.put("/drivers/{driver_id}")
def update_driver(driver_id: int, req: DriverIn, _: CurrentUser = Depends(require_admin)):
    _check_zones(req.zones)
    with connect() as conn:
        old = conn.execute("SELECT * FROM drivers WHERE id = ?", (driver_id,)).fetchone()
        if not old:
            raise HTTPException(404, "Driver not found")
        conn.execute(
            "UPDATE drivers SET name=?, phone=?, vehicle=?, zones=?, depot_name=?, depot_lat=?, depot_lng=?, "
            "max_orders=?, active=? WHERE id=?",
            (req.name, req.phone, req.vehicle, ",".join(req.zones), req.depot_name, req.depot_lat,
             req.depot_lng, req.max_orders, int(req.active), driver_id))
        conn.execute("UPDATE users SET full_name = ? WHERE driver_id = ?", (req.name, driver_id))

        # Open orders this driver can no longer take (deactivated, zone
        # removed) go back to the unassigned pool, from today on.
        today = date.today().isoformat()
        open_orders = rows(conn, "SELECT id, governorate, delivery_date FROM orders WHERE driver_id = ? "
                                 "AND status = 'assigned' AND delivery_date >= ?", (driver_id, today))
        released = [o for o in open_orders if not req.active or o["governorate"] not in req.zones]
        for o in released:
            conn.execute("UPDATE orders SET driver_id = NULL, status = 'pending', stop_number = NULL, "
                         "eta = NULL, unscheduled_reason = NULL WHERE id = ?", (o["id"],))
        # Depot or anything route-related may have changed: recompute open days.
        for d in {o["delivery_date"] for o in open_orders}:
            _route_all(conn, d, {driver_id})
        result = next(d for d in _driver_list(conn) if d["id"] == driver_id)
        result["released_orders"] = len(released)
        return result


class PasswordReset(BaseModel):
    password: str = Field(..., min_length=6)


@router.post("/drivers/{driver_id}/password")
def reset_password(driver_id: int, req: PasswordReset, _: CurrentUser = Depends(require_admin)):
    with connect() as conn:
        n = conn.execute("UPDATE users SET password_hash = ? WHERE driver_id = ?",
                         (hash_password(req.password), driver_id)).rowcount
        if not n:
            raise HTTPException(404, "This driver has no account.")
        # Log the driver out everywhere.
        conn.execute("DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE driver_id = ?)", (driver_id,))
    return {"ok": True}
