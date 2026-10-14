"""
analytics.py — Today's overview and historical analytics (admin only).

Definitions used everywhere (shown in the UI too):

  attempt            one delivered/failed action by a driver (undone ones excluded)
  attempt success    delivered attempts / all attempts
  order              an order as confirmed by the customer; a retry is a new
                     row linked by retry_of, so one order can have several attempts
  first-try success  original orders delivered on their first attempt /
                     original orders that had at least one attempt
  eventual delivery  original orders delivered on any attempt (including
                     retries) / original orders that had at least one attempt
  cash gap           COD due on delivered orders − cash the driver recorded
"""

from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException

from auth import CurrentUser, require_admin
from db import connect, rows
from dispatch import _day

router = APIRouter(tags=["Analytics"])


def _n(count, one, many=None):
    return f"{count} {one if count == 1 else (many or one + 's')}"

_ATT = ("FROM attempts a JOIN orders o ON o.id = a.order_id LEFT JOIN drivers d ON d.id = a.driver_id "
        "WHERE a.voided_at IS NULL AND o.delivery_date BETWEEN ? AND ?")
_RATE = ("SUM(a.result='delivered') AS delivered, SUM(a.result='failed') AS failed, COUNT(*) AS attempts, "
         "ROUND(100.0 * SUM(a.result='delivered') / COUNT(*), 1) AS success_rate")


@router.get("/analytics")
def analytics(days: int = 30, _: CurrentUser = Depends(require_admin)):
    if days not in (7, 30, 90):
        raise HTTPException(400, "days must be 7, 30 or 90")
    end = date.today().isoformat()
    start = (date.today() - timedelta(days=days - 1)).isoformat()
    p = (start, end)
    with connect() as conn:
        q = lambda select, rest="": rows(conn, f"SELECT {select} {_ATT} {rest}", p)
        totals = q(f"{_RATE}, "
                   "ROUND(SUM(CASE WHEN a.result='delivered' THEN o.cod_amount ELSE 0 END), 1) AS cash_expected, "
                   "ROUND(SUM(CASE WHEN a.result='delivered' THEN a.cash_collected ELSE 0 END), 1) AS cash_collected, "
                   "SUM(a.result='delivered' AND a.cash_collected < o.cod_amount) AS short_deliveries")[0]

        # Order-level outcomes: follow each original order through its retries.
        chains = rows(conn, """
            WITH RECURSIVE chain(root, id) AS (
                SELECT id, id FROM orders WHERE retry_of IS NULL AND delivery_date BETWEEN ? AND ?
                UNION ALL
                SELECT c.root, o.id FROM orders o JOIN chain c ON o.retry_of = c.id
            )
            SELECT c.root,
                   MAX(o.status = 'delivered') AS eventually_delivered,
                   MAX(CASE WHEN o.id = c.root AND o.status = 'delivered' THEN 1 ELSE 0 END) AS first_try,
                   MAX(o.status IN ('delivered','failed')) AS attempted,
                   COUNT(*) - 1 AS retries
            FROM chain c JOIN orders o ON o.id = c.id GROUP BY c.root""", p)
        attempted = [c for c in chains if c["attempted"]]
        n = len(attempted) or 1
        orders_summary = {
            "orders": len(chains),
            "attempted": len(attempted),
            "first_try_rate": round(100 * sum(c["first_try"] for c in attempted) / n, 1),
            "eventual_rate": round(100 * sum(c["eventually_delivered"] for c in attempted) / n, 1),
            "retried": sum(c["retries"] > 0 for c in chains),
        }

        return {
            "days": days,
            "start": start,
            "end": end,
            "totals": totals,
            "orders": orders_summary,
            "by_day": q(f"o.delivery_date AS day, {_RATE}", "GROUP BY o.delivery_date ORDER BY day"),
            "by_driver": q(f"d.name AS driver, {_RATE}, "
                           "COUNT(DISTINCT o.delivery_date) AS days_worked, "
                           "ROUND(1.0 * COUNT(*) / COUNT(DISTINCT o.delivery_date), 1) AS stops_per_day, "
                           "ROUND(SUM(CASE WHEN a.result='delivered' THEN o.cod_amount - a.cash_collected "
                           "ELSE 0 END), 1) AS cash_gap",
                           "GROUP BY d.id ORDER BY success_rate DESC"),
            "by_governorate": q(f"o.governorate, {_RATE}", "GROUP BY o.governorate ORDER BY success_rate"),
            "reasons": q("a.reason, COUNT(*) AS count", "AND a.result = 'failed' GROUP BY a.reason ORDER BY count DESC"),
            "risky_customers": q("o.phone, MAX(o.customer_name) AS name, COUNT(*) AS attempts, "
                                 "SUM(a.result='failed') AS failed",
                                 "GROUP BY o.phone HAVING failed >= 2 ORDER BY failed DESC, attempts LIMIT 8"),
        }


