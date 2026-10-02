import React from "react";
import {
  MapContainer,
  Marker,
  Popup,
  Polyline,
  TileLayer,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

/**
 * RouteMap.jsx
 *
 * Displays the optimized delivery route.
 *
 * Architecture:
 *
 *   OR-Tools
 *       ↓
 *   optimized stop order
 *       ↓
 *   Directions API
 *       ↓
 *   actual road geometry
 *       ↓
 *   Leaflet
 *
 * Important coordinate formats:
 *
 *   Backend / ORS:
 *       [longitude, latitude]
 *
 *   Leaflet:
 *       [latitude, longitude]
 *
 * The markers use the coordinates of the optimized stops.
 * The route line uses routeGeometry returned by the Directions API.
 */

// ============================================================================
// DELIVERY MARKER
// ============================================================================

function createNumberedIcon(number) {
  return L.divIcon({
    className: "",
    html: `
      <div style="
        width: 36px;
        height: 36px;
        border-radius: 50%;
        background: #2563eb;
        color: white;
        border: 3px solid white;
        box-shadow: 0 2px 8px rgba(0,0,0,0.25);
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 14px;
        font-weight: 800;
      ">
        ${number}
      </div>
    `,
    iconSize: [36, 36],
    iconAnchor: [18, 18],
    popupAnchor: [0, -20],
  });
}


// ============================================================================
// DEPOT MARKER
// ============================================================================

const depotIcon = L.divIcon({
  className: "",
  html: `
    <div style="
      width: 40px;
      height: 40px;
      border-radius: 50%;
      background: #111827;
      color: white;
      border: 3px solid white;
      box-shadow: 0 2px 8px rgba(0,0,0,0.3);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 18px;
      font-weight: 800;
    ">
      D
    </div>
  `,
  iconSize: [40, 40],
  iconAnchor: [20, 20],
  popupAnchor: [0, -22],
});


// ============================================================================
// AUTO-FIT MAP TO ROUTE
// ============================================================================

function FitRouteBounds({ points }) {
  const map = useMap();

  React.useEffect(() => {
    if (!points.length) {
      return;
    }

    const bounds = L.latLngBounds(points);

    map.fitBounds(bounds, {
      padding: [40, 40],
    });
  }, [map, points]);

  return null;
}


// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function RouteMap({
  depot,
  stops,
  routeGeometry,
}) {
  if (!depot?.coordinates || !stops?.length) {
    return null;
  }

  // --------------------------------------------------------------------------
  // DEPOT POSITION
  // --------------------------------------------------------------------------
  //
  // Backend:
  //   [longitude, latitude]
  //
  // Leaflet:
  //   [latitude, longitude]
  // --------------------------------------------------------------------------

  const depotPosition = [
    depot.coordinates[1],
    depot.coordinates[0],
  ];


  // --------------------------------------------------------------------------
  // DELIVERY MARKER POSITIONS
  // --------------------------------------------------------------------------

  const stopPositions = stops
    .filter(
      (stop) =>
        Array.isArray(stop.coordinates) &&
        stop.coordinates.length >= 2
    )
    .map((stop) => [
      stop.coordinates[1],
      stop.coordinates[0],
    ]);


  // --------------------------------------------------------------------------
  // ACTUAL ROAD GEOMETRY
  // --------------------------------------------------------------------------
  //
  // The backend returns GeoJSON-style coordinates:
  //
  //   [longitude, latitude]
  //
  // Leaflet requires:
  //
  //   [latitude, longitude]
  //
  // We convert every point.
  // --------------------------------------------------------------------------

  const roadRoutePoints = Array.isArray(routeGeometry)
    ? routeGeometry
        .filter(
          (point) =>
            Array.isArray(point) &&
            point.length >= 2
        )
        .map((point) => [
          point[1],
          point[0],
        ])
    : [];


  // --------------------------------------------------------------------------
  // MAP BOUNDS
  // --------------------------------------------------------------------------
  //
  // Prefer the actual road geometry because it represents the entire route.
  // Add the markers as well so they are always included.
  // --------------------------------------------------------------------------

  const mapBoundsPoints =
    roadRoutePoints.length > 0
      ? [
          ...roadRoutePoints,
          depotPosition,
          ...stopPositions,
        ]
      : [
          depotPosition,
          ...stopPositions,
        ];


  return (
    <div className="mb-5 overflow-hidden rounded-2xl border border-gray-200 shadow-sm">

      <MapContainer
        center={depotPosition}
        zoom={14}
        scrollWheelZoom={true}
        className="h-[420px] w-full"
      >

        {/* ================================================================
            OPENSTREETMAP
            ================================================================ */}

        <TileLayer
          attribution="&copy; OpenStreetMap contributors"
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />


        {/* Automatically frame the complete route */}

        <FitRouteBounds
          points={mapBoundsPoints}
        />


        {/* ================================================================
            DEPOT
            ================================================================ */}

        <Marker
          position={depotPosition}
          icon={depotIcon}
        >
          <Popup>
            <div className="min-w-[190px]">

              <p className="text-xs font-bold text-gray-500">
                DEPOT
              </p>

              <p className="mt-1 text-sm font-semibold text-gray-900">
                {depot.address}
              </p>

              <p className="mt-1 text-xs text-gray-500">
                Starting point
              </p>

            </div>
          </Popup>
        </Marker>


        {/* ================================================================
            OPTIMIZED DELIVERY STOPS
            ================================================================ */}

        {stops.map((stop) => {

          if (
            !Array.isArray(stop.coordinates) ||
            stop.coordinates.length < 2
          ) {
            return null;
          }

          const position = [
            stop.coordinates[1],
            stop.coordinates[0],
          ];

          return (
            <Marker
              key={stop.stop_number}
              position={position}
              icon={createNumberedIcon(
                stop.stop_number
              )}
            >

              <Popup>

                <div className="min-w-[220px]">

                  <p className="text-xs font-bold text-blue-600">
                    DELIVERY {stop.stop_number}
                  </p>

                  <p className="mt-1 text-sm font-semibold text-gray-900">
                    {stop.address}
                  </p>

                  <div className="mt-2 space-y-1 text-xs text-gray-600">

                    <p>
                      <strong>ETA:</strong>{" "}
                      {stop.arrival_time}
                    </p>

                    <p>
                      <strong>Window:</strong>{" "}
                      {stop.time_window}
                    </p>

                  </div>

                </div>

              </Popup>

            </Marker>
          );
        })}


        {/* ================================================================
            ACTUAL DRIVING ROUTE
            ================================================================ */}
        {/*
         * This is NOT a straight line between delivery points.
         *
         * These points come from the Directions API after OR-Tools
         * selected the optimized sequence.
         */}

        {roadRoutePoints.length > 1 && (
          <Polyline
            positions={roadRoutePoints}
            pathOptions={{
              color: "#2563eb",
              weight: 5,
              opacity: 0.8,
            }}
          />
        )}

      </MapContainer>


      {/* ================================================================
          MAP LEGEND
          ================================================================ */}

      <div className="flex flex-wrap items-center gap-4 bg-white px-4 py-3 text-xs text-gray-500">

        <span className="flex items-center gap-1.5">

          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-gray-900 text-[9px] font-bold text-white">
            D
          </span>

          Depot

        </span>


        <span className="flex items-center gap-1.5">

          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-blue-600 text-[9px] font-bold text-white">
            1
          </span>

          Optimized delivery order

        </span>


        {roadRoutePoints.length > 1 && (
          <span className="flex items-center gap-1.5">

            <span className="h-1 w-6 rounded-full bg-blue-600" />

            Driving route

          </span>
        )}

      </div>

    </div>
  );
}

