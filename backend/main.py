"""
main.py — SmartRoute FastAPI backend.

Pipeline:

    Address input
        ↓
    Geocoding + travel-time matrix
        ↓
    OR-Tools VRPTW
        ↓
    Optimized delivery sequence
        ↓
    Directions API using optimized coordinates
        ↓
    Actual road geometry
        ↓
    React + Leaflet visualization
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
from distance import (
    fetch_route_data,
    fetch_route_geometry,
)
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

@app.get(
    "/health",
    tags=["Meta"],
)
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
        "OR-Tools optimized delivery sequence with "
        "coordinates, ETA, road geometry, and Google Maps route"
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

    # Index 0 is always the depot.
    # Index 1...n are the delivery locations.

    all_addresses = [
        request.depot_address,
        *[
            delivery.address
            for delivery in request.deliveries
        ],
    ]

    # ------------------------------------------------------------------------
    # 3. GEOCODE + TRAVEL-TIME MATRIX
    # ------------------------------------------------------------------------

    try:
        time_matrix, coordinates = fetch_route_data(
            all_addresses
        )

    except ValueError as exc:
        logger.warning(
            "Distance / geocoding error: %s",
            exc,
        )

        raise HTTPException(
            status_code=400,
            detail=str(exc),
        )

    except http_requests.RequestException as exc:
        logger.error(
            "Routing service request failed: %s",
            exc,
        )

        raise HTTPException(
            status_code=503,
            detail=(
                "Could not reach the routing service. "
                "Check your internet connection or "
                "API key."
            ),
        )

    # ------------------------------------------------------------------------
    # 4. BUILD TIME WINDOWS
    # ------------------------------------------------------------------------

    time_windows = [
        _DEPOT_WINDOW
    ]

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
    # 7. GET OPTIMIZED ADDRESS SEQUENCE
    # ------------------------------------------------------------------------
    #
    # IMPORTANT:
    #
    # OR-Tools has already selected the order.
    #
    # We now preserve that exact order when requesting road geometry.
    #
    # Example:
    #
    #   Depot
    #      ↓
    #   FSM
    #      ↓
    #   Falaise
    #      ↓
    #   Ribat
    #
    # Directions must receive exactly that sequence.
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

    # ------------------------------------------------------------------------
    # 8. MAP ADDRESS → COORDINATES
    # ------------------------------------------------------------------------
    #
    # The coordinates were generated in the original input order.
    #
    # We now reorder them according to the OR-Tools solution.
    #
    # This produces:
    #
    #   [depot, optimized stop 1, optimized stop 2, ...]
    #
    # which is exactly what the Directions API needs.
    # ------------------------------------------------------------------------

    coordinate_by_address = {
        address: coordinates[index]
        for index, address in enumerate(all_addresses)
    }

    try:
        optimized_coordinates = [
            coordinate_by_address[address]
            for address in optimized_addresses
        ]

    except KeyError as exc:
        raise HTTPException(
            status_code=500,
            detail=(
                "Could not match an optimized stop "
                f"to its coordinates: {exc}"
            ),
        )

    # ------------------------------------------------------------------------
    # 9. CALCULATE ACTUAL ROAD GEOMETRY
    # ------------------------------------------------------------------------
    #
    # This is deliberately AFTER OR-Tools.
    #
    # OR-Tools decides:
    #
    #   which stop comes first,
    #   which stop comes second,
    #   etc.
    #
    # Directions then calculates:
    #
    #   the actual roads connecting those stops.
    # ------------------------------------------------------------------------

    logger.info(
        "Calculating road geometry for optimized sequence..."
    )

    try:
        route_geometry = fetch_route_geometry(
            optimized_coordinates
        )

    except ValueError as exc:
        logger.warning(
            "Route geometry error: %s",
            exc,
        )

        raise HTTPException(
            status_code=502,
            detail=(
                "The route was optimized successfully, "
                "but the road geometry could not be calculated. "
                f"{exc}"
            ),
        )

    except http_requests.RequestException as exc:
        logger.error(
            "Directions API request failed: %s",
            exc,
        )

        raise HTTPException(
            status_code=503,
            detail=(
                "The route was optimized successfully, "
                "but the routing service could not calculate "
                "the road geometry."
            ),
        )

    logger.info(
        "Road geometry received: %d points",
        len(route_geometry),
    )

    # ------------------------------------------------------------------------
    # 10. BUILD GOOGLE MAPS ROUTE
    # ------------------------------------------------------------------------
    #
    # Google Maps is still available as an external navigation option.
    # It receives the SAME optimized order selected by OR-Tools.
    # ------------------------------------------------------------------------

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
    # 11. BUILD OPTIMIZED STOP RESPONSE
    # ------------------------------------------------------------------------

    optimized_stops = []

    for stop in solution_stops:

        address = stop["address"]

        if address not in coordinate_by_address:
            raise HTTPException(
                status_code=500,
                detail=(
                    f"Could not match optimized address "
                    f"'{address}' to its coordinates."
                ),
            )

        optimized_stops.append(
            OptimizedStop(
                stop_number=stop["stop_number"],
                address=address,
                coordinates=coordinate_by_address[address],
                arrival_time=stop["arrival_time"],
                time_window=stop["time_window"],
                slot=stop["slot"],
                maps_url=maps_url,
            )
        )

    # ------------------------------------------------------------------------
    # 12. RETURN COMPLETE ROUTE
    # ------------------------------------------------------------------------
    #
    # The response now contains THREE separate pieces of information:
    #
    #   depot_coordinates
    #       → depot marker
    #
    #   route
    #       → numbered optimized delivery markers
    #
    #   route_geometry
    #       → actual road line displayed on the map
    # ------------------------------------------------------------------------

    return OptimizeRouteResponse(
        success=True,
        total_stops=len(optimized_stops),
        depot_address=request.depot_address,
        depot_coordinates=coordinates[0],
        route=optimized_stops,
        route_geometry=route_geometry,
    )

