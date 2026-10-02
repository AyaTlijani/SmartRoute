"""
vrptw_solver.py — OR-Tools Vehicle Routing Problem with Time Windows.

SmartRoute optimizes the delivery sequence using:

    • Real-world driving times from OpenRouteService
    • Delivery time windows
    • Delivery service time
    • Driver working-day horizon

The driver starts at the depot at 9:00 AM.

Time is represented as minutes after 9:00 AM:

    0   = 9:00 AM
    180 = 12:00 PM
    240 = 1:00 PM
    480 = 5:00 PM
    540 = 6:00 PM
"""

from typing import Optional, List, Dict, Any

from ortools.constraint_solver import (
    pywrapcp,
    routing_enums_pb2,
)


# ============================================================================
# CONFIGURATION
# ============================================================================

TIME_HORIZON_MINUTES = 540

MAX_SLACK_MINUTES = 540

SERVICE_TIME_DEFAULT = 10

UNREACHABLE_TIME = 999999


# ============================================================================
# TIME HELPERS
# ============================================================================

def _minutes_to_time_str(minutes_from_9am: int) -> str:
    """Convert minutes after 9:00 AM to a readable clock time."""

    total_minutes = (9 * 60) + int(minutes_from_9am)

    hours_24 = total_minutes // 60
    minutes = total_minutes % 60

    period = "AM" if hours_24 < 12 else "PM"

    hours_12 = hours_24 % 12

    if hours_12 == 0:
        hours_12 = 12

    return f"{hours_12}:{minutes:02d} {period}"


def _format_time_window(time_window: tuple) -> str:
    """Convert a numeric time window into a readable string."""

    start, end = time_window

    return (
        f"{_minutes_to_time_str(start)} – "
        f"{_minutes_to_time_str(end)}"
    )


# ============================================================================
# CORE SOLVER
# ============================================================================

