"""
evaluate.py — Does OR-Tools actually beat simple routing? A reproducible check.

    python evaluate.py            (from backend/, takes about a minute)

For each of N generated delivery days, one driver leaves the Charguia hub
with 12–20 Grand Tunis stops (same generator as the app's sample files).
Every method is scored by route_eval.simulate on the SAME travel-time
matrix, service time and time windows:

    import order       stops in the order they appear in the Excel file
    sorted by latitude a naive "south to north" sweep
    nearest neighbour  always go to the closest unvisited stop
    OR-Tools           the app's solver (cheapest insertion + guided local search)

Reported per method: average driving minutes, stops reached after their
window closed ("late"), and stops left out (OR-Tools only; it may skip a
stop rather than be late). Travel times are the app's offline estimate, not
real road data, so the absolute minutes are indicative only.
"""

import random
import statistics
import sys

from distance import _estimated_matrix
from route_eval import nearest_neighbour, simulate
from sample_data import HUB, _make_order
from vrptw_solver import solve_vrptw

SLOT = {"morning": (0, 180), "afternoon": (240, 480), "": (0, 480)}
SERVICE = 10
GRAND_TUNIS = ("Tunis", "Ariana", "Ben Arous", "Manouba")


def instance(seed, with_windows=True):
    rng = random.Random(seed)
    stops = []
    n = rng.randint(12, 20)
    while len(stops) < n:
        o = _make_order(rng)
        if o["governorate"] in GRAND_TUNIS:
            stops.append(o)
    coords = [[HUB[2], HUB[1]]] + [[s["lng"], s["lat"]] for s in stops]
    windows = [(0, 540)] + [SLOT[s["slot"] if with_windows else ""] for s in stops]
    return coords, windows, _estimated_matrix(coords)


def run(days=30, time_limit=2, with_windows=True):
    results = {k: [] for k in ("import order", "sorted by latitude", "nearest neighbour", "OR-Tools")}
    for seed in range(days):
        coords, windows, m = instance(seed, with_windows)
        nodes = list(range(1, len(coords)))
        sol = solve_vrptw({
            "time_matrix": m, "time_windows": windows, "num_vehicles": 1, "depot": 0,
            "service_time": SERVICE, "addresses": [""] * len(coords),
            "drop_penalty": 100_000, "time_limit_seconds": time_limit,
        }) or []
        visited = [s["node"] for s in sol]
        orders = {
            "import order": nodes,
            "sorted by latitude": sorted(nodes, key=lambda j: coords[j][1]),
            "nearest neighbour": nearest_neighbour(m, nodes),
            "OR-Tools": visited,
        }
        for name, order in orders.items():
            r = simulate(order, m, windows, SERVICE)
            r["skipped"] = len(nodes) - len(order)
            results[name].append(r)
        print(f"day {seed + 1:>2}/{days}: {len(nodes)} stops", file=sys.stderr)
    return results


def report(results):
    nn = statistics.mean(r["travel_minutes"] for r in results["nearest neighbour"])
    lines = ["| Method | Avg driving (min) | vs nearest neighbour | Late stops (total) | Skipped stops (total) |",
             "|---|---|---|---|---|"]
    for name, rs in results.items():
        avg = statistics.mean(r["travel_minutes"] for r in rs)
        lines.append(f"| {name} | {avg:.0f} | {100 * (avg - nn) / nn:+.1f}% | "
                     f"{sum(r['late_stops'] for r in rs)} | {sum(r['skipped'] for r in rs)} |")
    return "\n".join(lines)


def run_fleet(days=10):
    """
    Scenario 3: a whole day for the 5 demo drivers. The zone rule + per-driver
    OR-Tools is compared with the fleet optimizer (one OR-Tools model choosing
    drivers and sequences together). Same orders, matrix and constraints.
    """
    import os
    import tempfile
    from datetime import date

    import db
    import planning
    from orders_import import insert_orders, read_excel, validate_rows
    from sample_data import sample_orders_xlsx, seed_demo

    planning.now_minutes = lambda: 0
    db.DB_PATH = os.path.join(tempfile.mkdtemp(), "eval.db")
    db.init_db()
    with db.connect() as conn:
        seed_demo(conn, days=0)
    results = []
    for k in range(days):
        day = date.fromordinal(date.today().toordinal() + 30 + k)  # future days: nobody has started
        d = day.isoformat()
        with db.connect() as conn:
            checked = validate_rows(read_excel(sample_orders_xlsx(day)), d, conn)
            insert_orders(conn, d, [r["data"] for r in checked if not r["errors"]])
            row = {}
            for mode in ("zones", "optimizer"):
                s = planning.plan_day(conn, d, mode)
                late = sum(1 for _ in conn.execute(
                    "SELECT 1 FROM orders WHERE delivery_date = ? AND status = 'assigned' AND stop_number IS NULL", (d,)))
                row[mode] = (s["total_driving_minutes"], s["assigned"] - late, s["unassigned"] + late)
            results.append(row)
        print(f"fleet day {k + 1:>2}/{days}", file=sys.stderr)
    lines = ["| Assignment | Total driving, all drivers (min/day) | Orders on a route | Not served |",
             "|---|---|---|---|"]
    base = statistics.mean(r["zones"][0] for r in results)
    for mode, label in (("zones", "Zone rule + OR-Tools per driver"), ("optimizer", "Fleet optimizer (OR-Tools)")):
        avg = statistics.mean(r[mode][0] for r in results)
        lines.append(f"| {label} | {avg:.0f} ({100 * (avg - base) / base:+.1f}%) | "
                     f"{statistics.mean(r[mode][1] for r in results):.1f} | {statistics.mean(r[mode][2] for r in results):.1f} |")
    return "\n".join(lines)


if __name__ == "__main__":
    print("Scenario 1: customers' morning/afternoon slots enforced\n")
    print(report(run(with_windows=True)))
    print("\nScenario 2: no slots (any time 9:00-17:00), pure distance problem\n")
    print(report(run(with_windows=False)))
    print("\nScenario 3: whole fleet, 5 drivers, ~55 orders/day over 10 days\n")
    print(run_fleet())
