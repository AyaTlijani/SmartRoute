"""
dispatch.py — The daily delivery workflow.

    Excel upload → validate → import → assign to drivers → route each
    driver with OR-Tools → driver marks delivered / failed → retry

Who can call what:
    admin   everything in this file
    driver  /me/day, and deliver / fail / undo / photo on their own orders
"""

import json
import math
import os
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field

import sample_data
from auth import CurrentUser, current_user, require_admin, require_driver
from db import connect, rows
from distance import road_route_for_coordinates, time_matrix_for_coordinates
from orders_import import insert_orders, read_excel, validate_rows
from route_eval import nearest_neighbour, simulate
from vrptw_solver import _minutes_to_time_str as clock
from vrptw_solver import solve_vrptw

router = APIRouter()

UPLOAD_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)

# Working day and slots, in minutes after 9:00 AM (same as the original planner).
DAY_END = 540                       # 6:00 PM, driver back at the depot
SLOT_WINDOWS = {0: (0, 480), 1: (0, 180), 2: (240, 480)}
SLOT_LABELS = {0: "Any time", 1: "Morning", 2: "Afternoon"}
SERVICE_MINUTES = 10

MAX_EXCEL_BYTES = 5 * 1024 * 1024
MAX_EXCEL_ROWS = 2000
MAX_PHOTO_BYTES = 8 * 1024 * 1024
XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

FAIL_REASONS = ["No answer", "Not at home", "Customer refused", "Address not found", "Other"]


def _day(value: Optional[str]) -> str:
    if not value:
        return date.today().isoformat()
    try:
        return date.fromisoformat(value).isoformat()
    except ValueError:
        raise HTTPException(400, f"Invalid date '{value}', use YYYY-MM-DD")


def _km(lat1, lng1, lat2, lng2):
    x = math.radians(lng2 - lng1) * math.cos(math.radians((lat1 + lat2) / 2))
    y = math.radians(lat2 - lat1)
    return 6371 * math.hypot(x, y)


def _zones(driver) -> List[str]:
    return [z.strip() for z in driver["zones"].split(",") if z.strip()]


# ============================================================================
# DEMO DATA + EXCEL FILES (admin)
# ============================================================================

@router.post("/admin/demo/reset", tags=["Demo"])
def demo_reset(_: CurrentUser = Depends(require_admin)):
    """Delete everything and reload demo drivers, accounts and history."""
    with connect() as conn:
        return sample_data.seed_demo(conn)


@router.get("/excel/template", tags=["Excel"])
def excel_template(_: CurrentUser = Depends(require_admin)):
    return Response(sample_data.template_xlsx(), media_type=XLSX,
                    headers={"Content-Disposition": 'attachment; filename="smartroute_template.xlsx"'})


@router.get("/excel/sample", tags=["Excel"])
def excel_sample(day: Optional[str] = None, _: CurrentUser = Depends(require_admin)):
    d = date.fromisoformat(_day(day))
    return Response(sample_data.sample_orders_xlsx(d), media_type=XLSX,
                    headers={"Content-Disposition": f'attachment; filename="orders_{d.isoformat()}.xlsx"'})


# ============================================================================
# IMPORT (admin)
# ============================================================================

@router.post("/orders/validate", tags=["Orders"])
async def orders_validate(
    file: UploadFile = File(...),
    day: Optional[str] = Form(None),
    _: CurrentUser = Depends(require_admin),
):
    d = _day(day)
    if not (file.filename or "").lower().endswith(".xlsx"):
        raise HTTPException(400, "Upload an Excel .xlsx file.")
    content = await file.read(MAX_EXCEL_BYTES + 1)
    if len(content) > MAX_EXCEL_BYTES:
        raise HTTPException(400, "File is larger than 5 MB.")
    if not content.startswith(b"PK"):  # .xlsx files are zip archives
        raise HTTPException(400, "This is not a valid .xlsx file.")
    try:
        raw = read_excel(content)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    except Exception:
        raise HTTPException(400, "Could not read this file. Upload an .xlsx file.")
    if len(raw) > MAX_EXCEL_ROWS:
        raise HTTPException(400, f"Too many rows ({len(raw)}). The limit is {MAX_EXCEL_ROWS} per file.")
    if not raw:
        raise HTTPException(400, "The file has a header row but no orders.")
    with connect() as conn:
        return _validation_response(validate_rows(raw, d, conn), d)