def solve_vrptw(
    data: Dict[str, Any]
) -> Optional[List[Dict[str, Any]]]:
    """
    Solve the Vehicle Routing Problem with Time Windows.

    The vehicle:

        1. Starts at the depot at 9:00 AM.
        2. Visits every delivery exactly once.
        3. Respects every delivery time window.
        4. Can wait before a time window opens.
        5. Returns to the depot before 6:00 PM.

    The optimization objective is total driving time.
    """

    time_matrix = data["time_matrix"]
    time_windows = data["time_windows"]
    num_vehicles = data["num_vehicles"]
    depot = data["depot"]
    addresses = data["addresses"]

    service_time = data.get(
        "service_time",
        SERVICE_TIME_DEFAULT,
    )

    n = len(time_matrix)

    # ========================================================================
    # 1. ROUTING INDEX MANAGER
    # ========================================================================

    manager = pywrapcp.RoutingIndexManager(
        n,
        num_vehicles,
        depot,
    )

    # ========================================================================
    # 2. ROUTING MODEL
    # ========================================================================

    routing = pywrapcp.RoutingModel(manager)

    # ========================================================================
    # 3. TRAVEL-TIME CALLBACK
    # ========================================================================

    def travel_time_callback(
        from_routing_index: int,
        to_routing_index: int,
    ) -> int:

        from_node = manager.IndexToNode(
            from_routing_index
        )

        to_node = manager.IndexToNode(
            to_routing_index
        )

        return int(
            time_matrix[from_node][to_node]
        )

    travel_callback_index = routing.RegisterTransitCallback(
        travel_time_callback
    )

    # Minimize total driving time.
    routing.SetArcCostEvaluatorOfAllVehicles(
        travel_callback_index
    )

    # ========================================================================
    # 4. TIME CALLBACK
    # ========================================================================

    def time_callback(
        from_routing_index: int,
        to_routing_index: int,
    ) -> int:

        from_node = manager.IndexToNode(
            from_routing_index
        )

        to_node = manager.IndexToNode(
            to_routing_index
        )

        travel_minutes = int(
            time_matrix[from_node][to_node]
        )

        # No service time when leaving the depot.
        if from_node == depot:
            return travel_minutes

        # Add delivery service time when leaving a customer.
        return travel_minutes + service_time

    time_callback_index = routing.RegisterTransitCallback(
        time_callback
    )

    # ========================================================================
    # 5. TIME DIMENSION
    # ========================================================================

    routing.AddDimension(
        time_callback_index,
        MAX_SLACK_MINUTES,
        TIME_HORIZON_MINUTES,
        False,
        "Time",
    )

    time_dimension = routing.GetDimensionOrDie(
        "Time"
    )

    # ========================================================================
    # 6. DELIVERY TIME WINDOWS
    # ========================================================================

    for node_idx, time_window in enumerate(time_windows):

        if node_idx == depot:
            continue

        window_start, window_end = time_window

        routing_index = manager.NodeToIndex(
            node_idx
        )

        time_dimension.CumulVar(
            routing_index
        ).SetRange(
            window_start,
            window_end,
        )

    # ========================================================================
    # 7. DRIVER START / END
    # ========================================================================

    for vehicle_id in range(num_vehicles):

        start_index = routing.Start(
            vehicle_id
        )

        end_index = routing.End(
            vehicle_id
        )

        # Driver starts at exactly 9:00 AM.
        time_dimension.CumulVar(
            start_index
        ).SetRange(
            0,
            0,
        )

        # Driver must return by 6:00 PM.
        time_dimension.CumulVar(
            end_index
        ).SetRange(
            0,
            TIME_HORIZON_MINUTES,
        )

        # Prefer the earliest possible return.
        routing.AddVariableMinimizedByFinalizer(
            time_dimension.CumulVar(end_index)
        )

    # ========================================================================
    # 8. SEARCH PARAMETERS
    # ========================================================================

    search_parameters = (
        pywrapcp.DefaultRoutingSearchParameters()
    )

    # Use a time-window-aware construction strategy.
    search_parameters.first_solution_strategy = (
        routing_enums_pb2.FirstSolutionStrategy.PARALLEL_CHEAPEST_INSERTION
    )

    # Improve the initial route.
    search_parameters.local_search_metaheuristic = (
        routing_enums_pb2.LocalSearchMetaheuristic.GUIDED_LOCAL_SEARCH
    )

    search_parameters.time_limit.seconds = 30

    # ========================================================================
    # 9. SOLVE
    # ========================================================================

    solution = routing.SolveWithParameters(
        search_parameters
    )

    if solution is None:
        return None

    # ========================================================================
    # 10. EXTRACT ACTUAL OR-TOOLS ROUTE
    # ========================================================================

    return _extract_route(
        manager=manager,
        routing=routing,
        solution=solution,
        time_dimension=time_dimension,
        data=data,
    )


# ============================================================================
# ROUTE EXTRACTION
# ============================================================================

def _extract_route(
    manager: pywrapcp.RoutingIndexManager,
    routing: pywrapcp.RoutingModel,
    solution,
    time_dimension,
    data: Dict[str, Any],
) -> List[Dict[str, Any]]:
    """
    Extract the exact route selected by OR-Tools.

    No manual reordering is performed here.
    """

    stops: List[Dict[str, Any]] = []

    stop_number = 1

    index = routing.Start(0)

    while not routing.IsEnd(index):

        node = manager.IndexToNode(index)

        if node != data["depot"]:

            arrival_minutes = solution.Min(
                time_dimension.CumulVar(index)
            )

            time_window = data["time_windows"][node]

            if time_window[1] <= 180:
                slot_number = 1
            else:
                slot_number = 2

            stops.append(
                {
                    "stop_number": stop_number,
                    "address": data["addresses"][node],
                    "arrival_minutes": arrival_minutes,
                    "arrival_time": _minutes_to_time_str(
                        arrival_minutes
                    ),
                    "slot": slot_number,
                    "time_window": _format_time_window(
                        time_window
                    ),
                }
            )

            stop_number += 1

        index = solution.Value(
            routing.NextVar(index)
        )

    return stops