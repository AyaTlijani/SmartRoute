"""
models.py — Pydantic request/response schemas for SmartRoute.

The API separates:

    Stop data
        → address, coordinates, ETA, time window

    Route data
        → optimized sequence + actual road geometry

    Route metrics
        → distance, driving duration, optimization summary

The road geometry and route metrics are calculated AFTER
OR-Tools selects the optimized sequence.
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
        min_length=1,
        max_length=20,
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

    The order of these objects is the exact order selected
    by OR-Tools.
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
        min_length=2,
        max_length=2,
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
        ge=1,
        le=2,
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
# ROUTE METRICS
# ============================================================================


class RouteMetrics(BaseModel):
    """
    Real metrics for the optimized route.

    These values describe the final route returned by
    the Directions API after OR-Tools has selected
    the delivery order.
    """

    total_distance_km: float = Field(
        ...,
        ge=0,
        description=(
            "Total driving distance of the optimized "
            "route in kilometres."
        ),
    )

    total_driving_minutes: int = Field(
        ...,
        ge=0,
        description=(
            "Total estimated driving time of the optimized "
            "route in minutes, excluding delivery service time."
        ),
    )

    total_service_minutes: int = Field(
        ...,
        ge=0,
        description=(
            "Total delivery service time. "
            "Currently 10 minutes per delivery."
        ),
    )

    total_route_minutes: int = Field(
        ...,
        ge=0,
        description=(
            "Total route duration including driving and "
            "delivery service time."
        ),
    )

    delivery_count: int = Field(
        ...,
        ge=0,
        description="Number of deliveries in the route.",
    )


# ============================================================================
# COMPLETE ROUTE RESPONSE
# ============================================================================


class OptimizeRouteResponse(BaseModel):
    """
    Complete response returned by POST /optimize-route.

    Pipeline:

        Addresses
            ↓
        Geocoding
            ↓
        Travel-time matrix
            ↓
        OR-Tools VRPTW
            ↓
        Optimized delivery sequence
            ↓
        Directions API
            ↓
        Actual road geometry + route metrics
            ↓
        Frontend visualization

    Coordinates use:

        [longitude, latitude]

    The React Leaflet frontend converts them to:

        [latitude, longitude]
    """

    success: bool = Field(
        ...,
        description="Whether optimization completed successfully.",
    )

    total_stops: int = Field(
        ...,
        ge=0,
        description="Number of delivery stops.",
    )

    depot_address: str = Field(
        ...,
        description="Starting depot address.",
    )

    depot_coordinates: List[float] = Field(
        ...,
        min_length=2,
        max_length=2,
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

    metrics: RouteMetrics = Field(
        ...,
        description=(
            "Real distance and duration metrics "
            "for the final optimized route."
        ),
    )