@router.get("/overview")
def overview(day: str = None, _: CurrentUser = Depends(require_admin)):
    """What is happening today, and what needs attention."""
    d = _day(day)
    with connect() as conn:
        orders = rows(conn, """
            SELECT o.*, d.name AS driver_name,
              (SELECT a.cash_collected FROM attempts a WHERE a.order_id = o.id AND a.voided_at IS NULL
                 ORDER BY a.id DESC LIMIT 1) AS cash_collected,
              (SELECT COUNT(*) FROM orders h WHERE h.phone = o.phone AND h.id != o.id
                 AND h.status = 'failed') AS customer_failed,
              (SELECT 1 FROM orders r WHERE r.retry_of = o.id) AS has_retry
            FROM orders o LEFT JOIN drivers d ON d.id = o.driver_id WHERE o.delivery_date = ?""", (d,))
        drivers = rows(conn, "SELECT * FROM drivers WHERE active = 1 ORDER BY name")
        routes = {r["driver_id"]: r for r in rows(conn, "SELECT * FROM routes WHERE delivery_date = ?", (d,))}
        activity = rows(conn, """
            SELECT a.created_at, a.result, a.reason, a.cash_collected, o.customer_name, o.id AS order_id,
                   d.name AS driver
            FROM attempts a JOIN orders o ON o.id = a.order_id LEFT JOIN drivers d ON d.id = a.driver_id
            WHERE o.delivery_date = ? AND a.voided_at IS NULL ORDER BY a.id DESC LIMIT 8""", (d,))

    by = lambda s: [o for o in orders if o["status"] == s]
    pending, assigned, delivered, failed = by("pending"), by("assigned"), by("delivered"), by("failed")
    finished = len(delivered) + len(failed)
    unscheduled = [o for o in assigned if o["stop_number"] is None]
    short = [o for o in delivered if (o["cash_collected"] or 0) < o["cod_amount"] - 0.01]
    approx = [o for o in pending + assigned if o["location_precision"] == "governorate"]
    risky = [o for o in pending + assigned if o["customer_failed"] >= 2]
    failed_open = [o for o in failed if not o["has_retry"]]

    attention = []
    if not orders:
        attention.append({"level": "info", "title": "No orders for this day yet",
                          "detail": "Import the confirmed-orders Excel file to start.", "to": "/admin/import"})
    if pending:
        attention.append({"level": "warning", "title": f"{_n(len(pending), 'unassigned order')}",
                          "detail": "Run assignment, or assign them by hand.", "to": "/admin/dispatch"})
    if unscheduled:
        attention.append({"level": "warning", "title": f"{_n(len(unscheduled), 'stop doesn\'t', 'stops don\'t')} fit a route",
                          "detail": "Their time window can't be met. Move them to another driver or day.",
                          "to": "/admin/dispatch"})
    if failed_open:
        attention.append({"level": "critical", "title": f"{_n(len(failed_open), 'failed delivery', 'failed deliveries')} to decide on",
                          "detail": "Schedule a retry or close them.", "to": "/admin/orders?status=failed"})
    if short:
        gap = sum(o["cod_amount"] - (o["cash_collected"] or 0) for o in short)
        attention.append({"level": "critical", "title": f"Cash gap of {gap:.1f} DT",
                          "detail": f"{_n(len(short), 'delivery', 'deliveries')} collected less than the amount due.",
                          "to": "/admin/orders?status=delivered"})
    if approx:
        attention.append({"level": "info", "title": f"{_n(len(approx), 'order')} with an approximate location",
                          "detail": "Only the governorate is known; the driver should call first.",
                          "to": "/admin/orders"})
    if risky:
        attention.append({"level": "info", "title": f"{_n(len(risky), 'order')} from customers who refused before",
                          "detail": "Consider calling to re-confirm before dispatch.", "to": "/admin/orders"})

    fleet = []
    for drv in drivers:
        mine = [o for o in orders if o["driver_id"] == drv["id"]]
        if not mine:
            continue
        r = routes.get(drv["id"])
        fleet.append({
            "id": drv["id"], "name": drv["name"], "total": len(mine), "max_orders": drv["max_orders"],
            "delivered": sum(o["status"] == "delivered" for o in mine),
            "failed": sum(o["status"] == "failed" for o in mine),
            "cash_collected": round(sum(o["cash_collected"] or 0 for o in mine if o["status"] == "delivered"), 1),
            "end_time": r["end_time"] if r else None,
        })

    return {
        "day": d,
        "counts": {"total": len(orders), "pending": len(pending), "assigned": len(assigned),
                   "delivered": len(delivered), "failed": len(failed), "unscheduled": len(unscheduled)},
        "completion_rate": round(100 * finished / len(orders), 1) if orders else 0,
        "success_rate": round(100 * len(delivered) / finished, 1) if finished else None,
        "cash": {
            "expected": round(sum(o["cod_amount"] for o in orders if o["status"] != "failed"), 1),
            "collected": round(sum(o["cash_collected"] or 0 for o in delivered), 1),
        },
        "active_drivers": len(drivers),
        "fleet": fleet,
        "attention": attention,
        "activity": activity,
    }
