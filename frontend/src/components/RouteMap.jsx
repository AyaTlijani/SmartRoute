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

function createDeliveryIcon(number) {
  return L.divIcon({
    className: "smartroute-marker",
    html: `
      <div style="
        width: 38px;
        height: 38px;
        border-radius: 50%;
        background: #2563eb;
        color: #ffffff;
        border: 3px solid #ffffff;
        box-shadow: 0 3px 10px rgba(15, 23, 42, 0.30);
        display: flex;
        align-items: center;
        justify-content: center;
        font-family: Arial, sans-serif;
        font-size: 14px;
        font-weight: 800;
        line-height: 1;
      ">${number}</div>
    `,
    iconSize: [38, 38],
    iconAnchor: [19, 19],
    popupAnchor: [0, -22],
  });
}

const depotIcon = L.divIcon({
  className: "smartroute-marker",
  html: `
    <div style="
      width: 42px;
      height: 42px;
      border-radius: 50%;
      background: #0f172a;
      color: #ffffff;
      border: 3px solid #ffffff;
      box-shadow: 0 3px 10px rgba(15, 23, 42, 0.32);
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: Arial, sans-serif;
      font-size: 15px;
      font-weight: 800;
      line-height: 1;
    ">D</div>
  `,
  iconSize: [42, 42],
  iconAnchor: [21, 21],
  popupAnchor: [0, -24],
});

function FitRouteBounds({ points }) {
  const map = useMap();

  React.useEffect(() => {
    if (!points || points.length === 0) {
      return;
    }

    const bounds = L.latLngBounds(points);

    if (!bounds.isValid()) {
      return;
    }

    map.fitBounds(bounds, {
      padding: [60, 60],
      maxZoom: 16,
      animate: false,
    });
  }, [map, points]);

  return null;
}

function coordinatesAreClose(a, b) {
  return (
    Math.abs(a[0] - b[0]) < 0.0005 &&
    Math.abs(a[1] - b[1]) < 0.0005
  );
}

function buildMarkerPositions(stops) {
  const positions = {};

  stops.forEach((stop, index) => {
    const realPosition = [
      Number(stop.coordinates[1]),
      Number(stop.coordinates[0]),
    ];

    const nearbyStops = stops.filter((other) => {
      if (other.stop_number === stop.stop_number) {
        return false;
      }

      const otherPosition = [
        Number(other.coordinates[1]),
        Number(other.coordinates[0]),
      ];

      return coordinatesAreClose(realPosition, otherPosition);
    });

    if (nearbyStops.length === 0) {
      positions[stop.stop_number] = {
        real: realPosition,
        display: realPosition,
      };
      return;
    }

    const group = [stop, ...nearbyStops]
      .filter(
        (item, itemIndex, array) =>
          array.findIndex(
            (x) => x.stop_number === item.stop_number
          ) === itemIndex
      )
      .sort(
        (a, b) =>
          Number(a.stop_number) - Number(b.stop_number)
      );

    const groupIndex = group.findIndex(
      (item) =>
        item.stop_number === stop.stop_number
    );

    const offsets = [
      [0, 0],
      [0.0007, 0.0007],
      [-0.0007, 0.0007],
      [0.0007, -0.0007],
      [-0.0007, -0.0007],
    ];

    const offset =
      offsets[groupIndex] || [
        0.0008 * Math.cos(groupIndex),
        0.0008 * Math.sin(groupIndex),
      ];

    positions[stop.stop_number] = {
      real: realPosition,
      display: [
        realPosition[0] + offset[0],
        realPosition[1] + offset[1],
      ],
    };
  });

  return positions;
}

