"""
dispatch.py — The daily delivery workflow.

    Excel upload → validate → import → assign to drivers → route each
    driver with OR-Tools → driver marks delivered / failed → analytics

All endpoints live on one APIRouter included by main.py, so the
original /optimize-route planner keeps working untouched.
"""

import json
import math
import os
import time
from datetime import date, timedelta
from typing import List, Optional

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel

import sample_data
from db import connect, rows
from distance import road_route_for_coordinates, time_matrix_for_coordinates
from orders_import import insert_orders, read_excel, validate_rows
from vrptw_solver import solve_vrptw

router = APIRouter()

UPLOAD_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)

# Same conventions as the original planner: minutes after 9:00 AM.
SLOT_WINDOWS = {0: (0, 480), 1: (0, 180), 2: (240, 480)}
SLOT_LABELS = {0: "Any time", 1: "Morning", 2: "Afternoon"}
DEPOT_WINDOW = (0, 540)
SERVICE_MINUTES = 10
XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def _day(value: Optional[str]) -> str:
    if not value:
        return date.today().isoformat()
    try:
        return date.fromisoformat(value).isoformat()
    except ValueError:
        raise HTTPException(400, f"Invalid date '{value}', use YYYY-MM-DD")


def _km(lat1, lng1, lat2, lng2):
    # Quick equirectangular distance; plenty for comparing nearby stops.
    x = math.radians(lng2 - lng1) * math.cos(math.radians((lat1 + lat2) / 2))
    y = math.radians(lat2 - lat1)
    return 6371 * math.hypot(x, y)


# ============================================================================
# DEMO DATA + EXCEL FILES
# ============================================================================

@router.post("/demo/reset", tags=["Demo"])
def demo_reset():
    """Delete everything and load drivers + 3 weeks of history."""
    with connect() as conn:
        return sample_data.seed_demo(conn)


@router.get("/excel/template", tags=["Excel"])
def excel_template():
    return Response(sample_data.template_xlsx(), media_type=XLSX,
                    headers={"Content-Disposition": 'attachment; filename="smartroute_template.xlsx"'})


@router.get("/excel/sample", tags=["Excel"])
def excel_sample(day: Optional[str] = None):
    d = date.fromisoformat(_day(day))
    return Response(sample_data.sample_orders_xlsx(d), media_type=XLSX,
                    headers={"Content-Disposition": f'attachment; filename="orders_{d.isoformat()}.xlsx"'})


# ============================================================================
# IMPORT
# ============================================================================

@router.post("/orders/validate", tags=["Orders"])
async def orders_validate(file: UploadFile = File(...), day: Optional[str] = Form(None)):
    d = _day(day)
    try:
        raw = read_excel(await file.read())
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    except Exception:
        raise HTTPException(400, "Could not read this file. Upload an .xlsx file.")
    with connect() as conn:
        return _validation_response(validate_rows(raw, d, conn), d)


class RevalidateRequest(BaseModel):
    day: Optional[str] = None
    rows: List[dict]  # raw rows, possibly corrected in the preview


@router.post("/orders/revalidate", tags=["Orders"])
def orders_revalidate(req: RevalidateRequest):
    d = _day(req.day)
    with connect() as conn:
        return _validation_response(validate_rows(req.rows, d, conn), d)


def _validation_response(results, d):
    return {
        "day": d,
        "rows": results,
        "summary": {
            "total": len(results),
            "ok": sum(r["status"] == "ok" for r in results),
            "warning": sum(r["status"] == "warning" for r in results),
            "error": sum(r["status"] == "error" for r in results),
        },
    }


class ImportRequest(BaseModel):
    day: Optional[str] = None
    rows: List[dict]  # raw rows the admin chose to import


@router.post("/orders/import", tags=["Orders"])
def orders_import(req: ImportRequest):
    d = _day(req.day)
    with connect() as conn:
        checked = validate_rows(req.rows, d, conn)  # never trust the client
        good = [r["data"] for r in checked if not r["errors"]]
        inserted = insert_orders(conn, d, good)
    return {"day": d, "imported": inserted, "skipped": len(checked) - inserted}


