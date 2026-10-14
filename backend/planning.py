"""
planning.py — Who delivers what, and in which order.

Two assignment modes, then the same per-driver routing:

  zones      transparent rule: an eligible driver (active, covers the
             governorate, has room) with the lowest
                 orders already assigned + 0.5 × km to their other stops
             gets the order. Easy to explain and to override by hand.

  optimizer  one OR-Tools model for the whole fleet: it decides which
             driver serves which order AND in which order, minimizing total
             driving time, with zones (allowed vehicles), capacity
             (max_orders) and the customers' time windows as constraints.

"Plan routes" re-plans every driver who has not started their day yet.
Drivers already on the road keep their stops: a planner must not take a
package out of a moving van. Their remaining stops are re-sequenced from
where they are now (last finished stop or phone position) at the current
time, so arrival times stay realistic.
"""

import json
import math
from datetime import date, datetime
from typing import Dict, List, Optional

from db import rows
from distance import road_route_for_coordinates, time_matrix_for_coordinates
from route_eval import nearest_neighbour, simulate
from vrptw_solver import DAY_END, _minutes_to_time_str as clock, solve

SLOT_WINDOWS = {0: (0, 480), 1: (0, 180), 2: (240, 480)}
SLOT_LABELS = {0: "Any time", 1: "Morning", 2: "Afternoon"}
SERVICE_MINUTES = 10
DROP_PENALTY = 100_000


def now_minutes() -> int:
    """Minutes since 9:00 AM today (negative before 9). Patched in tests."""
    n = datetime.now()
    return n.hour * 60 + n.minute - 9 * 60


def zones_of(driver) -> List[str]:
    return [z.strip() for z in driver["zones"].split(",") if z.strip()]


def _km(lat1, lng1, lat2, lng2):
    x = math.radians(lng2 - lng1) * math.cos(math.radians((lat1 + lat2) / 2))
    return 6371 * math.hypot(x, math.radians(lat2 - lat1))


def day_counts(conn, d) -> Dict[int, int]:
    return {r["driver_id"]: r["n"] for r in conn.execute(
        "SELECT driver_id, COUNT(*) n FROM orders WHERE delivery_date = ? AND driver_id IS NOT NULL "
        "GROUP BY driver_id", (d,))}


def eligibility(driver, governorate, count) -> Optional[str]:
    """None if the driver can take an order in this governorate, else why not."""
    if not driver["active"]:
        return f"{driver['name']} is inactive"
    if governorate not in zones_of(driver):
        return f"{driver['name']} does not cover {governorate}"
    if count >= driver["max_orders"]:
        return f"{driver['name']} is full ({driver['max_orders']} orders)"
    return None


def started(conn, driver_id, d) -> bool:
    r = conn.execute("SELECT started_at FROM driver_days WHERE driver_id = ? AND day = ?", (driver_id, d)).fetchone()
    return bool(r and r["started_at"])


# ============================================================================
# ROUTING ONE DRIVER
# ============================================================================

def _start_point(conn, drv, d):
    """Where and when this driver's remaining route starts."""
    depot = [drv["depot_lng"], drv["depot_lat"]]
    if d != date.today().isoformat() or not started(conn, drv["id"], d):
        return depot, 0, "depot"
    t = max(0, now_minutes())
    day = conn.execute("SELECT last_lat, last_lng FROM driver_days WHERE driver_id = ? AND day = ?",
                       (drv["id"], d)).fetchone()
    if day and day["last_lat"] is not None:
        return [day["last_lng"], day["last_lat"]], t, "your position"
    last = conn.execute(
        "SELECT o.lat, o.lng FROM attempts a JOIN orders o ON o.id = a.order_id WHERE a.driver_id = ? "
        "AND o.delivery_date = ? AND a.voided_at IS NULL ORDER BY a.id DESC LIMIT 1", (drv["id"], d)).fetchone()
    if last:
        return [last["lng"], last["lat"]], t, "your last stop"
    return depot, t, "the depot"


def _why_unscheduled(j, start, t0, matrix, window, slot) -> str:
    begin, end = window
    earliest = max(t0 + matrix[start][j], begin)
    if earliest > end:
        if t0 > end:
            return f"Its {SLOT_LABELS[slot].lower()} window closed at {clock(end)}."
        return (f"Too far to reach in its {SLOT_LABELS[slot].lower()} window: earliest arrival "
                f"{clock(earliest)}, window closes at {clock(end)}.")
    if earliest + SERVICE_MINUTES + matrix[j][0] > DAY_END:
        return "Can't reach it and get back to the depot by 6:00 PM."
    return (f"The route is full in its {SLOT_LABELS[slot].lower()} window "
            f"({clock(begin)}–{clock(end)}): other stops use all the time.")


