"""
distance.py — OpenRouteService / HeiGIT integration.

SmartRoute uses the routing service for three separate jobs:

    1. Geocoding
       Address → [longitude, latitude]

    2. Travel-time matrix
       Used by OR-Tools to decide the optimized delivery order.

    3. Route geometry + route metrics
       Used AFTER OR-Tools has selected the order, so the frontend
       can display the actual road route, distance, and driving time.

Important distinction:

    Travel-time matrix
        → optimization input

    Directions route
        → final road geometry + real route distance/duration

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

    return float(lon), float(lat)


def _geocode_all(
    addresses: List[str],
) -> List[List[float]]:
    """
    Geocode all addresses while preserving input order.

    Returns:

        [
            [longitude, latitude],
            ...
        ]
    """

    coordinates: List[List[float]] = []

    for address in addresses:
        lon, lat = _geocode_address(address)

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
        ORS coordinates for every address in input order.

    Coordinates:

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

    coordinates = _geocode_all(addresses)

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

    raw_durations = data.get("durations")

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
                    round(float(secs) / 60),
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
# ACTUAL ROAD ROUTE
# ============================================================================

def fetch_route_geometry(
    coordinates: List[List[float]],
) -> Tuple[
    List[List[float]],
    float,
    int,
]:
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

    Returns:

        (
            geometry,
            distance_meters,
            duration_seconds,
        )

    geometry:
        Actual road geometry in [longitude, latitude] format.

    distance_meters:
        Total driving distance of the calculated route.

    duration_seconds:
        Total estimated driving duration of the calculated route.

    The distance and duration come from the same Directions API
    response as the displayed geometry.
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

    features = data.get("features", [])

    if not features:
        raise ValueError(
            "OpenRouteService returned no route."
        )

    feature = features[0]

    # ------------------------------------------------------------------------
    # ROUTE GEOMETRY
    # ------------------------------------------------------------------------

    geometry = feature.get(
        "geometry",
        {},
    )

    geometry_coordinates = geometry.get(
        "coordinates"
    )

    if not geometry_coordinates:
        raise ValueError(
            "OpenRouteService returned a route "
            "without usable geometry."
        )

    # ------------------------------------------------------------------------
    # ROUTE METRICS
    # ------------------------------------------------------------------------
    #
    # For GeoJSON directions responses, the route summary is contained
    # inside feature.properties.summary.
    #
    # distance → meters
    # duration → seconds
    # ------------------------------------------------------------------------

    properties = feature.get(
        "properties",
        {}
    )

    summary = properties.get(
        "summary",
        {}
    )

    distance_meters = summary.get(
        "distance"
    )

    duration_seconds = summary.get(
        "duration"
    )

    if distance_meters is None:
        raise ValueError(
            "OpenRouteService returned route geometry "
            "but no route distance."
        )

    if duration_seconds is None:
        raise ValueError(
            "OpenRouteService returned route geometry "
            "but no route duration."
        )

    return (
        geometry_coordinates,
        float(distance_meters),
        int(round(float(duration_seconds))),
    )


# ============================================================================
# BACKWARDS-COMPATIBLE GEOMETRY HELPER
# ============================================================================

def fetch_route_geometry_only(
    coordinates: List[List[float]],
) -> List[List[float]]:
    """
    Backwards-compatible helper returning only route geometry.

    New code should use fetch_route_geometry() directly so that
    distance and duration are available without making another
    Directions API request.
    """

    geometry, _, _ = fetch_route_geometry(
        coordinates
    )

    return geometry


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

# ============================================================================
# COORDINATE-BASED HELPERS (used by dispatch; work without an API key)
# ============================================================================
#
# Dispatch already knows each order's coordinates (from the Excel file or
# the offline Tunisia table), so no geocoding is needed. If an ORS key is
# configured we ask ORS for real driving times and road geometry; if not,
# or if ORS fails, we fall back to a distance-based estimate so the app
# always works.
# ----------------------------------------------------------------------------

import math

from config import USE_ORS

_ROAD_FACTOR = 1.3  # roads are longer than straight lines


def _haversine_km(a: List[float], b: List[float]) -> float:
    """Great-circle distance between two [lng, lat] points, in km."""
    lng1, lat1, lng2, lat2 = map(math.radians, [a[0], a[1], b[0], b[1]])
    h = (
        math.sin((lat2 - lat1) / 2) ** 2
        + math.cos(lat1) * math.cos(lat2) * math.sin((lng2 - lng1) / 2) ** 2
    )
    return 6371 * 2 * math.asin(math.sqrt(h))


def _estimate_minutes(km_road: float) -> int:
    """City driving ~25 km/h, intercity ~70 km/h, plus 2 min to park."""
    if km_road <= 0.01:
        return 0
    speed = 25 if km_road < 15 else 70
    return round(km_road / speed * 60) + 2


def _estimated_matrix(coordinates: List[List[float]]) -> List[List[int]]:
    return [
        [_estimate_minutes(_haversine_km(a, b) * _ROAD_FACTOR) for b in coordinates]
        for a in coordinates
    ]


def time_matrix_for_coordinates(
    coordinates: List[List[float]],
) -> Tuple[List[List[int]], str]:
    """
    Driving-time matrix (minutes) for [lng, lat] points.

    Returns (matrix, source) where source is "ors" or "estimate".
    """
    if USE_ORS:
        try:
            response = requests.post(
                _MATRIX_URL,
                json={"locations": coordinates, "metrics": ["duration"]},
                headers={"Authorization": ORS_API_KEY},
                timeout=30,
            )
            response.raise_for_status()
            durations = response.json()["durations"]
            matrix = [
                [UNREACHABLE_TIME if s is None else max(0, round(s / 60)) for s in row]
                for row in durations
            ]
            return matrix, "ors"
        except Exception as exc:  # network, quota, bad key → fall back
            print(f"[SmartRoute] ORS matrix failed, using estimate: {exc}")
    return _estimated_matrix(coordinates), "estimate"


def road_route_for_coordinates(
    coordinates: List[List[float]],
) -> Tuple[List[List[float]], float, int, str]:
    """
    Route through [lng, lat] points in the given order.

    Returns (geometry, distance_m, duration_s, source). Without ORS the
    geometry is straight segments between stops.
    """
    if USE_ORS:
        try:
            geometry, meters, seconds = fetch_route_geometry(coordinates)
            return geometry, meters, seconds, "ors"
        except Exception as exc:
            print(f"[SmartRoute] ORS directions failed, using estimate: {exc}")

    km = sum(
        _haversine_km(a, b) * _ROAD_FACTOR
        for a, b in zip(coordinates, coordinates[1:])
    )
    minutes = sum(
        _estimate_minutes(_haversine_km(a, b) * _ROAD_FACTOR)
        for a, b in zip(coordinates, coordinates[1:])
    )
    return [list(c) for c in coordinates], km * 1000, minutes * 60, "estimate"
