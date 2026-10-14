"""
vrptw_solver.py — Vehicle Routing Problem with Time Windows, on Google OR-Tools.

Time is in minutes after 9:00 AM (0 = 9:00, 180 = 12:00, 540 = 18:00).

solve() is the general model used everywhere:

    vehicles     one per driver, each with its own start node, end node
                 and start time (a driver re-planning at 14:10 from their
                 last stop starts there, at 310)
    time         travel (matrix) + service time at each stop; a vehicle may
                 wait for a window to open; every stop has a window; every
                 vehicle must be back before day_end
    capacity     optional maximum number of stops per vehicle
    eligibility  optional list of vehicles allowed to serve each stop
                 (zones: a Sfax driver can't take a Tunis order)
    dropping     optional penalty: an impossible stop is skipped (and
                 reported) instead of making the whole problem infeasible
    objective    minimize total travel time (+ the drop penalties)

Search: PARALLEL_CHEAPEST_INSERTION builds a first feasible solution by
inserting each stop where it costs least; GUIDED_LOCAL_SEARCH then keeps
improving it (moving/swapping stops, penalizing features of local optima to
escape them) until the time limit. The result is a good solution, not a
proven optimum.
"""

from typing import Any, Dict, List, Optional, Sequence

from ortools.constraint_solver import pywrapcp, routing_enums_pb2

DAY_END = 540
SERVICE_TIME_DEFAULT = 10


def _minutes_to_time_str(minutes_from_9am: int) -> str:
    total = 9 * 60 + int(minutes_from_9am)
    h24, m = divmod(total, 60)
    h12 = h24 % 12 or 12
    return f"{h12}:{m:02d} {'AM' if h24 < 12 else 'PM'}"


def _format_time_window(window) -> str:
    return f"{_minutes_to_time_str(window[0])} – {_minutes_to_time_str(window[1])}"


def solve(
    matrix: List[List[int]],
    windows: Sequence[tuple],
    service: Sequence[int],
    starts: Sequence[int],
    ends: Sequence[int],
    start_times: Sequence[int],
    capacities: Optional[Sequence[int]] = None,
    allowed: Optional[Dict[int, List[int]]] = None,
    drop_penalty: Optional[int] = None,
    time_limit: int = 2,
    day_end: int = DAY_END,
) -> Optional[Dict[str, Any]]:
    """
    Returns {"routes": [[{"node", "arrival"}...] per vehicle], "dropped": [nodes],
    "end_times": [minutes per vehicle]} or None if no feasible solution exists.
    """
    n, nv = len(matrix), len(starts)
    terminals = set(starts) | set(ends)
    stops = [i for i in range(n) if i not in terminals]

    manager = pywrapcp.RoutingIndexManager(n, nv, list(starts), list(ends))
    routing = pywrapcp.RoutingModel(manager)

    def travel(i, j):
        return int(matrix[manager.IndexToNode(i)][manager.IndexToNode(j)])

    def travel_plus_service(i, j):
        a = manager.IndexToNode(i)
        return int(matrix[a][manager.IndexToNode(j)]) + int(service[a])

    routing.SetArcCostEvaluatorOfAllVehicles(routing.RegisterTransitCallback(travel))

    routing.AddDimension(routing.RegisterTransitCallback(travel_plus_service),
                         day_end, day_end, False, "Time")
    time = routing.GetDimensionOrDie("Time")

    for node in stops:
        time.CumulVar(manager.NodeToIndex(node)).SetRange(*windows[node])
    for v in range(nv):
        time.CumulVar(routing.Start(v)).SetRange(start_times[v], start_times[v])
        time.CumulVar(routing.End(v)).SetRange(start_times[v], day_end)
        routing.AddVariableMinimizedByFinalizer(time.CumulVar(routing.End(v)))

    if capacities is not None:
        demand = routing.RegisterUnaryTransitCallback(
            lambda i: 0 if manager.IndexToNode(i) in terminals else 1)
        routing.AddDimensionWithVehicleCapacity(demand, 0, list(capacities), True, "Stops")

    if allowed:
        for node, vehicles in allowed.items():
            # -1 = "not visited", so the stop can still be dropped (and reported).
            routing.VehicleVar(manager.NodeToIndex(node)).SetValues([-1] + [int(v) for v in vehicles])

    if drop_penalty:
        for node in stops:
            routing.AddDisjunction([manager.NodeToIndex(node)], int(drop_penalty))

    params = pywrapcp.DefaultRoutingSearchParameters()
    params.first_solution_strategy = routing_enums_pb2.FirstSolutionStrategy.PARALLEL_CHEAPEST_INSERTION
    params.local_search_metaheuristic = routing_enums_pb2.LocalSearchMetaheuristic.GUIDED_LOCAL_SEARCH
    params.time_limit.seconds = int(time_limit)

    solution = routing.SolveWithParameters(params)
    if solution is None:
        return None

    routes, end_times, visited = [], [], set()
    for v in range(nv):
        route, index = [], solution.Value(routing.NextVar(routing.Start(v)))
        while not routing.IsEnd(index):
            node = manager.IndexToNode(index)
            route.append({"node": node, "arrival": solution.Min(time.CumulVar(index))})
            visited.add(node)
            index = solution.Value(routing.NextVar(index))
        routes.append(route)
        end_times.append(solution.Min(time.CumulVar(routing.End(v))))
    return {"routes": routes, "dropped": [s for s in stops if s not in visited], "end_times": end_times}


def solve_vrptw(data: Dict[str, Any]) -> Optional[List[Dict[str, Any]]]:
    """
    One vehicle leaving the depot at 9:00 and returning before day end.
    Kept as the simple entry point (benchmark, tests). Returns the stops in
    order, each with its node index, stop number, arrival and window.
    """
    depot = data["depot"]
    n = len(data["time_matrix"])
    service = data.get("service_time", SERVICE_TIME_DEFAULT)
    result = solve(
        matrix=data["time_matrix"],
        windows=data["time_windows"],
        service=[0 if i == depot else service for i in range(n)],
        starts=[depot], ends=[depot], start_times=[0],
        drop_penalty=data.get("drop_penalty"),
        time_limit=data.get("time_limit_seconds", 30),
        day_end=data["time_windows"][depot][1],
    )
    if result is None:
        return None
    stops = []
    for k, s in enumerate(result["routes"][0], start=1):
        window = data["time_windows"][s["node"]]
        stops.append({
            "stop_number": k,
            "node": s["node"],
            "address": data["addresses"][s["node"]],
            "arrival_minutes": s["arrival"],
            "arrival_time": _minutes_to_time_str(s["arrival"]),
            "slot": data["slots"][s["node"]] if "slots" in data else (1 if window[1] <= 180 else 2),
            "time_window": _format_time_window(window),
        })
    return stops