class RowsRequest(BaseModel):
    day: Optional[str] = None
    rows: List[dict] = Field(..., max_length=MAX_EXCEL_ROWS)


@router.post("/orders/revalidate", tags=["Orders"])
def orders_revalidate(req: RowsRequest, _: CurrentUser = Depends(require_admin)):
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


@router.post("/orders/import", tags=["Orders"])
def orders_import(req: RowsRequest, _: CurrentUser = Depends(require_admin)):
    d = _day(req.day)
    with connect() as conn:
        checked = validate_rows(req.rows, d, conn)  # never trust the client
        good = [r["data"] for r in checked if not r["errors"]]
        inserted = insert_orders(conn, d, good)
    return {"day": d, "imported": inserted, "rejected": len(checked) - inserted}


@router.get("/orders", tags=["Orders"])
def list_orders(day: Optional[str] = None, _: CurrentUser = Depends(require_admin)):
    with connect() as conn:
        return rows(conn, f"SELECT {_ORDER_FIELDS}, d.name AS driver_name FROM orders o "
                          "LEFT JOIN drivers d ON d.id = o.driver_id "
                          "WHERE o.delivery_date = ? ORDER BY o.id", (_day(day),))


@router.delete("/orders", tags=["Orders"])
def clear_day(day: Optional[str] = None, _: CurrentUser = Depends(require_admin)):
    """Remove a day's orders that are not finished yet. Finished ones stay."""
    d = _day(day)
    with connect() as conn:
        n = conn.execute(
            "DELETE FROM orders WHERE delivery_date = ? AND status IN ('pending','assigned') "
            "AND id NOT IN (SELECT order_id FROM attempts)", (d,)).rowcount
        conn.execute("DELETE FROM routes WHERE delivery_date = ?", (d,))
        _route_all(conn, d)
    return {"deleted": n}


# ============================================================================
# ASSIGNMENT
# ============================================================================

def _day_counts(conn, d):
    return {r["driver_id"]: r["n"] for r in conn.execute(
        "SELECT driver_id, COUNT(*) n FROM orders WHERE delivery_date = ? AND driver_id IS NOT NULL "
        "GROUP BY driver_id", (d,))}


def _eligibility(driver, governorate, count) -> Optional[str]:
    """None if the driver can take an order in this governorate, else why not."""
    if not driver["active"]:
        return f"{driver['name']} is inactive"
    if governorate not in _zones(driver):
        return f"{driver['name']} does not cover {governorate}"
    if count >= driver["max_orders"]:
        return f"{driver['name']} is full ({driver['max_orders']} orders)"
    return None


def _assign_pending(conn, d: str) -> None:
    """
    Rule-based assignment:

      1. Eligible = active, covers the order's governorate, under max_orders.
      2. Among eligible drivers, lowest score wins:
             orders already assigned that day
           + 0.5 × km from the order to the driver's current stops
             (their average position, or the depot when they have none)
         so loads stay balanced and each driver's stops stay together.
    """
    drivers = rows(conn, "SELECT * FROM drivers")
    counts = _day_counts(conn, d)
    for drv in drivers:
        mine = rows(conn, "SELECT lat, lng FROM orders WHERE delivery_date = ? AND driver_id = ?", (d, drv["id"]))
        drv["count"] = counts.get(drv["id"], 0)
        drv["sum_lat"] = sum(o["lat"] for o in mine)
        drv["sum_lng"] = sum(o["lng"] for o in mine)

    pending = rows(conn, "SELECT id, governorate, lat, lng FROM orders "
                         "WHERE delivery_date = ? AND status = 'pending' ORDER BY governorate, lat", (d,))
    for o in pending:
        best, best_score = None, None
        for drv in drivers:
            if _eligibility(drv, o["governorate"], drv["count"]):
                continue
            if drv["count"]:
                c_lat, c_lng = drv["sum_lat"] / drv["count"], drv["sum_lng"] / drv["count"]
            else:
                c_lat, c_lng = drv["depot_lat"], drv["depot_lng"]
            score = drv["count"] + 0.5 * _km(o["lat"], o["lng"], c_lat, c_lng)
            if best_score is None or score < best_score:
                best, best_score = drv, score
        if best:
            conn.execute("UPDATE orders SET driver_id = ?, status = 'assigned' WHERE id = ?", (best["id"], o["id"]))
            best["count"] += 1
            best["sum_lat"] += o["lat"]
            best["sum_lng"] += o["lng"]


