import React from "react";
import RouteMap from "./RouteMap";

/**
 * RouteDisplay.jsx
 *
 * Complete optimized-route results view.
 *
 * Displays:
 *   - Optimization status
 *   - Real route statistics
 *   - Actual road map
 *   - Depot → delivery timeline
 *   - ETA + time windows
 *   - Google Maps navigation
 */

const SLOT_STYLES = {
  1: {
    badge: "bg-blue-50 text-blue-700 border-blue-100",
    dot: "bg-blue-500",
    label: "Morning",
  },
  2: {
    badge: "bg-orange-50 text-orange-700 border-orange-100",
    dot: "bg-orange-500",
    label: "Afternoon",
  },
};

function StatCard({ label, value, detail, icon }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-slate-500">
            {label}
          </p>

          <p className="mt-1 text-xl font-bold tracking-tight text-slate-900">
            {value}
          </p>

          {detail && (
            <p className="mt-0.5 text-xs text-slate-400">
              {detail}
            </p>
          )}
        </div>

        <div
          className="flex h-9 w-9 shrink-0 items-center justify-center
            rounded-lg bg-slate-50 text-base"
          aria-hidden="true"
        >
          {icon}
        </div>
      </div>
    </div>
  );
}

function RouteConnector() {
  return (
    <div
      className="ml-[17px] h-8 w-px bg-blue-200"
      aria-hidden="true"
    />
  );
}

function formatMinutes(minutes) {
  if (!Number.isFinite(minutes) || minutes < 0) {
    return "—";
  }

  const rounded = Math.round(minutes);

  if (rounded < 60) {
    return `${rounded} min`;
  }

  const hours = Math.floor(rounded / 60);
  const remaining = rounded % 60;

  if (remaining === 0) {
    return `${hours}h`;
  }

  return `${hours}h ${remaining}m`;
}

function formatDistance(distance) {
  if (!Number.isFinite(distance) || distance < 0) {
    return "—";
  }

  return `${distance.toFixed(2)} km`;
}

