"""
dispatch.py — Orders and the delivery day.

    Excel upload → validate → import → plan routes (planning.py)
    → driver marks delivered / failed → retry

Rules that apply everywhere:
    - Past days are read-only: no import, planning or reassignment.
    - Drivers act only on their own orders, only today, and only after
      starting their route (driver_day.py).

Who can call what:
    admin   everything here except /me/day
    driver  /me/day, and deliver / fail / undo / photo on their own orders
"""

import json
import os
import uuid
from datetime import date, datetime, timedelta
from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field

import clock
import planning
import sample_data
from auth import CurrentUser, current_user, require_admin, require_driver
from db import connect, rows
from orders_import import insert_orders, read_excel, validate_rows
from planning import SLOT_LABELS, day_counts, eligibility, route_all, zones_of

router = APIRouter()

UPLOAD_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)

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


def _editable(d: str) -> None:
    if d < date.today().isoformat():
        raise HTTPException(400, "Past days are read-only.")


def _now() -> str:
    return datetime.now().isoformat(sep=" ", timespec="seconds")


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

def _validation_response(results, d):
    return {
        "day": d,
        "rows": results,
        "summary": {k: sum(r["status"] == k for r in results) for k in ("ok", "warning", "error")}
        | {"total": len(results)},
    }


@router.post("/orders/validate", tags=["Orders"])
async def orders_validate(file: UploadFile = File(...), day: Optional[str] = Form(None),
                          _: CurrentUser = Depends(require_admin)):
    d = _day(day)
    _editable(d)
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


@router.post("/orders/import", tags=["Orders"])
def orders_import(req: RowsRequest, _: CurrentUser = Depends(require_admin)):
    d = _day(req.day)
    _editable(d)
    with connect() as conn:
        checked = validate_rows(req.rows, d, conn)  # never trust the client
        good = [r["data"] for r in checked if not r["errors"]]
        inserted = insert_orders(conn, d, good)
    return {"day": d, "imported": inserted, "rejected": len(checked) - inserted}


# ============================================================================
# READ MODELS
# ============================================================================

# Latest non-voided attempt + customer history + retry link, for every order.
_LAST = "FROM attempts a WHERE a.order_id = o.id AND a.voided_at IS NULL ORDER BY a.id DESC LIMIT 1"
_ORDER_FIELDS = f"""
    o.*,
    (SELECT COUNT(*) FROM orders h WHERE h.phone = o.phone AND h.id != o.id
        AND h.status IN ('delivered','failed')) AS customer_orders,
    (SELECT COUNT(*) FROM orders h WHERE h.phone = o.phone AND h.id != o.id
        AND h.status = 'failed') AS customer_failed,
    (SELECT a.reason {_LAST}) AS fail_reason,
    (SELECT a.note {_LAST}) AS attempt_note,
    (SELECT a.cash_collected {_LAST}) AS cash_collected,
    (SELECT a.photo_path IS NOT NULL {_LAST}) AS has_photo,
    (SELECT a.created_at {_LAST}) AS finished_at,
    (SELECT r.id FROM orders r WHERE r.retry_of = o.id) AS retry_order_id,
    (SELECT r.delivery_date FROM orders r WHERE r.retry_of = o.id) AS retry_date
"""


def _decorate(order):
    order["slot_label"] = SLOT_LABELS.get(order["slot"] or 0)
    order["has_photo"] = bool(order["has_photo"])
    order["leg"] = json.loads(order.pop("leg_geometry")) if order.get("leg_geometry") else None
    return order


def day_state(conn, driver_id, d):
    r = conn.execute("SELECT * FROM driver_days WHERE driver_id = ? AND day = ?", (driver_id, d)).fetchone()
    return dict(r) if r else None