@router.get("/orders", tags=["Orders"])
def list_orders(day: Optional[str] = None):
    with connect() as conn:
        return rows(conn, "SELECT o.*, d.name AS driver_name FROM orders o "
                          "LEFT JOIN drivers d ON d.id = o.driver_id "
                          "WHERE delivery_date = ? ORDER BY o.id", (_day(day),))


@router.delete("/orders", tags=["Orders"])
def clear_day(day: Optional[str] = None):
    """Remove a day's orders that have not been delivered/failed yet."""
    d = _day(day)
    with connect() as conn:
        n = conn.execute("DELETE FROM orders WHERE delivery_date = ? AND status IN ('pending','assigned')",
                         (d,)).rowcount
        conn.execute("DELETE FROM routes WHERE delivery_date = ?", (d,))
    return {"deleted": n}


@router.get("/drivers", tags=["Drivers"])
def list_drivers():
    with connect() as conn:
        return rows(conn, "SELECT * FROM drivers ORDER BY id")


# ============================================================================
# ASSIGNMENT + ROUTING
# ============================================================================

def _assign_pending(conn, d: str) -> None:
    """
    Rule-based assignment, in plain words:

      1. Only drivers whose zones include the order's governorate.
      2. Skip drivers who reached max_orders.
      3. Among the rest, pick the lowest score:
             orders already assigned  +  0.5 × km to the driver's
             current group of stops (or depot)
         → loads stay balanced and each driver's stops stay together.
    """
    drivers = rows(conn, "SELECT * FROM drivers")
    for drv in drivers:
        drv["zones"] = [z.strip() for z in drv["zones"].split(",")]
        mine = rows(conn, "SELECT lat, lng FROM orders WHERE delivery_date = ? AND driver_id = ?",
                    (d, drv["id"]))
        drv["count"] = len(mine)
        drv["sum_lat"] = sum(o["lat"] for o in mine)
        drv["sum_lng"] = sum(o["lng"] for o in mine)

    pending = rows(conn, "SELECT id, governorate, lat, lng FROM orders "
                         "WHERE delivery_date = ? AND status = 'pending' ORDER BY governorate, lat", (d,))
    for o in pending:
        best, best_score = None, None
        for drv in drivers:
            if o["governorate"] not in drv["zones"] or drv["count"] >= drv["max_orders"]:
                continue
            if drv["count"]:
                c_lat, c_lng = drv["sum_lat"] / drv["count"], drv["sum_lng"] / drv["count"]
            else:
                c_lat, c_lng = drv["depot_lat"], drv["depot_lng"]
            score = drv["count"] + 0.5 * _km(o["lat"], o["lng"], c_lat, c_lng)
            if best_score is None or score < best_score:
                best, best_score = drv, score
        if best:
            conn.execute("UPDATE orders SET driver_id = ?, status = 'assigned' WHERE id = ?",
                         (best["id"], o["id"]))
            best["count"] += 1
            best["sum_lat"] += o["lat"]
            best["sum_lng"] += o["lng"]


