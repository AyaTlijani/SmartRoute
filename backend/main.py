"""
main.py — SmartRoute FastAPI backend.

Pipeline:

    Address input
        ↓
    OpenRouteService
        ↓
    Travel-time matrix
        ↓
    OR-Tools VRPTW
        ↓
    Optimized delivery sequence
        ↓
    Google Maps visualization
"""

import logging
import urllib.parse

import requests as http_requests
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from models import (
    OptimizeRouteRequest,
    OptimizeRouteResponse,
    OptimizedStop,
)
from distance import fetch_distance_matrix
from vrptw_solver import solve_vrptw


# ============================================================================
# LOGGING
# ============================================================================

logging.basicConfig(
    level=logging.INFO,
    format="%(levelname)s  %(name)s  %(message)s",
)

logger = logging.getLogger("smartroute_api")


# ============================================================================
# APPLICATION
# ============================================================================

app = FastAPI(
    title="SmartRoute",
    description=(
        "Intelligent delivery route optimization using "
        "Vehicle Routing Problem with Time Windows (VRPTW), "
        "OpenRouteService, and Google OR-Tools."
    ),
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
)


# ============================================================================
# CORS
# ============================================================================

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        # Add your deployed SmartRoute frontend URL here later.
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============================================================================
# TIME WINDOWS
# ============================================================================

# Slot 1: 9:00 AM – 12:00 PM
# Slot 2: 1:00 PM – 5:00 PM
# Depot: 9:00 AM – 6:00 PM

_SLOT_WINDOWS = {
    1: (0, 180),
    2: (240, 480),
}

_DEPOT_WINDOW = (0, 540)


# ============================================================================
# HEALTH CHECK
# ============================================================================

@app.get("/health", tags=["Meta"])
def health_check() -> dict:
    return {
        "status": "ok",
        "service": "SmartRoute",
    }


# ============================================================================
# ROUTE OPTIMIZATION
# ============================================================================

@app.post(
    "/optimize-route",
    response_model=OptimizeRouteResponse,
    tags=["Route Optimization"],
    summary="Optimize a set of delivery stops",
    response_description=(
        "OR-Tools optimized delivery sequence with ETA "
        "and Google Maps route"
    ),
)
def optimize_route(
    request: OptimizeRouteRequest,
) -> OptimizeRouteResponse:

    # ------------------------------------------------------------------------
    # 1. VALIDATE INPUT
    # ------------------------------------------------------------------------

    if not request.deliveries:
        raise HTTPException(
            status_code=400,
            detail="Please add at least one delivery stop.",
        )

    if len(request.deliveries) > 20:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Maximum 20 delivery stops are supported; "
                f"got {len(request.deliveries)}."
            ),
        )

    logger.info(
        "Optimization request: depot='%s', %d stops",
        request.depot_address,
        len(request.deliveries),
    )

    # ------------------------------------------------------------------------
    # 2. BUILD ADDRESS LIST
    # ------------------------------------------------------------------------

    all_addresses = [
        request.depot_address,
        *[
            delivery.address
            for delivery in request.deliveries
        ],
    ]

    # ------------------------------------------------------------------------
    # 3. GET REAL TRAVEL-TIME MATRIX
    # ------------------------------------------------------------------------

    try:
        time_matrix = fetch_distance_matrix(
            all_addresses
        )

    except ValueError as exc:
        logger.warning(
            "Distance matrix error: %s",
            exc,
        )

        raise HTTPException(
            status_code=400,
            detail=str(exc),
        )

    except http_requests.RequestException as exc:
        logger.error(
            "OpenRouteService API unreachable: %s",
            exc,
        )

        raise HTTPException(
            status_code=503,
            detail=(
                "Could not reach the routing service. "
                "Check your internet connection or "
                "OpenRouteService API key."
            ),
        )

    # ------------------------------------------------------------------------
    # 4. BUILD TIME WINDOWS
    # ------------------------------------------------------------------------

    time_windows = [_DEPOT_WINDOW]

    for delivery in request.deliveries:

        if delivery.slot not in _SLOT_WINDOWS:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Invalid slot '{delivery.slot}' "
                    f"for address '{delivery.address}'. "
                    "Allowed values: "
                    "1 (9 AM–12 PM) or 2 (1 PM–5 PM)."
                ),
            )

        time_windows.append(
            _SLOT_WINDOWS[delivery.slot]
        )

    # ------------------------------------------------------------------------
    # 5. BUILD OR-TOOLS DATA
    # ------------------------------------------------------------------------

    vrptw_data = {
        "time_matrix": time_matrix,
        "time_windows": time_windows,
        "num_vehicles": 1,
        "depot": 0,
        "service_time": 10,
        "addresses": all_addresses,
    }

    # ------------------------------------------------------------------------
    # 6. RUN OR-TOOLS
    # ------------------------------------------------------------------------

    logger.info(
        "Running OR-Tools VRPTW solver..."
    )

    solution_stops = solve_vrptw(
        vrptw_data
    )

    if solution_stops is None:
        logger.warning(
            "OR-Tools returned no feasible solution"
        )

        raise HTTPException(
            status_code=422,
            detail=(
                "No feasible route found. "
                "The selected delivery locations or time windows "
                "cannot currently be combined into one valid route."
            ),
        )

    logger.info(
        "OR-Tools solution found: %d stops",
        len(solution_stops),
    )

    # ------------------------------------------------------------------------
    # 7. BUILD GOOGLE MAPS VISUALIZATION
    #
    # OR-Tools decides the order.
    # Google Maps only displays that optimized order.
    # ------------------------------------------------------------------------

    optimized_addresses = [
        stop["address"]
        for stop in solution_stops
    ]

    if not optimized_addresses:
        raise HTTPException(
            status_code=422,
            detail="The optimizer returned an empty route.",
        )

    params = {
        "api": "1",
        "origin": request.depot_address,
        "destination": optimized_addresses[-1],
    }

    if len(optimized_addresses) > 1:
        params["waypoints"] = "|".join(
            optimized_addresses[:-1]
        )

    maps_url = (
        "https://www.google.com/maps/dir/?"
        + urllib.parse.urlencode(
            params,
            safe="|",
        )
    )

    logger.info(
        "Google Maps route generated."
    )

    # ------------------------------------------------------------------------
    # 8. BUILD RESPONSE
    # ------------------------------------------------------------------------

    optimized_stops = [
        OptimizedStop(
            stop_number=stop["stop_number"],
            address=stop["address"],
            arrival_time=stop["arrival_time"],
            time_window=stop["time_window"],
            slot=stop["slot"],
            maps_url=maps_url,
        )
        for stop in solution_stops
    ]

    return OptimizeRouteResponse(
        success=True,
        total_stops=len(optimized_stops),
        depot_address=request.depot_address,
        route=optimized_stops,
    )