export default function RouteMap({
  depot,
  stops,
  routeGeometry,
  straightLines = false, // geometry is an estimate, not real roads
}) {
  const hasDepot =
    Array.isArray(depot?.coordinates) &&
    depot.coordinates.length >= 2 &&
    Number.isFinite(Number(depot.coordinates[0])) &&
    Number.isFinite(Number(depot.coordinates[1]));

  const validStops = Array.isArray(stops)
    ? stops.filter(
        (stop) =>
          Array.isArray(stop?.coordinates) &&
          stop.coordinates.length >= 2 &&
          Number.isFinite(Number(stop.coordinates[0])) &&
          Number.isFinite(Number(stop.coordinates[1]))
      )
    : [];

  if (!hasDepot || validStops.length === 0) {
    return null;
  }

  const depotPosition = [
    Number(depot.coordinates[1]),
    Number(depot.coordinates[0]),
  ];

  const markerPositions = buildMarkerPositions(validStops);

  const roadRoutePoints = Array.isArray(routeGeometry)
    ? routeGeometry
        .filter(
          (point) =>
            Array.isArray(point) &&
            point.length >= 2 &&
            Number.isFinite(Number(point[0])) &&
            Number.isFinite(Number(point[1]))
        )
        .map((point) => [
          Number(point[1]),
          Number(point[0]),
        ])
    : [];

  const hasRoadRoute = roadRoutePoints.length > 1;

  const mapBoundsPoints = [
    depotPosition,
    ...validStops.map(
      (stop) =>
        markerPositions[stop.stop_number].display
    ),
    ...roadRoutePoints,
  ];

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-col gap-3 border-b border-slate-100 bg-white px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-sm font-bold text-slate-900">
            Optimized route map
          </h3>

          <p className="mt-1 text-xs text-slate-500">
            Depot → delivery stops in optimized order
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-semibold text-slate-600">
            {validStops.length}{" "}
            {validStops.length === 1
              ? "delivery"
              : "deliveries"}
          </span>

          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold ${
              hasRoadRoute
                ? "bg-emerald-50 text-emerald-700"
                : "bg-amber-50 text-amber-700"
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                hasRoadRoute
                  ? "bg-emerald-500"
                  : "bg-amber-500"
              }`}
            />

            {!hasRoadRoute
              ? "Road geometry unavailable"
              : straightLines
                ? "Stop order (straight lines)"
                : "Actual road route"}
          </span>
        </div>
      </div>

      <div className="relative">
        <MapContainer
          center={depotPosition}
          zoom={14}
          scrollWheelZoom
          zoomControl
          className="h-[430px] w-full sm:h-[500px]"
        >
          <TileLayer
            attribution="&copy; OpenStreetMap contributors"
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />

          <FitRouteBounds points={mapBoundsPoints} />

          {hasRoadRoute && (
            <>
              <Polyline
                positions={roadRoutePoints}
                pathOptions={{
                  color: "#ffffff",
                  weight: 9,
                  opacity: 0.9,
                  lineCap: "round",
                  lineJoin: "round",
                }}
              />

              <Polyline
                positions={roadRoutePoints}
                pathOptions={{
                  color: "#2563eb",
                  weight: 5,
                  opacity: 0.95,
                  lineCap: "round",
                  lineJoin: "round",
                }}
              />
            </>
          )}

          <Marker
            position={depotPosition}
            icon={depotIcon}
            zIndexOffset={3000}
          >
            <Popup>
              <div className="min-w-[220px]">
                <div className="flex items-center gap-2">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white">
                    D
                  </span>

                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
                      Starting point
                    </p>

                    <p className="text-sm font-bold text-slate-900">
                      Depot
                    </p>
                  </div>
                </div>

                <div className="mt-3 border-t border-slate-100 pt-3">
                  <p className="text-xs leading-5 text-slate-600">
                    {depot.address}
                  </p>
                </div>
              </div>
            </Popup>
          </Marker>

          {validStops.map((stop) => {
            const marker =
              markerPositions[stop.stop_number];

            const isVisuallySeparated =
              marker &&
              !coordinatesAreClose(
                marker.real,
                marker.display
              );

            return (
              <React.Fragment
                key={`delivery-${stop.stop_number}`}
              >
                {isVisuallySeparated && (
                  <Polyline
                    positions={[
                      marker.real,
                      marker.display,
                    ]}
                    pathOptions={{
                      color: "#64748b",
                      weight: 1,
                      opacity: 0.6,
                      dashArray: "3 4",
                    }}
                  />
                )}

                <Marker
                  position={marker.display}
                  icon={createDeliveryIcon(
                    stop.stop_number
                  )}
                  zIndexOffset={
                    2000 + Number(stop.stop_number)
                  }
                >
                  <Popup>
                    <div className="min-w-[240px]">
                      <div className="flex items-center gap-2">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white">
                          {stop.stop_number}
                        </span>

                        <div>
                          <p className="text-[10px] font-bold uppercase tracking-wide text-blue-600">
                            Delivery {stop.stop_number}
                          </p>

                          <p className="text-sm font-bold text-slate-900">
                            Optimized stop
                          </p>
                        </div>
                      </div>

                      <div className="mt-3 space-y-3 border-t border-slate-100 pt-3">
                        <div>
                          <p className="text-[9px] font-bold uppercase tracking-wide text-slate-400">
                            Address
                          </p>

                          <p className="mt-1 text-xs leading-5 text-slate-700">
                            {stop.address}
                          </p>
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                          <div className="rounded-lg bg-blue-50 p-2.5">
                            <p className="text-[9px] font-bold uppercase tracking-wide text-blue-500">
                              ETA
                            </p>

                            <p className="mt-1 text-xs font-bold text-blue-800">
                              {stop.arrival_time}
                            </p>
                          </div>

                          <div className="rounded-lg bg-slate-50 p-2.5">
                            <p className="text-[9px] font-bold uppercase tracking-wide text-slate-400">
                              Window
                            </p>

                            <p className="mt-1 text-xs font-semibold leading-4 text-slate-700">
                              {stop.time_window}
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </Popup>
                </Marker>
              </React.Fragment>
            );
          })}
        </MapContainer>

        {!hasRoadRoute && (
          <div className="absolute bottom-3 left-3 z-[1000] rounded-lg border border-amber-200 bg-white/95 px-3 py-2 text-[10px] font-medium text-amber-700 shadow-sm backdrop-blur">
            The optimized stops are shown, but road geometry could not be loaded.
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-slate-100 bg-slate-50 px-4 py-3">
        <span className="flex items-center gap-2 text-[10px] font-medium text-slate-500">
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-900 text-[8px] font-bold text-white">
            D
          </span>
          Depot
        </span>

        <span className="flex items-center gap-2 text-[10px] font-medium text-slate-500">
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-blue-600 text-[8px] font-bold text-white">
            1
          </span>
          Optimized delivery order
        </span>

        {hasRoadRoute && (
          <span className="flex items-center gap-2 text-[10px] font-medium text-slate-500">
            <span className="h-1 w-7 rounded-full bg-blue-600" />
            {straightLines ? "Route order" : "Actual driving route"}
          </span>
        )}
      </div>
    </div>
  );
}