def _unassigned_reason(conn, order, drivers, counts) -> str:
    covering = [d for d in drivers if order["governorate"] in _zones(d)]
    if not covering:
        return f"No driver covers {order['governorate']}"
    if not any(d["active"] for d in covering):
        return f"All drivers covering {order['governorate']} are inactive"
    return f"All drivers covering {order['governorate']} are full"


# ============================================================================
# ROUTING (one driver at a time, with the existing OR-Tools solver)
# ============================================================================

def _why_unscheduled(j, matrix, window, slot) -> str:
    start, end = window
    direct = matrix[0][j]
    if direct > end:
        return (f"Too far to reach in its {SLOT_LABELS[slot].lower()} window: "
                f"{direct} min from the depot, window closes at {clock(end)}.")
    if direct + SERVICE_MINUTES + matrix[j][0] > DAY_END:
        return "Can't reach it and return to the depot within the working day (9:00 AM–6:00 PM)."
    return (f"The route is full in its {SLOT_LABELS[slot].lower()} window "
            f"({clock(start)}–{clock(end)}): other stops use all the time.")


def _route_driver(conn, drv: dict, d: str) -> None:
    """
    Recompute one driver's route for one day.

    Only open stops (status 'assigned') are routed. Delivered and failed
    orders keep their stop number and history; they are never touched here.
    """
    stops = rows(conn, "SELECT id, lat, lng, slot, customer_name FROM orders "
                       "WHERE delivery_date = ? AND driver_id = ? AND status = 'assigned' ORDER BY id",
                 (d, drv["id"]))
    conn.execute("UPDATE orders SET stop_number = NULL, eta = NULL, unscheduled_reason = NULL "
                 "WHERE delivery_date = ? AND driver_id = ? AND status = 'assigned'", (d, drv["id"]))
    conn.execute("DELETE FROM routes WHERE driver_id = ? AND delivery_date = ?", (drv["id"], d))
    if not stops:
        return

    # Finished stops keep their numbers; new numbering continues after them.
    done = conn.execute("SELECT COALESCE(MAX(stop_number), 0) FROM orders WHERE delivery_date = ? "
                        "AND driver_id = ? AND status IN ('delivered','failed')", (d, drv["id"])).fetchone()[0]

    coords = [[drv["depot_lng"], drv["depot_lat"]]] + [[s["lng"], s["lat"]] for s in stops]
    slots = [0] + [s["slot"] or 0 for s in stops]
    windows = [(0, DAY_END)] + [SLOT_WINDOWS[s] for s in slots[1:]]
    matrix, source = time_matrix_for_coordinates(coords)

    solution = solve_vrptw({
        "time_matrix": matrix,
        "time_windows": windows,
        "slots": slots,
        "num_vehicles": 1,
        "depot": 0,
        "service_time": SERVICE_MINUTES,
        "addresses": ["depot"] + [s["customer_name"] for s in stops],
        "drop_penalty": 100_000,          # skip a stop rather than fail the route
        "time_limit_seconds": 1 if len(stops) <= 8 else 2,
    }) or []

    visited = [st["node"] for st in solution]
    for st in solution:
        conn.execute("UPDATE orders SET stop_number = ?, eta = ? WHERE id = ?",
                     (done + st["stop_number"], st["arrival_time"], stops[st["node"] - 1]["id"]))
    for j in range(1, len(stops) + 1):
        if j not in visited:
            conn.execute("UPDATE orders SET unscheduled_reason = ? WHERE id = ?",
                         (_why_unscheduled(j, matrix, windows[j], slots[j]), stops[j - 1]["id"]))
    if not visited:
        return

    # Score the optimized route and a nearest-neighbour baseline on the same matrix.
    optimized = simulate(visited, matrix, windows, SERVICE_MINUTES)
    baseline = simulate(nearest_neighbour(matrix, range(1, len(stops) + 1)), matrix, windows, SERVICE_MINUTES)

    # Route policy: start and end at the depot.
    path = [coords[0]] + [coords[j] for j in visited] + [coords[0]]
    geometry, meters, _, route_source = road_route_for_coordinates(path)
    conn.execute(
        "INSERT INTO routes (driver_id, delivery_date, geometry, distance_km, driving_minutes, source, "
        "end_time, baseline_minutes, baseline_late) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (drv["id"], d, json.dumps(geometry), round(meters / 1000, 1), optimized["travel_minutes"],
         "ors" if source == route_source == "ors" else "estimate",
         clock(optimized["end_minutes"]), baseline["travel_minutes"], baseline["late_stops"]),
    )