def _route_driver(conn, drv: dict, d: str) -> None:
    """Order one driver's open stops with the existing OR-Tools solver."""
    stops = rows(conn, "SELECT id, lat, lng, slot, customer_name FROM orders "
                       "WHERE delivery_date = ? AND driver_id = ? AND status = 'assigned' ORDER BY id",
                 (d, drv["id"]))
    conn.execute("UPDATE orders SET stop_number = NULL, eta = NULL "
                 "WHERE delivery_date = ? AND driver_id = ? AND status = 'assigned'", (d, drv["id"]))
    conn.execute("DELETE FROM routes WHERE driver_id = ? AND delivery_date = ?", (drv["id"], d))
    if not stops:
        return

    coords = [[drv["depot_lng"], drv["depot_lat"]]] + [[s["lng"], s["lat"]] for s in stops]
    matrix, source = time_matrix_for_coordinates(coords)
    solution = solve_vrptw({
        "time_matrix": matrix,
        "time_windows": [DEPOT_WINDOW] + [SLOT_WINDOWS[s["slot"] or 0] for s in stops],
        "slots": [0] + [s["slot"] or 0 for s in stops],
        "num_vehicles": 1,
        "depot": 0,
        "service_time": SERVICE_MINUTES,
        "addresses": ["depot"] + [s["customer_name"] for s in stops],
        "drop_penalty": 100_000,   # skip a stop rather than fail the route
        "time_limit_seconds": 1 if len(stops) <= 8 else 2,
    }) or []

    for st in solution:
        conn.execute("UPDATE orders SET stop_number = ?, eta = ? WHERE id = ?",
                     (st["stop_number"], st["arrival_time"], stops[st["node"] - 1]["id"]))

    ordered = [coords[0]] + [coords[st["node"]] for st in solution]
    if len(ordered) > 1:
        geometry, meters, seconds, route_source = road_route_for_coordinates(ordered)
        conn.execute(
            "INSERT INTO routes (driver_id, delivery_date, geometry, distance_km, driving_minutes, source) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (drv["id"], d, json.dumps(geometry), round(meters / 1000, 1), round(seconds / 60),
             "ors" if source == route_source == "ors" else "estimate"),
        )


def _route_all(conn, d: str, driver_ids=None) -> None:
    for drv in rows(conn, "SELECT * FROM drivers"):
        if driver_ids is None or drv["id"] in driver_ids:
            _route_driver(conn, drv, d)


class DayRequest(BaseModel):
    day: Optional[str] = None


@router.post("/dispatch/assign", tags=["Dispatch"])
def dispatch_assign(req: DayRequest):
    """Assign pending orders, then (re)build every driver's route."""
    d = _day(req.day)
    with connect() as conn:
        _assign_pending(conn, d)
        _route_all(conn, d)
    return dispatch_view(d)


class ReassignRequest(BaseModel):
    driver_id: Optional[int] = None  # None → back to unassigned


@router.post("/orders/{order_id}/reassign", tags=["Dispatch"])
def reassign(order_id: int, req: ReassignRequest):
    with connect() as conn:
        o = conn.execute("SELECT * FROM orders WHERE id = ?", (order_id,)).fetchone()
        if not o:
            raise HTTPException(404, "Order not found")
        if o["status"] not in ("pending", "assigned"):
            raise HTTPException(400, "This order is already finished")
        conn.execute("UPDATE orders SET driver_id = ?, status = ?, stop_number = NULL, eta = NULL WHERE id = ?",
                     (req.driver_id, "assigned" if req.driver_id else "pending", order_id))
        _route_all(conn, o["delivery_date"], {o["driver_id"], req.driver_id})
    return dispatch_view(o["delivery_date"])


_ORDER_FIELDS = """
    o.*,
    (SELECT COUNT(*) FROM orders h WHERE h.phone = o.phone AND h.id != o.id
        AND h.status IN ('delivered','failed')) AS customer_orders,
    (SELECT COUNT(*) FROM orders h WHERE h.phone = o.phone AND h.id != o.id
        AND h.status = 'failed') AS customer_failed,
    (SELECT reason FROM attempts a WHERE a.order_id = o.id ORDER BY a.id DESC LIMIT 1) AS fail_reason,
    (SELECT cash_collected FROM attempts a WHERE a.order_id = o.id ORDER BY a.id DESC LIMIT 1) AS cash_collected,
    (SELECT photo_path FROM attempts a WHERE a.order_id = o.id ORDER BY a.id DESC LIMIT 1) AS photo_path
"""


