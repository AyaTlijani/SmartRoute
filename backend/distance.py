"""
distance.py — OpenRouteService (ORS) integration for geocoding and travel-time matrix.

SmartRoute uses ORS to:
    1. Geocode delivery addresses into coordinates.
    2. Build a real-world driving-time matrix.
    3. Provide that matrix to the OR-Tools VRPTW solver.

The matrix keeps the same order as the input addresses:
    index 0 = depot
    index 1...n = delivery stops
"""

from typing import List, Tuple

import requests

from config import ORS_API_KEY


_GEOCODE_URL = "https://api.openrouteservice.org/geocode/search"
_MATRIX_URL = "https://api.openrouteservice.org/v2/matrix/driving-car"

# A very large travel time used when ORS reports that a pair is unreachable.
# OR-Tools will strongly avoid this connection when another valid route exists.
UNREACHABLE_TIME = 999999


def _geocode_address(address: str) -> Tuple[float, float]:
    """
    Convert a free-text address into (longitude, latitude).
    """

    params = {
        "api_key": ORS_API_KEY,
        "text": address,
        "size": 1,
    }

    response = requests.get(
        _GEOCODE_URL,
        params=params,
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

    coordinates = features[0]["geometry"]["coordinates"]

    # ORS / GeoJSON uses [longitude, latitude].
    lon, lat = coordinates

    return lon, lat


def _geocode_all(addresses: List[str]) -> List[List[float]]:
    """
    Geocode all addresses while preserving their input order.
    """

    coordinates: List[List[float]] = []

    for address in addresses:
        lon, lat = _geocode_address(address)
        coordinates.append([lon, lat])

    return coordinates


def fetch_distance_matrix(addresses: List[str]) -> List[List[int]]:
    """
    Build a driving-time matrix using OpenRouteService.

    Returns:
        n x n matrix where matrix[i][j] is the estimated driving
        time in minutes from address i to address j.

    If ORS reports an unreachable pair, that pair receives a very
    large travel time instead of causing the entire optimization
    to fail.
    """

    if len(addresses) < 2:
        raise ValueError(
            "At least 2 addresses are required "
            "(depot + at least 1 delivery stop)."
        )

    # ------------------------------------------------------------------
    # 1. GEOCODING
    # ------------------------------------------------------------------

    coordinates = _geocode_all(addresses)

    # ------------------------------------------------------------------
    # 2. ORS MATRIX REQUEST
    # ------------------------------------------------------------------

    headers = {
        "Authorization": ORS_API_KEY,
        "Content-Type": "application/json",
        "Accept": "application/json, application/geo+json",
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

    # ------------------------------------------------------------------
    # 3. CONVERT SECONDS → MINUTES
    # ------------------------------------------------------------------

    n = len(addresses)

    time_matrix: List[List[int]] = [
        [0] * n for _ in range(n)
    ]

    unreachable_pairs = []

    for i in range(n):
        for j in range(n):
            secs = raw_durations[i][j]

            if secs is None:
                time_matrix[i][j] = UNREACHABLE_TIME

                if i != j:
                    unreachable_pairs.append(
                        (addresses[i], addresses[j])
                    )

            else:
                time_matrix[i][j] = max(
                    0,
                    round(secs / 60),
                )

    # ------------------------------------------------------------------
    # 4. LOG UNREACHABLE PAIRS
    # ------------------------------------------------------------------

    if unreachable_pairs:
        print(
            f"[SmartRoute] ORS reported "
            f"{len(unreachable_pairs)} unreachable pair(s). "
            "These connections will be avoided by OR-Tools when possible."
        )

        for origin, destination in unreachable_pairs:
            print(
                f"  Unreachable: '{origin}' -> '{destination}'"
            )

    return time_matrix