def driver_payload(conn, drv, d):
    orders = [_decorate(o) for o in rows(
        conn, f"SELECT {_ORDER_FIELDS} FROM orders o WHERE delivery_date = ? AND driver_id = ? "
              "ORDER BY stop_number IS NULL, stop_number, id", (d, drv["id"]))]
    route = conn.execute("SELECT * FROM routes WHERE driver_id = ? AND delivery_date = ?", (drv["id"], d)).fetchone()
    count = lambda s: sum(o["status"] == s for o in orders)
    return {
        **{k: drv[k] for k in ("id", "name", "phone", "vehicle", "zones", "depot_name",
                               "depot_lat", "depot_lng", "max_orders", "active")},
        "orders": orders,
        "route": (dict(route, geometry=json.loads(route["geometry"]),
                       return_leg=json.loads(route["return_leg"]) if route["return_leg"] else None)
                  if route else None),
        "day_state": day_state(conn, drv["id"], d),
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


def _unassigned_reason(order, drivers, counts) -> str:
    if order["unscheduled_reason"]:
        return order["unscheduled_reason"]
    covering = [d for d in drivers if order["governorate"] in zones_of(d)]
    if not covering:
        return f"No driver covers {order['governorate']}."
    if not any(d["active"] for d in covering):
        return f"All drivers covering {order['governorate']} are inactive."
    if all(counts.get(d["id"], 0) >= d["max_orders"] for d in covering if d["active"]):
        return f"All drivers covering {order['governorate']} are full."
    return "Not planned yet. Click Plan routes."


def dispatch_view(d: str):
    with connect() as conn:
        drivers = rows(conn, "SELECT * FROM drivers ORDER BY active DESC, id")
        counts = day_counts(conn, d)
        unassigned = [_decorate(o) for o in rows(
            conn, f"SELECT {_ORDER_FIELDS} FROM orders o WHERE delivery_date = ? AND status = 'pending' "
                  "ORDER BY governorate", (d,))]
        for o in unassigned:
            o["reason"] = _unassigned_reason(o, drivers, counts)
        payload = [driver_payload(conn, drv, d) for drv in drivers]
        return {
            "day": d,
            "editable": d >= date.today().isoformat(),
            "drivers": [p for p in payload if p["active"] or p["orders"]],
            "unassigned": unassigned,
        }


@router.get("/dispatch", tags=["Dispatch"])
def get_dispatch(day: Optional[str] = None, _: CurrentUser = Depends(require_admin)):
    return dispatch_view(_day(day))


@router.get("/orders", tags=["Orders"])
def list_orders(day: Optional[str] = None, _: CurrentUser = Depends(require_admin)):
    with connect() as conn:
        return [_decorate(o) for o in rows(
            conn, f"SELECT {_ORDER_FIELDS}, d.name AS driver_name FROM orders o "
                  "LEFT JOIN drivers d ON d.id = o.driver_id WHERE o.delivery_date = ? ORDER BY o.id", (_day(day),))]


@router.get("/orders/{order_id}", tags=["Orders"])
def order_detail(order_id: int, _: CurrentUser = Depends(require_admin)):
    """One order with its full attempt history (undone attempts included)."""
    with connect() as conn:
        found = rows(conn, f"SELECT {_ORDER_FIELDS}, d.name AS driver_name FROM orders o "
                           "LEFT JOIN drivers d ON d.id = o.driver_id WHERE o.id = ?", (order_id,))
        if not found:
            raise HTTPException(404, "Order not found")
        o = _decorate(found[0])
        o["attempts"] = rows(conn, "SELECT a.*, d.name AS driver_name FROM attempts a "
                                   "LEFT JOIN drivers d ON d.id = a.driver_id WHERE a.order_id = ? ORDER BY a.id",
                             (order_id,))
        for a in o["attempts"]:
            a["has_photo"] = bool(a.pop("photo_path"))
        return o


@router.delete("/orders", tags=["Orders"])
def clear_day(day: Optional[str] = None, _: CurrentUser = Depends(require_admin)):
    """Remove a day's open orders that were never attempted. Finished ones stay."""
    d = _day(day)
    _editable(d)
    with connect() as conn:
        n = conn.execute(
            "DELETE FROM orders WHERE delivery_date = ? AND status IN ('pending','assigned') "
            "AND id NOT IN (SELECT order_id FROM attempts) AND id NOT IN "
            "(SELECT retry_of FROM orders WHERE retry_of IS NOT NULL)", (d,)).rowcount
        route_all(conn, d)
    return {"deleted": n}


# ============================================================================
# PLANNING (admin)
# ============================================================================

class PlanRequest(BaseModel):
    day: Optional[str] = None
    mode: Literal["zones", "optimizer"] = "zones"


@router.post("/dispatch/plan", tags=["Dispatch"])
def plan(req: PlanRequest, _: CurrentUser = Depends(require_admin)):
    """
    Assign orders (zone rule or fleet optimizer) and sequence every route.
    Drivers already on the road keep their stops.
    """
    d = _day(req.day)
    _editable(d)
    with connect() as conn:
        summary = planning.plan_day(conn, d, req.mode)
    return {**dispatch_view(d), "summary": summary}


class ReassignRequest(BaseModel):
    driver_id: Optional[int] = None  # None → back to unassigned


@router.post("/orders/{order_id}/reassign", tags=["Dispatch"])
def reassign(order_id: int, req: ReassignRequest, _: CurrentUser = Depends(require_admin)):
    with connect() as conn:
        o = conn.execute("SELECT * FROM orders WHERE id = ?", (order_id,)).fetchone()
        if not o:
            raise HTTPException(404, "Order not found")
        _editable(o["delivery_date"])
        if o["status"] not in ("pending", "assigned"):
            raise HTTPException(400, "This order is already finished.")
        if req.driver_id is not None and req.driver_id != o["driver_id"]:
            drv = conn.execute("SELECT * FROM drivers WHERE id = ?", (req.driver_id,)).fetchone()
            if not drv:
                raise HTTPException(404, "Driver not found")
            why = eligibility(drv, o["governorate"], day_counts(conn, o["delivery_date"]).get(drv["id"], 0))
            if why:
                raise HTTPException(400, f"Can't assign: {why}.")
            ds = day_state(conn, drv["id"], o["delivery_date"])
            if ds and ds["ended_at"]:
                raise HTTPException(400, f"Can't assign: {drv['name']} has already ended the day.")
        conn.execute("UPDATE orders SET driver_id = ?, status = ?, stop_number = NULL, eta = NULL, "
                     "unscheduled_reason = NULL WHERE id = ?",
                     (req.driver_id, "assigned" if req.driver_id else "pending", order_id))
        route_all(conn, o["delivery_date"], {o["driver_id"], req.driver_id})
    return dispatch_view(o["delivery_date"])


# ============================================================================
# DRIVER APP
# ============================================================================

@router.get("/me/day", tags=["Driver app"])
def my_day(user: CurrentUser = Depends(require_driver)):
    d = date.today().isoformat()
    with connect() as conn:
        drv = conn.execute("SELECT * FROM drivers WHERE id = ?", (user.driver_id,)).fetchone()
        return {"day": d, "fail_reasons": FAIL_REASONS, **driver_payload(conn, dict(drv), d)}


def _own_order(conn, order_id: int, user: CurrentUser):
    o = conn.execute("SELECT * FROM orders WHERE id = ?", (order_id,)).fetchone()
    if not o:
        raise HTTPException(404, "Order not found")
    if user.role != "admin" and o["driver_id"] != user.driver_id:
        raise HTTPException(403, "This order is not assigned to you.")
    return o


def _check_can_act(conn, o, user: CurrentUser):
    if o["status"] != "assigned":
        # A second tap / double submit lands here.
        raise HTTPException(409, f"This order is already {o['status']}.")
    if o["delivery_date"] != date.today().isoformat():
        raise HTTPException(400, "Deliveries can only be recorded on their delivery day.")
    if user.role == "driver":
        ds = day_state(conn, o["driver_id"], o["delivery_date"])
        if not ds or not ds["started_at"]:
            raise HTTPException(409, "Start your route first.")
        if ds["ended_at"]:
            raise HTTPException(409, "Your day is already closed.")


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
        _check_can_act(conn, o, user)
        name = None
        if data:
            name = f"{uuid.uuid4().hex}{ext}"  # never trust the uploaded file name
            with open(os.path.join(UPLOAD_DIR, name), "wb") as f:
                f.write(data)
        conn.execute("INSERT INTO attempts (order_id, driver_id, result, cash_collected, photo_path, lat, lng, created_at) "
                     "VALUES (?, ?, 'delivered', ?, ?, ?, ?, ?)",
                     (order_id, o["driver_id"], cash_collected, name, lat, lng, clock.attempt_time(conn, o)))
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
        _check_can_act(conn, o, user)
        conn.execute("INSERT INTO attempts (order_id, driver_id, result, reason, note, lat, lng, created_at) "
                     "VALUES (?, ?, 'failed', ?, ?, ?, ?, ?)",
                     (order_id, o["driver_id"], req.reason, req.note, req.lat, req.lng, clock.attempt_time(conn, o)))
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
        if o["delivery_date"] != date.today().isoformat():
            raise HTTPException(400, "Only today's deliveries can be undone.")
        ds = day_state(conn, o["driver_id"], o["delivery_date"])
        if ds and ds["ended_at"]:
            raise HTTPException(409, "The day is closed; undo is locked.")
        if conn.execute("SELECT 1 FROM orders WHERE retry_of = ?", (order_id,)).fetchone():
            raise HTTPException(409, "A retry was already scheduled for this order; undo is locked.")
        conn.execute("UPDATE attempts SET voided_at = ? WHERE id = (SELECT MAX(id) FROM attempts "
                     "WHERE order_id = ? AND voided_at IS NULL)", (_now(), order_id))
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
    Schedule a failed order again as a new pending order linked by retry_of,
    on the next day (or today, for an old failure). Calling it twice returns
    the same retry order.
    """
    with connect() as conn:
        o = conn.execute("SELECT * FROM orders WHERE id = ?", (order_id,)).fetchone()
        if not o or o["status"] != "failed":
            raise HTTPException(400, "Only failed orders can be retried.")
        existing = conn.execute("SELECT id, delivery_date FROM orders WHERE retry_of = ?", (order_id,)).fetchone()
        if existing:
            return {"retry_order_id": existing["id"], "day": existing["delivery_date"], "created": False}
        nxt = max(date.fromisoformat(o["delivery_date"]) + timedelta(days=1), date.today()).isoformat()
        cur = conn.execute(
            "INSERT INTO orders (delivery_date, customer_name, phone, governorate, city, address, landmark, "
            "product, cod_amount, slot, notes, lat, lng, location_precision, retry_of) "
            "SELECT ?, customer_name, phone, governorate, city, address, landmark, product, cod_amount, "
            "slot, notes, lat, lng, location_precision, id FROM orders WHERE id = ?", (nxt, order_id))
        return {"retry_order_id": cur.lastrowid, "day": nxt, "created": True}