def route_driver(conn, drv: dict, d: str) -> None:
    """
    Sequence one driver's open stops (status 'assigned') with OR-Tools.
    Delivered and failed orders are never touched; numbering continues
    after them.
    """
    stops = rows(conn, "SELECT id, lat, lng, slot FROM orders WHERE delivery_date = ? AND driver_id = ? "
                       "AND status = 'assigned' ORDER BY id", (d, drv["id"]))
    conn.execute("UPDATE orders SET stop_number = NULL, eta = NULL, unscheduled_reason = NULL "
                 "WHERE delivery_date = ? AND driver_id = ? AND status = 'assigned'", (d, drv["id"]))
    conn.execute("DELETE FROM routes WHERE driver_id = ? AND delivery_date = ?", (drv["id"], d))
    if not stops:
        return
    done = conn.execute("SELECT COALESCE(MAX(stop_number), 0) FROM orders WHERE delivery_date = ? AND driver_id = ? "
                        "AND status IN ('delivered','failed')", (d, drv["id"])).fetchone()[0]

    # Nodes: 0 = depot (end), 1..k = stops, k+1 = current position when re-planning.
    start_xy, t0, _ = _start_point(conn, drv, d)
    depot_xy = [drv["depot_lng"], drv["depot_lat"]]
    coords = [depot_xy] + [[s["lng"], s["lat"]] for s in stops]
    start = 0
    if start_xy != depot_xy:
        coords.append(start_xy)
        start = len(coords) - 1
    slots = [0] + [s["slot"] or 0 for s in stops] + ([0] if start else [])
    windows = [(0, DAY_END)] + [SLOT_WINDOWS[x] for x in slots[1:len(stops) + 1]] + ([(0, DAY_END)] if start else [])
    service = [0] + [SERVICE_MINUTES] * len(stops) + ([0] if start else [])
    matrix, source = time_matrix_for_coordinates(coords)

    t0 = min(t0, DAY_END)
    result = solve(matrix, windows, service, starts=[start], ends=[0], start_times=[t0],
                   drop_penalty=DROP_PENALTY, time_limit=1 if len(stops) <= 8 else 2)
    visited = [s for s in (result["routes"][0] if result else [])]
    for k, s in enumerate(visited, start=1):
        conn.execute("UPDATE orders SET stop_number = ?, eta = ? WHERE id = ?",
                     (done + k, clock(s["arrival"]), stops[s["node"] - 1]["id"]))
    seen = {s["node"] for s in visited}
    for j in range(1, len(stops) + 1):
        if j not in seen:
            conn.execute("UPDATE orders SET unscheduled_reason = ? WHERE id = ?",
                         (_why_unscheduled(j, start, t0, matrix, windows[j], slots[j]), stops[j - 1]["id"]))
    if not visited:
        return

    order = [s["node"] for s in visited]
    optimized = simulate(order, matrix, windows, SERVICE_MINUTES, start=start, start_time=t0)
    baseline = simulate(nearest_neighbour(matrix, range(1, len(stops) + 1), start=start), matrix, windows,
                        SERVICE_MINUTES, start=start, start_time=t0)
    path = [coords[start]] + [coords[j] for j in order] + [depot_xy]
    geometry, meters, _, route_source = road_route_for_coordinates(path)
    conn.execute(
        "INSERT INTO routes (driver_id, delivery_date, geometry, distance_km, driving_minutes, source, "
        "end_time, baseline_minutes, baseline_late) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (drv["id"], d, json.dumps(geometry), round(meters / 1000, 1), optimized["travel_minutes"],
         "ors" if source == route_source == "ors" else "estimate", clock(optimized["end_minutes"]),
         baseline["travel_minutes"], baseline["late_stops"]))


def route_all(conn, d: str, driver_ids=None) -> None:
    for drv in rows(conn, "SELECT * FROM drivers"):
        if driver_ids is None or drv["id"] in driver_ids:
            route_driver(conn, drv, d)


# ============================================================================
# ASSIGNMENT
# ============================================================================

def assign_zones(conn, d: str, only=None) -> int:
    """Rule-based assignment of the day's pending orders. Returns how many were assigned."""
    drivers = [drv for drv in rows(conn, "SELECT * FROM drivers") if only is None or drv["id"] in only]
    counts = day_counts(conn, d)
    for drv in drivers:
        mine = rows(conn, "SELECT lat, lng FROM orders WHERE delivery_date = ? AND driver_id = ?", (d, drv["id"]))
        drv["count"] = counts.get(drv["id"], 0)
        drv["sum_lat"] = sum(o["lat"] for o in mine)
        drv["sum_lng"] = sum(o["lng"] for o in mine)

    assigned = 0
    for o in rows(conn, "SELECT id, governorate, lat, lng FROM orders WHERE delivery_date = ? AND status = 'pending' "
                        "ORDER BY governorate, lat", (d,)):
        best, best_score = None, None
        for drv in drivers:
            if eligibility(drv, o["governorate"], drv["count"]):
                continue
            c_lat, c_lng = ((drv["sum_lat"] / drv["count"], drv["sum_lng"] / drv["count"]) if drv["count"]
                            else (drv["depot_lat"], drv["depot_lng"]))
            score = drv["count"] + 0.5 * _km(o["lat"], o["lng"], c_lat, c_lng)
            if best_score is None or score < best_score:
                best, best_score = drv, score
        if best:
            conn.execute("UPDATE orders SET driver_id = ?, status = 'assigned' WHERE id = ?", (best["id"], o["id"]))
            best["count"] += 1
            best["sum_lat"] += o["lat"]
            best["sum_lng"] += o["lng"]
            assigned += 1
    return assigned


