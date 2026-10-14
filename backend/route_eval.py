"""
route_eval.py — Score a route, and build a simple baseline to compare with.

Used by dispatch (each driver's "versus nearest-stop-first" figure) and by
evaluate.py (the benchmark). Every route is scored with the same travel-time
matrix, service time and time windows, so comparisons are fair.

Times are minutes after 9:00 AM. By default the route starts and ends at
node 0 (the depot) at time 0; a re-planned route can start elsewhere, later.
"""

from typing import Dict, List, Sequence, Tuple


def simulate(
    order: Sequence[int],
    matrix: List[List[int]],
    windows: List[Tuple[int, int]],
    service: int,
    start: int = 0,
    start_time: int = 0,
    end: int = 0,
) -> Dict[str, int]:
    """
    Drive start → order... → end. The driver waits if early; a stop reached
    after its window closes counts as late (a constraint violation).
    """
    t, travel, late, prev = start_time, 0, 0, start
    for node in order:
        leg = matrix[prev][node]
        travel += leg
        t = max(t + leg, windows[node][0])
        if t > windows[node][1]:
            late += 1
        t += service
        prev = node
    back = matrix[prev][end]
    return {"travel_minutes": travel + back, "end_minutes": t + back, "late_stops": late}


def nearest_neighbour(matrix: List[List[int]], nodes: Sequence[int], start: int = 0) -> List[int]:
    """Always drive to the closest stop not visited yet. No look-ahead."""
    left, order, current = list(nodes), [], start
    while left:
        nxt = min(left, key=lambda j: (matrix[current][j], j))
        order.append(nxt)
        left.remove(nxt)
        current = nxt
    return order