def _route_all(conn, d: str, driver_ids=None) -> None:
    for drv in rows(conn, "SELECT * FROM drivers"):
        if driver_ids is None or drv["id"] in driver_ids:
            _route_driver(conn, drv, d)


class DayRequest(BaseModel):
    day: Optional[str] = None


@router.post("/dispatch/assign", tags=["Dispatch"])
def dispatch_assign(req: DayRequest, _: CurrentUser = Depends(require_admin)):
    """Assign pending orders, then recompute every driver's route."""
    d = _day(req.day)
    with connect() as conn:
        _assign_pending(conn, d)
        _route_all(conn, d)
    return _dispatch_view(d)


@router.post("/dispatch/reoptimize", tags=["Dispatch"])
def dispatch_reoptimize(req: DayRequest, _: CurrentUser = Depends(require_admin)):
    d = _day(req.day)
    with connect() as conn:
        _route_all(conn, d)
    return _dispatch_view(d)


class ReassignRequest(BaseModel):
    driver_id: Optional[int] = None  # None → back to unassigned


@router.post("/orders/{order_id}/reassign", tags=["Dispatch"])
def reassign(order_id: int, req: ReassignRequest, _: CurrentUser = Depends(require_admin)):
    with connect() as conn:
        o = conn.execute("SELECT * FROM orders WHERE id = ?", (order_id,)).fetchone()
        if not o:
            raise HTTPException(404, "Order not found")
        if o["status"] not in ("pending", "assigned"):
            raise HTTPException(400, "This order is already finished.")
        if req.driver_id is not None and req.driver_id != o["driver_id"]:
            drv = conn.execute("SELECT * FROM drivers WHERE id = ?", (req.driver_id,)).fetchone()
            if not drv:
                raise HTTPException(404, "Driver not found")
            why = _eligibility(drv, o["governorate"], _day_counts(conn, o["delivery_date"]).get(drv["id"], 0))
            if why:
                raise HTTPException(400, f"Can't assign: {why}.")
        conn.execute("UPDATE orders SET driver_id = ?, status = ?, stop_number = NULL, eta = NULL, "
                     "unscheduled_reason = NULL WHERE id = ?",
                     (req.driver_id, "assigned" if req.driver_id else "pending", order_id))
        _route_all(conn, o["delivery_date"], {o["driver_id"], req.driver_id})
    return _dispatch_view(o["delivery_date"])


# ============================================================================
# READ MODELS
# ============================================================================

# Latest non-voided attempt + customer history + retry link, for every order.
_ORDER_FIELDS = """
    o.*,
    (SELECT COUNT(*) FROM orders h WHERE h.phone = o.phone AND h.id != o.id
        AND h.status IN ('delivered','failed')) AS customer_orders,
    (SELECT COUNT(*) FROM orders h WHERE h.phone = o.phone AND h.id != o.id
        AND h.status = 'failed') AS customer_failed,
    (SELECT a.reason FROM attempts a WHERE a.order_id = o.id AND a.voided_at IS NULL
        ORDER BY a.id DESC LIMIT 1) AS fail_reason,
    (SELECT a.note FROM attempts a WHERE a.order_id = o.id AND a.voided_at IS NULL
        ORDER BY a.id DESC LIMIT 1) AS attempt_note,
    (SELECT a.cash_collected FROM attempts a WHERE a.order_id = o.id AND a.voided_at IS NULL
        ORDER BY a.id DESC LIMIT 1) AS cash_collected,
    (SELECT a.photo_path IS NOT NULL FROM attempts a WHERE a.order_id = o.id AND a.voided_at IS NULL
        ORDER BY a.id DESC LIMIT 1) AS has_photo,
    (SELECT a.created_at FROM attempts a WHERE a.order_id = o.id AND a.voided_at IS NULL
        ORDER BY a.id DESC LIMIT 1) AS finished_at,
    (SELECT r.id FROM orders r WHERE r.retry_of = o.id) AS retry_order_id,
    (SELECT r.delivery_date FROM orders r WHERE r.retry_of = o.id) AS retry_date
"""