def _driver_payload(conn, drv, d):
    orders = rows(conn, f"SELECT {_ORDER_FIELDS} FROM orders o WHERE delivery_date = ? AND driver_id = ? "
                        "ORDER BY stop_number IS NULL, stop_number, id", (d, drv["id"]))
    for o in orders:
        o["slot_label"] = SLOT_LABELS.get(o["slot"] or 0)
    route = conn.execute("SELECT * FROM routes WHERE driver_id = ? AND delivery_date = ?",
                         (drv["id"], d)).fetchone()
    count = lambda s: sum(o["status"] == s for o in orders)
    return {
        **drv,
        "orders": orders,
        "route": {
            "geometry": json.loads(route["geometry"]) if route else [],
            "distance_km": route["distance_km"] if route else 0,
            "driving_minutes": route["driving_minutes"] if route else 0,
            "source": route["source"] if route else None,
        },
        "stats": {
            "total": len(orders),
            "assigned": count("assigned"),
            "delivered": count("delivered"),
            "failed": count("failed"),
            "unrouted": sum(o["status"] == "assigned" and o["stop_number"] is None for o in orders),
            "cash_expected": round(sum(o["cod_amount"] for o in orders if o["status"] != "failed"), 1),
            "cash_collected": round(sum(o["cash_collected"] or 0 for o in orders if o["status"] == "delivered"), 1),
        },
    }


@router.get("/dispatch", tags=["Dispatch"])
def dispatch_view(day: Optional[str] = None):
    d = _day(day)
    with connect() as conn:
        drivers = rows(conn, "SELECT * FROM drivers ORDER BY id")
        covered = {z.strip() for drv in drivers for z in drv["zones"].split(",")}
        unassigned = rows(conn, f"SELECT {_ORDER_FIELDS} FROM orders o "
                                "WHERE delivery_date = ? AND status = 'pending' ORDER BY governorate", (d,))
        for o in unassigned:
            o["reason"] = ("All drivers for this zone are full" if o["governorate"] in covered
                           else f"No driver covers {o['governorate']}")
        return {
            "day": d,
            "drivers": [_driver_payload(conn, drv, d) for drv in drivers],
            "unassigned": unassigned,
        }


@router.get("/drivers/{driver_id}/day", tags=["Driver app"])
def driver_day(driver_id: int, day: Optional[str] = None):
    d = _day(day)
    with connect() as conn:
        drv = conn.execute("SELECT * FROM drivers WHERE id = ?", (driver_id,)).fetchone()
        if not drv:
            raise HTTPException(404, "Driver not found")
        return {"day": d, **_driver_payload(conn, dict(drv), d)}


# ============================================================================
# DRIVER ACTIONS
# ============================================================================

def _open_order(conn, order_id):
    o = conn.execute("SELECT * FROM orders WHERE id = ?", (order_id,)).fetchone()
    if not o:
        raise HTTPException(404, "Order not found")
    if o["status"] != "assigned":
        raise HTTPException(400, f"Order is {o['status']}, not out for delivery")
    return o


@router.post("/orders/{order_id}/deliver", tags=["Driver app"])
async def deliver(
    order_id: int,
    cash_collected: float = Form(...),
    lat: Optional[float] = Form(None),
    lng: Optional[float] = Form(None),
    photo: Optional[UploadFile] = File(None),
):
    photo_name = None
    if photo is not None and photo.filename:
        ext = os.path.splitext(photo.filename)[1].lower()
        if ext not in (".jpg", ".jpeg", ".png", ".webp", ".heic"):
            ext = ".jpg"
        photo_name = f"order{order_id}_{int(time.time())}{ext}"
        with open(os.path.join(UPLOAD_DIR, photo_name), "wb") as f:
            f.write(await photo.read())
    with connect() as conn:
        o = _open_order(conn, order_id)
        conn.execute("INSERT INTO attempts (order_id, driver_id, result, cash_collected, photo_path, lat, lng) "
                     "VALUES (?, ?, 'delivered', ?, ?, ?, ?)",
                     (order_id, o["driver_id"], cash_collected, photo_name, lat, lng))
        conn.execute("UPDATE orders SET status = 'delivered' WHERE id = ?", (order_id,))
    return {"ok": True}


class FailRequest(BaseModel):
    reason: str
    note: Optional[str] = None
    lat: Optional[float] = None
    lng: Optional[float] = None


