import React from "react";

/**
 * RouteDisplay.jsx
 *
 * Displays the delivery sequence returned by OR-Tools.
 *
 * The frontend does NOT reorder the stops.
 * The order received from the backend is the optimized order.
 */

const SLOT_STYLES = {
  1: {
    badge: "bg-blue-100 text-blue-700",
    label: "Morning",
  },
  2: {
    badge: "bg-orange-100 text-orange-700",
    label: "Afternoon",
  },
};

export default function RouteDisplay({ route }) {
  if (!route?.route?.length) {
    return null;
  }

  const {
    total_stops,
    depot_address,
    route: stops,
  } = route;

  /*
   * The backend gives every stop the same complete Google Maps URL.
   * We only need to display it once.
   */
  const fullRouteMapsUrl = stops[0]?.maps_url;

  return (
    <section
      className="mt-6"
      aria-label="Optimised delivery route"
    >

      {/* ============================================================
          SUMMARY
          ============================================================ */}

      <div className="bg-green-50 border border-green-200 rounded-2xl p-4 mb-5">

        <div className="flex items-start gap-3">

          <span
            className="text-2xl mt-0.5"
            aria-hidden="true"
          >
            ✅
          </span>

          <div>

            <h2 className="text-base font-bold text-green-800">
              Route optimised — {total_stops}{" "}
              {total_stops === 1 ? "stop" : "stops"}
            </h2>

            <p className="text-sm text-green-700 mt-1">
              <span className="font-medium">
                Starting from:
              </span>{" "}
              {depot_address}
            </p>

            <p className="text-xs text-green-600 mt-1">
              OR-Tools selected the delivery sequence while
              respecting the requested time windows.
            </p>

          </div>

        </div>

      </div>


      {/* ============================================================
          OPTIMISED ROUTE
          ============================================================ */}

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 mb-5">

        <h3 className="text-sm font-bold text-gray-800 mb-4">
          Optimised Route
        </h3>


        <div className="space-y-0">

          {/* --------------------------------------------------------
              DEPOT
              -------------------------------------------------------- */}

          <div className="flex items-start gap-3">

            <div className="flex flex-col items-center">

              <div
                className="w-9 h-9 rounded-full bg-gray-800
                  text-white flex items-center justify-center text-sm"
              >
                📍
              </div>

              {stops.length > 0 && (
                <div className="w-0.5 h-8 bg-gray-200" />
              )}

            </div>


            <div className="pt-1 min-w-0">

              <p className="text-xs font-semibold text-gray-500">
                DEPOT
              </p>

              <p
                className="text-sm font-semibold text-gray-900"
                title={depot_address}
              >
                {depot_address}
              </p>

            </div>

          </div>


          {/* --------------------------------------------------------
              OPTIMISED DELIVERY SEQUENCE
              -------------------------------------------------------- */}

          {stops.map((stop, index) => {

            const style =
              SLOT_STYLES[stop.slot] ?? SLOT_STYLES[1];

            const isLast =
              index === stops.length - 1;

            return (
              <div
                key={stop.stop_number}
                className="flex items-start gap-3"
              >

                {/* Route number + connector */}
                <div className="flex flex-col items-center">

                  <div
                    className="w-9 h-9 rounded-full bg-blue-600
                      text-white flex items-center justify-center
                      text-sm font-bold"
                  >
                    {stop.stop_number}
                  </div>

                  {!isLast && (
                    <div className="w-0.5 h-8 bg-gray-200" />
                  )}

                </div>


                {/* Stop information */}
                <div className="pt-1 pb-4 min-w-0 flex-1">

                  <p className="text-xs font-semibold text-gray-500">
                    DELIVERY {stop.stop_number}
                  </p>

                  <p
                    className="text-sm font-semibold text-gray-900
                      leading-snug"
                    title={stop.address}
                  >
                    {stop.address}
                  </p>


                  {/* ETA + separator + time window */}
                  <div className="flex flex-wrap items-center gap-2 mt-1.5">

                    <span
                      className="inline-flex items-center gap-1
                        text-xs font-bold text-blue-700
                        bg-blue-50 rounded-full px-2 py-0.5"
                    >

                      <svg
                        className="w-3 h-3"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={2.5}
                        viewBox="0 0 24 24"
                        aria-hidden="true"
                      >
                        <circle
                          cx="12"
                          cy="12"
                          r="10"
                        />

                        <path
                          strokeLinecap="round"
                          d="M12 6v6l4 2"
                        />
                      </svg>

                      ETA {stop.arrival_time}

                    </span>


                    <span
                      className="text-xs text-gray-400"
                      aria-hidden="true"
                    >
                      •
                    </span>


                    <span
                      className={`text-xs font-semibold
                        rounded-full px-2 py-0.5 ${style.badge}`}
                    >
                      {style.label} · {stop.time_window}
                    </span>

                  </div>

                </div>

              </div>
            );
          })}

        </div>


        {/* ========================================================
            GOOGLE MAPS — COMPLETE OPTIMISED ROUTE
            ======================================================== */}

        {fullRouteMapsUrl && (

          <a
            href={fullRouteMapsUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Open the complete optimised route in Google Maps"
            className="mt-2 w-full inline-flex items-center
              justify-center gap-2 bg-green-500
              hover:bg-green-600 active:scale-95
              text-white font-bold text-sm px-4 py-3
              rounded-xl transition-all duration-150 shadow-sm"
          >

            <svg
              className="w-5 h-5"
              fill="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13
                7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0
                9.5c-1.38 0-2.5-1.12-2.5-2.5S10.62
                6.5 12 6.5 14.5 7.62 14.5 9 13.38
                11.5 12 11.5z"
              />
            </svg>

            View Full Route in Google Maps →

          </a>

        )}

      </div>


      {/* ============================================================
          FOOTER
          ============================================================ */}

      <p className="text-center text-xs text-gray-400 mt-5">
        Route computed by OR-Tools VRPTW &nbsp;•&nbsp;
        Travel times via OpenRouteService
      </p>

    </section>
  );
}