"""
distance.py — OpenRouteService / HeiGIT integration.

SmartRoute uses the routing service for three separate jobs:

    1. Geocoding
       Address → [longitude, latitude]

    2. Travel-time matrix
       Used by OR-Tools to decide the optimal delivery order.

    3. Route geometry
       Used AFTER OR-Tools has selected the order, so the frontend
       can draw the actual road route on the map.

Important distinction:

    Travel-time matrix
        → optimization input

    Directions geometry
        → visualization / navigation output

The optimizer chooses:

    Depot → Delivery 2 → Delivery 1 → Delivery 3

Then Directions is asked to calculate the actual roads for exactly:

    Depot → Delivery 2 → Delivery 1 → Delivery 3
"""

from typing import List, Tuple

import requests

from config import ORS_API_KEY


# ============================================================================
# HEIGIT / OPENROUTESERVICE API ENDPOINTS
# ============================================================================

# The old api.openrouteservice.org domain is deprecated.
# The current API is served through api.heigit.org.

_GEOCODE_URL = (
    "https://api.heigit.org/pelias/v1/search"
)

_MATRIX_URL = (
    "https://api.heigit.org/openrouteservice/v2/matrix/driving-car"
)

_DIRECTIONS_URL = (
    "https://api.heigit.org/openrouteservice/v2/"
    "directions/driving-car/geojson"
)


# ============================================================================
# CONSTANTS
# ============================================================================

# A very large travel time used when ORS reports that a pair is unreachable.
UNREACHABLE_TIME = 999999


# ============================================================================
# GEOCODING
# ============================================================================

def _geocode_address(
    address: str,
) -> Tuple[float, float]:
    """
    Convert a free-text address into:

        (longitude, latitude)

    The current HeiGIT Pelias endpoint uses the API key
    through the Authorization header.
    """

    headers = {
        "Authorization": ORS_API_KEY,
        "Accept": "application/json",
    }

    params = {
        "text": address,
        "size": 1,
    }

    response = requests.get(
        _GEOCODE_URL,
        params=params,
        headers=headers,
        timeout=10,
    )

    response.raise_for_status()

    data = response.json()

    features = data.get("features", [])

    if not features:
        raise ValueError(
            f"Could not geocode address: '{address}'.\n"
            "Please check the spelling and include the city and country."
        )

    coordinates = (
        features[0]
        .get("geometry", {})
        .get("coordinates")
    )

    if not coordinates or len(coordinates) < 2:
        raise ValueError(
            f"Geocoding returned no usable coordinates "
            f"for address: '{address}'."
        )

    lon, lat = coordinates[:2]

    return lon, lat


def _geocode_all(
    addresses: List[str],
) -> List[List[float]]:
    """
    Geocode all addresses while preserving their input order.

    Returns:

        [
            [longitude, latitude],
            ...
        ]
    """

    coordinates: List[List[float]] = []

    for address in addresses:

        lon, lat = _geocode_address(
            address
        )

        coordinates.append(
            [lon, lat]
        )

    return coordinates


# ============================================================================
# TRAVEL-TIME MATRIX
# ============================================================================