@router.post("/orders/{order_id}/fail", tags=["Driver app"])
def fail(order_id: int, req: FailRequest):
    with connect() as conn:
        o = _open_order(conn, order_id)
        conn.execute("INSERT INTO attempts (order_id, driver_id, result, reason, note, lat, lng) "
                     "VALUES (?, ?, 'failed', ?, ?, ?, ?)",
                     (order_id, o["driver_id"], req.reason, req.note, req.lat, req.lng))
        conn.execute("UPDATE orders SET status = 'failed' WHERE id = ?", (order_id,))
    return {"ok": True}


@router.post("/orders/{order_id}/undo", tags=["Driver app"])
def undo(order_id: int):
    """Driver tapped the wrong button: put the stop back on the route."""
    with connect() as conn:
        o = conn.execute("SELECT * FROM orders WHERE id = ?", (order_id,)).fetchone()
        if not o or o["status"] not in ("delivered", "failed"):
            raise HTTPException(400, "Nothing to undo")
        conn.execute("DELETE FROM attempts WHERE id = (SELECT MAX(id) FROM attempts WHERE order_id = ?)",
                     (order_id,))
        conn.execute("UPDATE orders SET status = 'assigned' WHERE id = ?", (order_id,))
    return {"ok": True}


@router.post("/orders/{order_id}/retry-tomorrow", tags=["Dispatch"])
def retry_tomorrow(order_id: int):
    """A failed order becomes a new pending order for the next day."""
    with connect() as conn:
        o = conn.execute("SELECT * FROM orders WHERE id = ?", (order_id,)).fetchone()
        if not o or o["status"] != "failed":
            raise HTTPException(400, "Only failed orders can be retried")
        nxt = (date.fromisoformat(o["delivery_date"]) + timedelta(days=1)).isoformat()
        data = dict(o)
        data["notes"] = ("Retry. " + (data["notes"] or "")).strip()
        insert_orders(conn, nxt, [data])
    return {"ok": True, "day": nxt}


# ============================================================================
# ANALYTICS
# ============================================================================

@router.get("/analytics", tags=["Analytics"])
def analytics(days: int = 30):
    since = (date.today() - timedelta(days=days)).isoformat()
    with connect() as conn:
        base = ("FROM attempts a JOIN orders o ON o.id = a.order_id "
                "LEFT JOIN drivers d ON d.id = a.driver_id WHERE o.delivery_date >= ?")
        q = lambda select, rest="": rows(conn, f"SELECT {select} {base} {rest}", (since,))
        rate = ("SUM(a.result='delivered') AS delivered, SUM(a.result='failed') AS failed, "
                "ROUND(100.0 * SUM(a.result='delivered') / COUNT(*), 1) AS success_rate")
        totals = q(f"{rate}, COUNT(*) AS attempts, "
                   "ROUND(SUM(CASE WHEN a.result='delivered' THEN o.cod_amount ELSE 0 END), 1) AS cash_expected, "
                   "ROUND(SUM(a.cash_collected), 1) AS cash_collected")[0]
        return {
            "days": days,
            "totals": totals,
            "by_day": q(f"o.delivery_date AS day, {rate}", "GROUP BY o.delivery_date ORDER BY day"),
            "by_driver": q(f"d.name AS driver, {rate}, ROUND(SUM(a.cash_collected), 1) AS cash",
                           "GROUP BY d.id ORDER BY success_rate DESC"),
            "by_governorate": q(f"o.governorate, {rate}", "GROUP BY o.governorate ORDER BY success_rate"),
            "reasons": q("a.reason, COUNT(*) AS count",
                         "AND a.result = 'failed' GROUP BY a.reason ORDER BY count DESC"),
            "risky_customers": q("o.phone, MAX(o.customer_name) AS name, COUNT(*) AS orders, "
                                 "SUM(a.result='failed') AS failed",
                                 "GROUP BY o.phone HAVING failed >= 2 ORDER BY failed DESC, orders LIMIT 8"),
        }
