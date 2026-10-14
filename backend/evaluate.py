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


if __name__ == "__main__":
    print("Scenario 1: customers' morning/afternoon slots enforced\n")
    print(report(run(with_windows=True)))
    print("\nScenario 2: no slots (any time 9:00-17:00), pure distance problem\n")
    print(report(run(with_windows=False)))
