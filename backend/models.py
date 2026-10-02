"""
models.py — Pydantic request/response schemas for SmartRoute.

The API separates:

    Stop data
        → address, coordinates, ETA, time window

    Route data
        → optimized sequence + actual road geometry

The road geometry is calculated AFTER OR-Tools selects the
optimized sequence. This allows the frontend to draw the
real driving route rather than a straight line between stops.
"""

from typing import List

from pydantic import BaseModel, Field


# ============================================================================
# REQUEST MODELS
# ============================================================================


class DeliveryStop(BaseModel):
    """
    A single customer delivery location.

    Fields:
        address:
            Full postal address.

        slot:
            1 → Morning (9:00 AM – 12:00 PM)
            2 → Afternoon (1:00 PM – 5:00 PM)
    """

    address: str = Field(
        ...,
        min_length=5,
        description=(
            "Full delivery address, e.g. "
            "'221B Baker Street, London, UK'"
        ),
    )

    slot: int = Field(
        ...,
        ge=1,
        le=2,
        description=(
            "Time-slot preference: "
            "1 = morning (9am-12pm), "
            "2 = afternoon (1pm-5pm)"
        ),
    )


class OptimizeRouteRequest(BaseModel):
    """
    Full request body for POST /optimize-route.
    """

    depot_address: str = Field(
        ...,
        min_length=5,
        description=(
            "Starting location — warehouse, "
            "distribution centre, etc."
        ),
    )

    deliveries: List[DeliveryStop] = Field(
        ...,
        description=(
            "List of delivery stops to route through "
            "(maximum 20)"
        ),
    )


# ============================================================================
# RESPONSE MODELS
# ============================================================================


class OptimizedStop(BaseModel):
    """
    One stop in the optimized delivery sequence.

    The order of these objects is the order selected by OR-Tools.
    """

    stop_number: int = Field(
        ...,
        description="Optimized position in the route, starting at 1.",
    )

    address: str = Field(
        ...,
        description="Customer delivery address.",
    )

    coordinates: List[float] = Field(
        ...,
        description=(
            "Customer coordinates in "
            "[longitude, latitude] order."
        ),
    )

    arrival_time: str = Field(
        ...,
        description="Estimated arrival time.",
    )

    time_window: str = Field(
        ...,
        description="Human-readable delivery time window.",
    )

    slot: int = Field(
        ...,
        description="Original requested time-slot: 1 or 2.",
    )

    maps_url: str = Field(
        ...,
        description=(
            "Google Maps deep-link for the complete "
            "optimized route."
        ),
    )


# ============================================================================
# COMPLETE ROUTE RESPONSE
# ============================================================================


class OptimizeRouteResponse(BaseModel):
    """
    Complete response returned by POST /optimize-route.

    Important architecture:

        route
            → optimized stops selected by OR-Tools

        route_geometry
            → actual road geometry calculated by the
              Directions API AFTER optimization

    Coordinates use:

        [longitude, latitude]

    This is the format used by GeoJSON / ORS.
    The React Leaflet frontend converts them to:

        [latitude, longitude]
    """

    success: bool = Field(
        ...,
        description="Whether optimization completed successfully.",
    )

    total_stops: int = Field(
        ...,
        description="Number of delivery stops.",
    )

    depot_address: str = Field(
        ...,
        description="Starting depot address.",
    )

    depot_coordinates: List[float] = Field(
        ...,
        description=(
            "Depot coordinates in "
            "[longitude, latitude] order."
        ),
    )

    route: List[OptimizedStop] = Field(
        ...,
        description=(
            "Delivery stops in the exact optimized "
            "order selected by OR-Tools."
        ),
    )

    route_geometry: List[List[float]] = Field(
        ...,
        description=(
            "Actual driving-route geometry in "
            "[longitude, latitude] order. "
            "Calculated after optimization."
        ),
    )

