"""
models.py — Pydantic request/response schemas for the VRPTW optimizer API.

Why this file exists:
    FastAPI uses Pydantic models for automatic request validation, JSON
    serialisation, and OpenAPI schema generation. Keeping models in their own
    file separates the data contract from business logic, making it easy to
    version the API or reuse these types in tests.

Types defined here:
    Request side:
        DeliveryStop          — one customer with an address + slot preference
        OptimizeRouteRequest  — full POST body (depot + list of deliveries)

    Response side:
        OptimizedStop         — one stop in the solved route (includes Maps URL)
        OptimizeRouteResponse — full response envelope
"""

from pydantic import BaseModel, Field
from typing import List


class DeliveryStop(BaseModel):
    """
    A single customer delivery location.

    Fields:
        address (str): Full postal address as a free-text string.
        slot    (int): Delivery time-slot preference.
                       1 → Slot 1 (9:00 AM – 12:00 PM)
                       2 → Slot 2 (1:00 PM – 5:00 PM)
    """

    address: str = Field(
        ...,
        min_length=5,
        description="Full delivery address, e.g. '221B Baker Street, London, UK'",
    )
    slot: int = Field(
        ...,
        ge=1,
        le=2,
        description="Time-slot preference: 1 = morning (9am-12pm), 2 = afternoon (1pm-5pm)",
    )


class OptimizeRouteRequest(BaseModel):
    """
    Full request body for POST /optimize-route.

    Fields:
        depot_address (str): Where the driver starts each day.
        deliveries    (List[DeliveryStop]): 1–20 delivery locations to optimise.
    """

    depot_address: str = Field(
        ...,
        min_length=5,
        description="Starting location — warehouse, distribution centre, etc.",
    )
    deliveries: List[DeliveryStop] = Field(
        ...,
        description="List of delivery stops to route through (max 20)",
    )


# ---------------------------------------------------------------------------
# Response models
# ---------------------------------------------------------------------------


class OptimizedStop(BaseModel):
    """
    One stop in the optimised delivery sequence.

    Fields:
        stop_number  (int): Position in route (1-based).
        address      (str): Customer address.
        arrival_time (str): Estimated arrival, e.g. '10:30 AM'.
        time_window  (str): Human-readable slot window.
        slot         (int): Original slot choice (1 or 2).
        maps_url     (str): Google Maps deep-link for one-tap navigation.
    """

    stop_number: int
    address: str
    arrival_time: str
    time_window: str
    slot: int
    maps_url: str


class OptimizeRouteResponse(BaseModel):
    """
    Envelope returned by POST /optimize-route on success.

    Fields:
        success        (bool): Always True when HTTP 200.
        total_stops    (int): Number of delivery stops in the route.
        depot_address  (str): Echoed back for the frontend to display.
        route          (List[OptimizedStop]): Ordered optimised stop sequence.
    """

    success: bool
    total_stops: int
    depot_address: str
    route: List[OptimizedStop]