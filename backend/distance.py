"""
distance.py — Travel times and route geometry: the only module that knows
about the routing provider.

The optimizer only ever receives a matrix of minutes, so the provider can be
swapped without touching the model.

    With ORS_API_KEY  → OpenRouteService matrix (travel times) and directions
                         (road geometry + distance). Falls back to the
                         estimate if a call fails.
    Without a key     → estimate from straight-line distance:
                         road km = straight km × 1.3
                         25 km/h under 15 km, 70 km/h above, + 2 min to park
                         geometry = straight segments between stops

Coordinates are [longitude, latitude] throughout.
"""

import logging
import math
from typing import List, Tuple

import requests

from config import ORS_API_KEY, USE_ORS

log = logging.getLogger("smartroute.distance")

_MATRIX_URL = "https://api.heigit.org/openrouteservice/v2/matrix/driving-car"
_DIRECTIONS_URL = "https://api.heigit.org/openrouteservice/v2/directions/driving-car/geojson"
UNREACHABLE_TIME = 999_999
_ROAD_FACTOR = 1.3


# ============================================================================
# OFFLINE ESTIMATE
# ============================================================================

def _haversine_km(a: List[float], b: List[float]) -> float:
    lng1, lat1, lng2, lat2 = map(math.radians, [a[0], a[1], b[0], b[1]])
    h = (math.sin((lat2 - lat1) / 2) ** 2
         + math.cos(lat1) * math.cos(lat2) * math.sin((lng2 - lng1) / 2) ** 2)
    return 6371 * 2 * math.asin(math.sqrt(h))


def _estimate_minutes(km_road: float) -> int:
    if km_road <= 0.01:
        return 0
    speed = 25 if km_road < 15 else 70
    return round(km_road / speed * 60) + 2


def _estimated_matrix(coordinates: List[List[float]]) -> List[List[int]]:
    return [[_estimate_minutes(_haversine_km(a, b) * _ROAD_FACTOR) for b in coordinates] for a in coordinates]


# ============================================================================
# PUBLIC API
# ============================================================================

def _check(r) -> None:
    """Raise with ORS's own error message, so the log says what went wrong."""
    if r.status_code >= 400:
        try:
            detail = r.json().get("error")
            detail = detail.get("message", detail) if isinstance(detail, dict) else detail
        except ValueError:
            detail = r.text[:200]
        raise RuntimeError(f"HTTP {r.status_code}: {detail}")


def time_matrix_for_coordinates(coordinates: List[List[float]]) -> Tuple[List[List[int]], str]:
    """Driving-time matrix in minutes. Returns (matrix, "ors" | "estimate")."""
    if USE_ORS:
        try:
            r = requests.post(_MATRIX_URL, json={"locations": coordinates, "metrics": ["duration"]},
                              headers={"Authorization": ORS_API_KEY}, timeout=30)
            _check(r)
            durations = r.json()["durations"]
            # A point ORS can't place on a road gives null for its pairs. Estimate
            # those pairs instead of calling the stop unreachable.
            estimate = _estimated_matrix(coordinates)
            return [[estimate[i][j] if s is None else max(0, round(s / 60)) for j, s in enumerate(row)]
                    for i, row in enumerate(durations)], "ors"
        except Exception as exc:  # network, quota, bad key, > 50 locations on the free plan
            log.warning("ORS matrix failed, using estimate: %s", exc)
    return _estimated_matrix(coordinates), "estimate"


def road_route_for_coordinates(coordinates: List[List[float]]):
    """
    Route through the points in the given order.

    Returns (geometry, distance_m, duration_s, source, legs) where legs[i] is
    the path from point i to point i+1, so each delivery can be drawn (and
    greyed out once done) on its own.
    """
    if USE_ORS:
        try:
            # radiuses -1: snap each point to the nearest road however far it is.
            # By default ORS searches 350 m, and one stop in a park or by the
            # sea would fail the whole route.
            r = requests.post(_DIRECTIONS_URL,
                              json={"coordinates": coordinates, "radiuses": [-1] * len(coordinates)},
                              headers={"Authorization": ORS_API_KEY}, timeout=30)
            _check(r)
            feature = r.json()["features"][0]
            summary = feature["properties"]["summary"]
            geometry = feature["geometry"]["coordinates"]
            marks = feature["properties"].get("way_points") or []
            legs = ([geometry[a:b + 1] for a, b in zip(marks, marks[1:])]
                    if len(marks) == len(coordinates) else
                    [[list(a), list(b)] for a, b in zip(coordinates, coordinates[1:])])
            return geometry, float(summary["distance"]), int(round(summary["duration"])), "ors", legs
        except Exception as exc:
            log.warning("ORS directions failed, using estimate: %s", exc)

    legs = list(zip(coordinates, coordinates[1:]))
    km = sum(_haversine_km(a, b) * _ROAD_FACTOR for a, b in legs)
    minutes = sum(_estimate_minutes(_haversine_km(a, b) * _ROAD_FACTOR) for a, b in legs)
    return ([list(c) for c in coordinates], km * 1000, minutes * 60, "estimate",
            [[list(a), list(b)] for a, b in legs])