def _driver_payload(conn, drv, d):
    orders = rows(conn, f"SELECT {_ORDER_FIELDS} FROM orders o WHERE delivery_date = ? AND driver_id = ? "
                        "ORDER BY stop_number IS NULL, stop_number, id", (d, drv["id"]))
    for o in orders:
        o["slot_label"] = SLOT_LABELS.get(o["slot"] or 0)
        o["has_photo"] = bool(o["has_photo"])
    route = conn.execute("SELECT * FROM routes WHERE driver_id = ? AND delivery_date = ?", (drv["id"], d)).fetchone()
    count = lambda s: sum(o["status"] == s for o in orders)
    return {
        **{k: drv[k] for k in ("id", "name", "phone", "vehicle", "zones", "depot_name",
                               "depot_lat", "depot_lng", "max_orders", "active")},
        "orders": orders,
        "route": dict(route, geometry=json.loads(route["geometry"])) if route else None,
        "stats": {
            "total": len(orders),
            "assigned": count("assigned"),
            "delivered": count("delivered"),
            "failed": count("failed"),
            "unscheduled": sum(o["status"] == "assigned" and o["stop_number"] is None for o in orders),
            "cash_expected": round(sum(o["cod_amount"] for o in orders if o["status"] != "failed"), 1),
            "cash_collected": round(sum(o["cash_collected"] or 0 for o in orders if o["status"] == "delivered"), 1),
        },
    }


def _dispatch_view(d: str):
    with connect() as conn:
        drivers = rows(conn, "SELECT * FROM drivers ORDER BY active DESC, id")
        counts = _day_counts(conn, d)
        unassigned = rows(conn, f"SELECT {_ORDER_FIELDS} FROM orders o "
                                "WHERE delivery_date = ? AND status = 'pending' ORDER BY governorate", (d,))
        for o in unassigned:
            o["slot_label"] = SLOT_LABELS.get(o["slot"] or 0)
            o["reason"] = _unassigned_reason(conn, o, drivers, counts)
        payload = [_driver_payload(conn, drv, d) for drv in drivers]
        return {
            "day": d,
            # Hide inactive drivers unless they still hold orders that day.
            "drivers": [p for p in payload if p["active"] or p["orders"]],
            "unassigned": unassigned,
        }


@router.get("/dispatch", tags=["Dispatch"])
def dispatch_view(day: Optional[str] = None, _: CurrentUser = Depends(require_admin)):
    return _dispatch_view(_day(day))


@router.get("/me/day", tags=["Driver app"])
def my_day(day: Optional[str] = None, user: CurrentUser = Depends(require_driver)):
    d = _day(day)
    with connect() as conn:
        drv = conn.execute("SELECT * FROM drivers WHERE id = ?", (user.driver_id,)).fetchone()
        return {"day": d, "fail_reasons": FAIL_REASONS, **_driver_payload(conn, dict(drv), d)}


# ============================================================================
# DRIVER ACTIONS
# ============================================================================

def _own_order(conn, order_id: int, user: CurrentUser):
    o = conn.execute("SELECT * FROM orders WHERE id = ?", (order_id,)).fetchone()
    if not o:
        raise HTTPException(404, "Order not found")
    if user.role != "admin" and o["driver_id"] != user.driver_id:
        raise HTTPException(403, "This order is not assigned to you.")
    return o


def _check_open(o):
    # Second tap / double submit lands here: the order is already finished.
    if o["status"] != "assigned":
        raise HTTPException(409, f"This order is already {o['status']}.")


def _sniff_image(head: bytes) -> Optional[str]:
    if head.startswith(b"\xff\xd8\xff"):
        return ".jpg"
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return ".png"
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return ".webp"
    return None


@router.post("/orders/{order_id}/deliver", tags=["Driver app"])
async def deliver(
    order_id: int,
    cash_collected: float = Form(..., ge=0, le=10000),
    lat: Optional[float] = Form(None),
    lng: Optional[float] = Form(None),
    photo: Optional[UploadFile] = File(None),
    user: CurrentUser = Depends(current_user),
):
    data, ext = None, None
    if photo is not None and photo.filename:
        data = await photo.read(MAX_PHOTO_BYTES + 1)
        if len(data) > MAX_PHOTO_BYTES:
            raise HTTPException(400, "Photo is larger than 8 MB.")
        ext = _sniff_image(data[:16])
        if not ext:
            raise HTTPException(400, "Photo must be a JPEG, PNG or WebP image.")
    with connect() as conn:
        o = _own_order(conn, order_id, user)
        _check_open(o)
        name = None
        if data:
            name = f"{uuid.uuid4().hex}{ext}"  # never trust the uploaded file name
            with open(os.path.join(UPLOAD_DIR, name), "wb") as f:
                f.write(data)
        conn.execute("INSERT INTO attempts (order_id, driver_id, result, cash_collected, photo_path, lat, lng) "
                     "VALUES (?, ?, 'delivered', ?, ?, ?, ?)",
                     (order_id, o["driver_id"], cash_collected, name, lat, lng))
        conn.execute("UPDATE orders SET status = 'delivered' WHERE id = ?", (order_id,))
    return {"ok": True}


