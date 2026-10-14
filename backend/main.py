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
    Actual road geometry + distance + driving duration
        ↓
    Route metrics
        ↓
    React + Leaflet visualization
"""

import logging
import urllib.parse

import requests as http_requests
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi import Depends

import analytics
import auth
import dispatch
import drivers
import sample_data
from auth import require_admin
from db import connect, init_db

from models import (
    OptimizeRouteRequest,
    OptimizeRouteResponse,
    OptimizedStop,
    RouteMetrics,
)

from distance import (
    fetch_route_data,
    fetch_route_geometry,
)

from vrptw_solver import solve_vrptw
from config import USE_ORS


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
# DISPATCH WORKFLOW (Excel import, drivers, routes, analytics)
# ============================================================================

app.include_router(auth.router)
app.include_router(dispatch.router)
app.include_router(drivers.router)
app.include_router(analytics.router)


@app.on_event("startup")
def _startup() -> None:
    """Create tables; load demo drivers + history on first run."""
    init_db()
    with connect() as conn:
        if conn.execute("SELECT COUNT(*) FROM drivers").fetchone()[0] == 0:
            logger.info("Empty database: loading demo data")
            sample_data.seed_demo(conn)
        sample_data.ensure_accounts(conn)


# ============================================================================
# CORS
# ============================================================================

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============================================================================
# ROUTING CONSTANTS
# ============================================================================

# Slot 1: 9:00 AM – 12:00 PM
# Slot 2: 1:00 PM – 5:00 PM
# Depot: 9:00 AM – 6:00 PM

_SLOT_WINDOWS = {
    1: (0, 180),
    2: (240, 480),
}

_DEPOT_WINDOW = (0, 540)

# OR-Tools uses 10 minutes of service time at every delivery.
_SERVICE_TIME_MINUTES = 10


# ============================================================================
# HEALTH CHECK
# ============================================================================

@app.get(
    "/health",
    tags=["Meta"],
)
def health_check() -> dict:
    """
    Simple API health check.
    """

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
        "coordinates, ETA, road geometry, route metrics, "
        "and Google Maps route"
    ),
)
def optimize_route(
    request: OptimizeRouteRequest,
    _admin=Depends(require_admin),
) -> OptimizeRouteResponse:

    if not USE_ORS:
        raise HTTPException(
            status_code=503,
            detail=(
                "The address planner needs an OpenRouteService key "
                "(ORS_API_KEY in backend/.env). The dispatch workflow "
                "works without one."
            ),
        )

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
    #
    # Index 0 is always the depot.
    #
    # Index 1...n are delivery locations.
    #
    # This same ordering is used by the travel-time matrix.
    # ------------------------------------------------------------------------

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
                "Check your internet connection or API key."
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
        "service_time": _SERVICE_TIME_MINUTES,
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
    # The solver has already selected the exact delivery order.
    #
    # The depot is added explicitly as the first coordinate later.
    # ------------------------------------------------------------------------

    optimized_delivery_addresses = [
        stop["address"]
        for stop in solution_stops
    ]

    if not optimized_delivery_addresses:

        raise HTTPException(
            status_code=422,
            detail="The optimizer returned an empty route.",
        )

    optimized_addresses = [
        request.depot_address,
        *optimized_delivery_addresses,
    ]

    logger.info(
        "Optimized sequence: %s",
        " -> ".join(optimized_addresses),
    )

    # ------------------------------------------------------------------------
    # 8. MAP ADDRESS → COORDINATES
    # ------------------------------------------------------------------------
    #
    # Coordinates were generated in the original input order.
    #
    # Reorder them according to the optimized sequence.
    # ------------------------------------------------------------------------

    # Map by the solver's node index, not by address text, so two
    # deliveries with the same address no longer collide.
    optimized_coordinates = [coordinates[0]] + [
        coordinates[stop["node"]] for stop in solution_stops
    ]

    # ------------------------------------------------------------------------
    # 9. CALCULATE ACTUAL ROAD ROUTE
    # ------------------------------------------------------------------------
    #
    # Directions receives the exact order selected by OR-Tools.
    #
    # It returns:
    #
    #   route geometry
    #   total driving distance
    #   total driving duration
    #
    # All three values describe the SAME calculated road route.
    # ------------------------------------------------------------------------

    logger.info(
        "Calculating road route for optimized sequence..."
    )

    try:

        (
            route_geometry,
            distance_meters,
            driving_duration_seconds,
        ) = fetch_route_geometry(
            optimized_coordinates
        )

    except ValueError as exc:

        logger.warning(
            "Route calculation error: %s",
            exc,
        )

        raise HTTPException(
            status_code=502,
            detail=(
                "The route was optimized successfully, "
                "but the road route could not be calculated. "
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
                "the road route."
            ),
        )

    logger.info(
        "Road route received: %d geometry points, "
        "%.2f km, %.1f minutes driving",
        len(route_geometry),
        distance_meters / 1000,
        driving_duration_seconds / 60,
    )

    # ------------------------------------------------------------------------
    # 10. CALCULATE ROUTE METRICS
    # ------------------------------------------------------------------------
    #
    # Directions duration = driving time only.
    #
    # OR-Tools also models a 10-minute service period at every
    # delivery. We therefore expose both values separately.
    # ------------------------------------------------------------------------

    delivery_count = len(solution_stops)

    total_driving_minutes = max(
        0,
        round(
            driving_duration_seconds / 60
        ),
    )

    total_service_minutes = (
        delivery_count *
        _SERVICE_TIME_MINUTES
    )

    total_route_minutes = (
        total_driving_minutes +
        total_service_minutes
    )

    route_metrics = RouteMetrics(
        total_distance_km=round(
            distance_meters / 1000,
            2,
        ),
        total_driving_minutes=total_driving_minutes,
        total_service_minutes=total_service_minutes,
        total_route_minutes=total_route_minutes,
        delivery_count=delivery_count,
    )

    # ------------------------------------------------------------------------
    # 11. BUILD GOOGLE MAPS ROUTE
    # ------------------------------------------------------------------------
    #
    # Google Maps receives the SAME optimized order selected by OR-Tools.
    # It is only used as an external navigation option.
    # ------------------------------------------------------------------------

    params = {
        "api": "1",
        "origin": request.depot_address,
        "destination": optimized_delivery_addresses[-1],
    }

    if len(optimized_delivery_addresses) > 1:

        params["waypoints"] = "|".join(
            optimized_delivery_addresses[:-1]
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
    # 12. BUILD OPTIMIZED STOP RESPONSE
    # ------------------------------------------------------------------------

    optimized_stops = []

    for stop in solution_stops:

        address = stop["address"]

        optimized_stops.append(
            OptimizedStop(
                stop_number=stop["stop_number"],
                address=address,
                coordinates=coordinates[stop["node"]],
                arrival_time=stop["arrival_time"],
                time_window=stop["time_window"],
                slot=stop["slot"],
                maps_url=maps_url,
            )
        )

    # ------------------------------------------------------------------------
    # 13. RETURN COMPLETE ROUTE
    # ------------------------------------------------------------------------
    #
    # Response contains:
    #
    #   depot_coordinates
    #       → starting-point marker
    #
    #   route
    #       → numbered optimized delivery stops
    #
    #   route_geometry
    #       → actual road geometry
    #
    #   metrics
    #       → actual distance + driving/service/total duration
    # ------------------------------------------------------------------------

    return OptimizeRouteResponse(
        success=True,
        total_stops=len(optimized_stops),
        depot_address=request.depot_address,
        depot_coordinates=coordinates[0],
        route=optimized_stops,
        route_geometry=route_geometry,
        metrics=route_metrics,
    )