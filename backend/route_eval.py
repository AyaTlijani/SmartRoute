"""
route_eval.py — Measure a route, and build a simple baseline to compare with.

Used by dispatch (to show "OR-Tools vs nearest neighbour" per driver) and by
evaluate.py (the reproducible benchmark). Both routes are scored with the
same travel-time matrix, service time and time windows, so the comparison
is fair.

Indices: 0 is the depot, 1..n are stops. Times are minutes after 9:00 AM.
"""

from typing import Dict, List, Sequence, Tuple


def simulate(
    order: Sequence[int],
    matrix: List[List[int]],
    windows: List[Tuple[int, int]],
    service: int,
) -> Dict[str, int]:
    """
    Drive depot → order[0] → ... → order[-1] → depot.

    The driver waits if they arrive before a window opens. A stop reached
    after its window closes counts as "late" (a constraint violation).
    """
    t = 0
    travel = 0
    late = 0
    prev = 0
    for node in order:
        leg = matrix[prev][node]
        travel += leg
        t += leg
        start, end = windows[node]
        if t < start:
            t = start
        if t > end:
            late += 1
        t += service
        prev = node
    back = matrix[prev][0] if order else 0
    travel += back
    t += back
    return {"travel_minutes": travel, "end_minutes": t, "late_stops": late}


def nearest_neighbour(matrix: List[List[int]], nodes: Sequence[int]) -> List[int]:
    """Always drive to the closest stop not visited yet. No look-ahead."""
    left = list(nodes)
    order, current = [], 0
    while left:
        nxt = min(left, key=lambda j: (matrix[current][j], j))
        order.append(nxt)
        left.remove(nxt)
        current = nxt
    return order