class FailRequest(BaseModel):
    reason: str
    note: Optional[str] = Field(None, max_length=500)
    lat: Optional[float] = None
    lng: Optional[float] = None


@router.post("/orders/{order_id}/fail", tags=["Driver app"])
def fail(order_id: int, req: FailRequest, user: CurrentUser = Depends(current_user)):
    if req.reason not in FAIL_REASONS:
        raise HTTPException(400, f"Reason must be one of: {', '.join(FAIL_REASONS)}")
    with connect() as conn:
        o = _own_order(conn, order_id, user)
        _check_open(o)
        conn.execute("INSERT INTO attempts (order_id, driver_id, result, reason, note, lat, lng) "
                     "VALUES (?, ?, 'failed', ?, ?, ?, ?)",
                     (order_id, o["driver_id"], req.reason, req.note, req.lat, req.lng))
        conn.execute("UPDATE orders SET status = 'failed' WHERE id = ?", (order_id,))
    return {"ok": True}


@router.post("/orders/{order_id}/undo", tags=["Driver app"])
def undo(order_id: int, user: CurrentUser = Depends(current_user)):
    """
    Wrong button: the stop goes back on the route. The attempt row is kept
    and marked voided, so the history still shows what happened.
    """
    with connect() as conn:
        o = _own_order(conn, order_id, user)
        if o["status"] not in ("delivered", "failed"):
            raise HTTPException(409, "Nothing to undo.")
        if conn.execute("SELECT 1 FROM orders WHERE retry_of = ?", (order_id,)).fetchone():
            raise HTTPException(409, "A retry was already scheduled for this order; undo is locked.")
        conn.execute("UPDATE attempts SET voided_at = ? WHERE id = (SELECT MAX(id) FROM attempts "
                     "WHERE order_id = ? AND voided_at IS NULL)",
                     (datetime.now(timezone.utc).isoformat(timespec="seconds"), order_id))
        conn.execute("UPDATE orders SET status = 'assigned' WHERE id = ?", (order_id,))
    return {"ok": True}


@router.get("/orders/{order_id}/photo", tags=["Driver app"])
def order_photo(order_id: int, user: CurrentUser = Depends(current_user)):
    with connect() as conn:
        _own_order(conn, order_id, user)
        a = conn.execute("SELECT photo_path FROM attempts WHERE order_id = ? AND voided_at IS NULL "
                         "AND photo_path IS NOT NULL ORDER BY id DESC LIMIT 1", (order_id,)).fetchone()
    if not a:
        raise HTTPException(404, "No photo for this order.")
    path = os.path.join(UPLOAD_DIR, os.path.basename(a["photo_path"]))
    if not os.path.isfile(path):
        raise HTTPException(404, "Photo file is missing.")
    return FileResponse(path)


@router.post("/orders/{order_id}/retry", tags=["Dispatch"])
def retry(order_id: int, _: CurrentUser = Depends(require_admin)):
    """
    Schedule a failed order again on the next day, as a new pending order
    linked by retry_of. Calling it twice returns the same retry order.
    """
    with connect() as conn:
        o = conn.execute("SELECT * FROM orders WHERE id = ?", (order_id,)).fetchone()
        if not o or o["status"] != "failed":
            raise HTTPException(400, "Only failed orders can be retried.")
        existing = conn.execute("SELECT id, delivery_date FROM orders WHERE retry_of = ?", (order_id,)).fetchone()
        if existing:
            return {"retry_order_id": existing["id"], "day": existing["delivery_date"], "created": False}
        nxt = (date.fromisoformat(o["delivery_date"]) + timedelta(days=1)).isoformat()
        cur = conn.execute(
            "INSERT INTO orders (delivery_date, customer_name, phone, governorate, city, address, landmark, "
            "product, cod_amount, slot, notes, lat, lng, location_precision, retry_of) "
            "SELECT ?, customer_name, phone, governorate, city, address, landmark, product, cod_amount, "
            "slot, notes, lat, lng, location_precision, id FROM orders WHERE id = ?",
            (nxt, order_id))
        return {"retry_order_id": cur.lastrowid, "day": nxt, "created": True}