export default function RouteDisplay({ route }) {
  if (!route?.route?.length) {
    return null;
  }

  const {
    total_stops,
    depot_address,
    depot_coordinates,
    route: stops,
    route_geometry,
    metrics,
  } = route;

  const fullRouteMapsUrl = stops[0]?.maps_url;

  const hasRoadGeometry =
    Array.isArray(route_geometry) &&
    route_geometry.length > 1;

  const totalDistance = Number(
    metrics?.total_distance_km
  );

  const drivingMinutes = Number(
    metrics?.total_driving_minutes
  );

  const serviceMinutes = Number(
    metrics?.total_service_minutes
  );

  const totalRouteMinutes = Number(
    metrics?.total_route_minutes
  );

  return (
    <section
      className="space-y-5"
      aria-label="Optimized delivery route"
    >

      {/* ============================================================
          SUCCESS HEADER
          ============================================================ */}

      <div
        className="overflow-hidden rounded-2xl border
          border-emerald-200 bg-white"
      >
        <div
          className="border-b border-emerald-100
            bg-emerald-50 p-5"
        >
          <div className="flex items-start gap-3">

            <div
              className="flex h-10 w-10 shrink-0 items-center
                justify-center rounded-full bg-emerald-100
                text-lg text-emerald-700"
              aria-hidden="true"
            >
              ✓
            </div>

            <div className="min-w-0">

              <div className="flex flex-wrap items-center gap-2">

                <h3 className="text-base font-bold text-emerald-900">
                  Route successfully optimized
                </h3>

                <span
                  className="rounded-full bg-emerald-100 px-2
                    py-0.5 text-[10px] font-bold uppercase
                    tracking-wide text-emerald-700"
                >
                  Feasible
                </span>

              </div>

              <p className="mt-1 text-sm leading-5 text-emerald-700">
                SmartRoute found a delivery sequence that respects
                the requested time windows.
              </p>

            </div>

          </div>
        </div>

        <div className="p-5">

          <div className="flex items-start gap-3">

            <div
              className="flex h-9 w-9 shrink-0 items-center
                justify-center rounded-lg bg-slate-900
                text-sm font-bold text-white"
              aria-hidden="true"
            >
              D
            </div>

            <div className="min-w-0">

              <p
                className="text-xs font-bold uppercase
                  tracking-wide text-slate-400"
              >
                Starting point
              </p>

              <p className="mt-1 text-sm font-semibold text-slate-900">
                {depot_address}
              </p>

            </div>

          </div>

        </div>
      </div>


      {/* ============================================================
          REAL ROUTE STATISTICS
          ============================================================ */}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">

        <StatCard
          label="Distance"
          value={formatDistance(totalDistance)}
          detail="Actual driving route"
          icon="↔"
        />

        <StatCard
          label="Driving time"
          value={formatMinutes(drivingMinutes)}
          detail="Estimated road time"
          icon="🚗"
        />

        <StatCard
          label="Route time"
          value={formatMinutes(totalRouteMinutes)}
          detail={
            Number.isFinite(serviceMinutes)
              ? `${formatMinutes(serviceMinutes)} service`
              : "Driving + service"
          }
          icon="◷"
        />

        <StatCard
          label="Deliveries"
          value={total_stops}
          detail={
            total_stops === 1
              ? "delivery stop"
              : "delivery stops"
          }
          icon="📦"
        />

      </div>


      {/* ============================================================
          ROUTE BREAKDOWN
          ============================================================ */}

      <div
        className="rounded-2xl border border-slate-200
          bg-white p-5"
      >

        <div className="mb-4">

          <h3 className="text-base font-bold text-slate-900">
            Route summary
          </h3>

          <p className="mt-0.5 text-xs text-slate-500">
            Metrics calculated from the final optimized road route.
          </p>

        </div>

        <div className="grid gap-3 sm:grid-cols-3">

          <div
            className="rounded-xl bg-slate-50 p-4"
          >
            <p
              className="text-[10px] font-bold uppercase
                tracking-wide text-slate-400"
            >
              Distance
            </p>

            <p className="mt-1 text-lg font-bold text-slate-900">
              {formatDistance(totalDistance)}
            </p>

            <p className="mt-1 text-xs text-slate-500">
              Depot to final delivery
            </p>
          </div>

          <div
            className="rounded-xl bg-slate-50 p-4"
          >
            <p
              className="text-[10px] font-bold uppercase
                tracking-wide text-slate-400"
            >
              Driving
            </p>

            <p className="mt-1 text-lg font-bold text-slate-900">
              {formatMinutes(drivingMinutes)}
            </p>

            <p className="mt-1 text-xs text-slate-500">
              Estimated road travel
            </p>
          </div>

          <div
            className="rounded-xl bg-slate-50 p-4"
          >
            <p
              className="text-[10px] font-bold uppercase
                tracking-wide text-slate-400"
            >
              Service
            </p>

            <p className="mt-1 text-lg font-bold text-slate-900">
              {formatMinutes(serviceMinutes)}
            </p>

            <p className="mt-1 text-xs text-slate-500">
              {total_stops} × 10 min delivery service
            </p>
          </div>

        </div>

      </div>


      {/* ============================================================
          MAP
          ============================================================ */}

      <div>

        <div className="mb-3 flex items-end justify-between gap-3">

          <div>

            <h3 className="text-base font-bold text-slate-900">
              Route map
            </h3>

            <p className="mt-0.5 text-xs text-slate-500">
              Follow the optimized sequence from the depot to the
              final delivery.
            </p>

          </div>

          <span
            className="hidden rounded-full bg-slate-100 px-2.5 py-1
              text-[10px] font-semibold text-slate-500 sm:block"
          >
            {hasRoadGeometry
              ? "Driving route"
              : "Location overview"}
          </span>

        </div>

        <RouteMap
          depot={{
            address: depot_address,
            coordinates: depot_coordinates,
          }}
          stops={stops}
          routeGeometry={route_geometry}
        />

      </div>


      {/* ============================================================
          DELIVERY TIMELINE
          ============================================================ */}

      <div
        className="rounded-2xl border border-slate-200
          bg-white p-5"
      >

        <div className="mb-5 flex items-end justify-between gap-3">

          <div>

            <h3 className="text-base font-bold text-slate-900">
              Optimized delivery sequence
            </h3>

            <p className="mt-0.5 text-xs text-slate-500">
              OR-Tools selected this order while respecting
              the delivery time windows.
            </p>

          </div>

          <span className="text-xs font-medium text-slate-400">
            {total_stops}{" "}
            {total_stops === 1 ? "stop" : "stops"}
          </span>

        </div>


        <div>

          {/* --------------------------------------------------------
              DEPOT
              -------------------------------------------------------- */}

          <div className="flex items-start gap-3">

            <div
              className="flex h-9 w-9 shrink-0 items-center
                justify-center rounded-full bg-slate-900
                text-xs font-bold text-white"
            >
              D
            </div>

            <div className="min-w-0 flex-1 pt-0.5">

              <p
                className="text-[10px] font-bold uppercase
                  tracking-wide text-slate-400"
              >
                Start
              </p>

              <p
                className="mt-1 text-sm font-semibold
                  leading-5 text-slate-900"
              >
                {depot_address}
              </p>

            </div>

          </div>


          <RouteConnector />


          {/* --------------------------------------------------------
              DELIVERIES
              -------------------------------------------------------- */}

          {stops.map((stop, index) => {

            const style =
              SLOT_STYLES[stop.slot] ?? SLOT_STYLES[1];

            const isLast =
              index === stops.length - 1;

            return (
              <React.Fragment key={stop.stop_number}>

                <div className="flex items-start gap-3">

                  <div
                    className="flex h-9 w-9 shrink-0 items-center
                      justify-center rounded-full bg-blue-600
                      text-xs font-bold text-white shadow-sm"
                  >
                    {stop.stop_number}
                  </div>

                  <div className="min-w-0 flex-1">

                    <div
                      className="flex flex-wrap items-start
                        justify-between gap-2"
                    >

                      <div className="min-w-0">

                        <p
                          className="text-[10px] font-bold
                            uppercase tracking-wide text-blue-600"
                        >
                          Delivery {stop.stop_number}
                        </p>

                        <p
                          className="mt-1 text-sm font-semibold
                            leading-5 text-slate-900"
                          title={stop.address}
                        >
                          {stop.address}
                        </p>

                      </div>


                      <div
                        className="shrink-0 rounded-lg bg-blue-50
                          px-2.5 py-1.5 text-right"
                      >

                        <p
                          className="text-[9px] font-bold uppercase
                            tracking-wide text-blue-500"
                        >
                          ETA
                        </p>

                        <p className="text-sm font-bold text-blue-700">
                          {stop.arrival_time}
                        </p>

                      </div>

                    </div>


                    <div className="mt-2 flex flex-wrap gap-2">

                      <span
                        className={`inline-flex items-center gap-1.5
                          rounded-full border px-2.5 py-1 text-[10px]
                          font-semibold ${style.badge}`}
                      >

                        <span
                          className={`h-1.5 w-1.5 rounded-full ${style.dot}`}
                          aria-hidden="true"
                        />

                        {style.label}

                      </span>


                      <span
                        className="rounded-full border border-slate-100
                          bg-slate-50 px-2.5 py-1 text-[10px]
                          font-medium text-slate-500"
                      >
                        {stop.time_window}
                      </span>

                    </div>

                  </div>

                </div>

                {!isLast && <RouteConnector />}

              </React.Fragment>
            );
          })}

        </div>

      </div>


      {/* ============================================================
          NAVIGATION
          ============================================================ */}

      {fullRouteMapsUrl && (

        <div
          className="rounded-2xl border border-slate-200
            bg-slate-900 p-5"
        >

          <div
            className="flex flex-col gap-4 sm:flex-row
              sm:items-center sm:justify-between"
          >

            <div>

              <p className="text-sm font-bold text-white">
                Ready to drive?
              </p>

              <p className="mt-1 text-xs leading-5 text-slate-400">
                Open the complete optimized sequence in Google Maps
                for turn-by-turn navigation.
              </p>

            </div>


            <a
              href={fullRouteMapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex shrink-0 items-center
                justify-center gap-2 rounded-xl bg-white
                px-4 py-3 text-sm font-bold text-slate-900
                transition hover:bg-slate-100
                active:scale-[0.98]"
            >

              <svg
                className="h-4 w-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M15 3h6v6M10 14L21 3"
                />

                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M18 13v5a2 2 0 01-2 2H6a2 2 0 01-2-2V8a2 2 0 012-2h5"
                />
              </svg>

              Open in Google Maps

            </a>

          </div>

        </div>

      )}


      {/* ============================================================
          TECHNICAL FOOTER
          ============================================================ */}

      <div
        className="flex flex-wrap items-center justify-center
          gap-x-2 gap-y-1 text-center text-[10px] text-slate-400"
      >

        <span>OR-Tools VRPTW</span>

        <span aria-hidden="true">•</span>

        <span>OpenRouteService</span>

        <span aria-hidden="true">•</span>

        <span>FastAPI</span>

        <span aria-hidden="true">•</span>

        <span>React + Leaflet</span>

      </div>

    </section>
  );
}