def assign_optimizer(conn, d: str, drivers: List[dict], time_limit: int = 5) -> int:
    """
    Fleet-wide OR-Tools assignment for the given (not started) drivers.
    Orders no eligible driver can fit stay pending, with the reason.
    """
    orders = rows(conn, "SELECT id, governorate, lat, lng, slot FROM orders WHERE delivery_date = ? "
                        "AND status = 'pending' ORDER BY id", (d,))
    finished = {r["driver_id"]: r["n"] for r in conn.execute(
        "SELECT driver_id, COUNT(*) n FROM orders WHERE delivery_date = ? AND status IN ('delivered','failed') "
        "GROUP BY driver_id", (d,))}
    allowed = {}
    for i, o in enumerate(orders):
        vehicles = [v for v, drv in enumerate(drivers) if o["governorate"] in zones_of(drv)]
        if vehicles:
            allowed[len(drivers) + i] = vehicles
    served = [o for i, o in enumerate(orders) if len(drivers) + i in allowed]
    if not drivers or not served:
        return 0

    # Nodes: one depot node per driver, then the orders that at least one driver may take.
    idx = {o["id"]: len(drivers) + k for k, o in enumerate(served)}
    allowed = {idx[o["id"]]: allowed[len(drivers) + orders.index(o)] for o in served}
    coords = [[drv["depot_lng"], drv["depot_lat"]] for drv in drivers] + [[o["lng"], o["lat"]] for o in served]
    windows = [(0, DAY_END)] * len(drivers) + [SLOT_WINDOWS[o["slot"] or 0] for o in served]
    service = [0] * len(drivers) + [SERVICE_MINUTES] * len(served)
    matrix, _ = time_matrix_for_coordinates(coords)
    result = solve(matrix, windows, service,
                   starts=list(range(len(drivers))), ends=list(range(len(drivers))), start_times=[0] * len(drivers),
                   capacities=[max(0, drv["max_orders"] - finished.get(drv["id"], 0)) for drv in drivers],
                   allowed=allowed, drop_penalty=DROP_PENALTY, time_limit=time_limit)
    if result is None:
        return 0
    by_node = {idx[o["id"]]: o for o in served}
    assigned = 0
    for v, route in enumerate(result["routes"]):
        for s in route:
            conn.execute("UPDATE orders SET driver_id = ?, status = 'assigned', unscheduled_reason = NULL WHERE id = ?",
                         (drivers[v]["id"], by_node[s["node"]]["id"]))
            assigned += 1
    for node in result["dropped"]:
        conn.execute("UPDATE orders SET unscheduled_reason = ? WHERE id = ?",
                     ("The optimizer could not fit it in any eligible driver's day (time window or capacity).",
                      by_node[node]["id"]))
    return assigned


def plan_day(conn, d: str, mode: str = "zones") -> dict:
    """
    Re-plan the day: drivers who haven't started get their assignments
    rebuilt (zones rule or fleet optimizer); drivers already on the road keep
    theirs and are re-sequenced from where they are.
    """
    drivers = rows(conn, "SELECT * FROM drivers ORDER BY id")
    waiting = [drv for drv in drivers if drv["active"] and not started(conn, drv["id"], d)]
    waiting_ids = [drv["id"] for drv in waiting]

    # Open orders of drivers who haven't left yet (or are inactive) go back in the pool.
    if waiting_ids or any(not drv["active"] for drv in drivers):
        conn.execute(
            f"UPDATE orders SET driver_id = NULL, status = 'pending', stop_number = NULL, eta = NULL "
            f"WHERE delivery_date = ? AND status = 'assigned' AND driver_id IN "
            f"(SELECT id FROM drivers WHERE active = 0 OR id IN ({','.join('?' * len(waiting_ids)) or 'NULL'}))",
            (d, *waiting_ids))
    conn.execute("UPDATE orders SET unscheduled_reason = NULL WHERE delivery_date = ? AND status = 'pending'", (d,))

    if mode == "optimizer":
        assign_optimizer(conn, d, waiting)
        # Leftovers may still go to drivers already on the road, by the zone rule.
        assign_zones(conn, d, only={drv["id"] for drv in drivers if drv["id"] not in waiting_ids})
    else:
        assign_zones(conn, d)
    route_all(conn, d)

    count = lambda status: conn.execute("SELECT COUNT(*) FROM orders WHERE delivery_date = ? AND status = ?",
                                        (d, status)).fetchone()[0]
    total = conn.execute("SELECT COALESCE(SUM(driving_minutes), 0) FROM routes WHERE delivery_date = ?", (d,)).fetchone()[0]
    return {"mode": mode, "assigned": count("assigned"), "unassigned": count("pending"), "total_driving_minutes": total}