def fetch_route_data(
    addresses: List[str],
) -> Tuple[List[List[int]], List[List[float]]]:
    """
    Geocode addresses and build the driving-time matrix.

    Returns:

        (
            time_matrix,
            coordinates
        )

    time_matrix:
        n x n matrix where matrix[i][j] is the estimated
        driving time in minutes from address i to address j.

    coordinates:
        ORS coordinates for every address in the same order
        as the input addresses.

    Coordinates use:

        [longitude, latitude]
    """

    if len(addresses) < 2:
        raise ValueError(
            "At least 2 addresses are required "
            "(depot + at least 1 delivery stop)."
        )

    # ------------------------------------------------------------------------
    # 1. GEOCODING
    # ------------------------------------------------------------------------

    coordinates = _geocode_all(
        addresses
    )

    # ------------------------------------------------------------------------
    # 2. MATRIX REQUEST
    # ------------------------------------------------------------------------

    headers = {
        "Authorization": ORS_API_KEY,
        "Content-Type": "application/json",
        "Accept": "application/json",
    }

    body = {
        "locations": coordinates,
        "metrics": ["duration"],
        "units": "m",
    }

    response = requests.post(
        _MATRIX_URL,
        json=body,
        headers=headers,
        timeout=30,
    )

    response.raise_for_status()

    data = response.json()

    raw_durations = data.get(
        "durations"
    )

    if not raw_durations:
        raise ValueError(
            "OpenRouteService returned no duration data. "
            "Please check the addresses and ORS API configuration."
        )

    # ------------------------------------------------------------------------
    # 3. CONVERT SECONDS → MINUTES
    # ------------------------------------------------------------------------

    n = len(addresses)

    time_matrix: List[List[int]] = [
        [0] * n
        for _ in range(n)
    ]

    unreachable_pairs = []

    for i in range(n):

        for j in range(n):

            secs = raw_durations[i][j]

            if secs is None:

                time_matrix[i][j] = (
                    UNREACHABLE_TIME
                )

                if i != j:
                    unreachable_pairs.append(
                        (
                            addresses[i],
                            addresses[j],
                        )
                    )

            else:

                time_matrix[i][j] = max(
                    0,
                    round(secs / 60),
                )

    # ------------------------------------------------------------------------
    # 4. LOG UNREACHABLE PAIRS
    # ------------------------------------------------------------------------

    if unreachable_pairs:

        print(
            f"[SmartRoute] ORS reported "
            f"{len(unreachable_pairs)} unreachable pair(s). "
            "These connections will be avoided by OR-Tools when possible."
        )

        for origin, destination in unreachable_pairs:

            print(
                f"  Unreachable: "
                f"'{origin}' -> '{destination}'"
            )

    return (
        time_matrix,
        coordinates,
    )


# ============================================================================
# ACTUAL ROAD ROUTE GEOMETRY
# ============================================================================

def fetch_route_geometry(
    coordinates: List[List[float]],
) -> List[List[float]]:
    """
    Calculate the actual driving route for an already-optimized sequence.

    This function MUST be called after OR-Tools has selected the order.

    Example input:

        [
            depot,
            delivery_2,
            delivery_1,
            delivery_3,
        ]

    The Directions API then returns the road geometry following:

        depot → delivery_2 → delivery_1 → delivery_3

    Returns:

        [
            [longitude, latitude],
            [longitude, latitude],
            ...
        ]

    These coordinates represent the actual road geometry and are
    intended for rendering on the frontend map.
    """

    if len(coordinates) < 2:
        raise ValueError(
            "At least two coordinates are required "
            "to calculate a route."
        )

    headers = {
        "Authorization": ORS_API_KEY,
        "Content-Type": "application/json",
        "Accept": (
            "application/geo+json, "
            "application/json"
        ),
    }

    body = {
        "coordinates": coordinates,
    }

    response = requests.post(
        _DIRECTIONS_URL,
        json=body,
        headers=headers,
        timeout=30,
    )

    response.raise_for_status()

    data = response.json()

    features = data.get(
        "features",
        [],
    )

    if not features:
        raise ValueError(
            "OpenRouteService returned no route geometry."
        )

    geometry = (
        features[0]
        .get("geometry", {})
    )

    geometry_coordinates = geometry.get(
        "coordinates"
    )

    if not geometry_coordinates:
        raise ValueError(
            "OpenRouteService returned a route "
            "without usable geometry."
        )

    return geometry_coordinates


# ============================================================================
# BACKWARDS-COMPATIBLE HELPER
# ============================================================================

def fetch_distance_matrix(
    addresses: List[str],
) -> List[List[int]]:
    """
    Backwards-compatible helper that returns only the travel-time matrix.

    Existing code using fetch_distance_matrix() continues to work.
    """

    time_matrix, _ = fetch_route_data(
        addresses
    )

    return time_matrix

