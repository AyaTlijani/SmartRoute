/**
 * App.jsx — SmartRoute root application.
 *
 * Provides the main dashboard shell and coordinates:
 *   - Delivery planning
 *   - Route optimization
 *   - Loading / error states
 *   - Optimization results
 *   - Route statistics
 */

import React, { useState } from "react";
import AddressForm from "../../components/AddressForm";
import RouteDisplay from "../../components/RouteDisplay";
import { api } from "../../api";
import { PageHeader } from "../../components/ui";

export default function QuickPlanner() {
  const [route, setRoute] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleOptimize = async (formData) => {
    setLoading(true);
    setError(null);
    setRoute(null);

    try {
      const response = await api.post(
        "/optimize-route",
        formData
      );

      setRoute(response.data);

      requestAnimationFrame(() => {
        setTimeout(() => {
          document
            .getElementById("results-section")
            ?.scrollIntoView({
              behavior: "smooth",
              block: "start",
            });
        }, 100);
      });
    } catch (err) {
      const detail = err.response?.data?.detail;

      setError(
        typeof detail === "string"
          ? detail
          : err.message ||
              "An unexpected error occurred. Please try again."
      );
    } finally {
      setLoading(false);
    }
  };

  const handleNewRoute = () => {
    setRoute(null);
    setError(null);

    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  };

  return (
    <div>

      {/* ============================================================
          MAIN
          ============================================================ */}

      <main>

        <PageHeader
          title="Quick planner"
          description="Plan one route from typed addresses, outside the daily workflow. Addresses are geocoded with OpenRouteService, so this needs ORS_API_KEY in backend/.env."
        />

        {/* ========================================================
            PLANNING CARD
            ======================================================== */}

        <section
          aria-labelledby="planning-title"
          className="rounded-lg border border-slate-200 bg-white
            shadow-sm"
        >

          <div className="border-b border-slate-100 px-5 py-4 sm:px-6">

            <div className="flex items-center justify-between gap-4">

              <div>

                <h2
                  id="planning-title"
                  className="text-base font-bold text-slate-900"
                >
                  Plan your route
                </h2>

                <p className="mt-1 text-xs text-slate-500">
                  Set the starting point and delivery constraints.
                </p>

              </div>

            </div>

          </div>

          <div className="p-5 sm:p-6">

            <AddressForm
              onSubmit={handleOptimize}
              loading={loading}
            />

          </div>

        </section>


        {/* ========================================================
            ERROR STATE
            ======================================================== */}

        {error && (

          <section
            role="alert"
            aria-live="assertive"
            className="mt-5 rounded-lg border border-red-200
              bg-red-50 p-5"
          >

            <div className="flex items-start gap-3">

              <div
                className="flex h-9 w-9 shrink-0 items-center
                  justify-center rounded-lg bg-red-100 text-lg"
                aria-hidden="true"
              >
                !
              </div>

              <div className="min-w-0">

                <h2 className="text-sm font-bold text-red-800">
                  Route optimization failed
                </h2>

                <p className="mt-1 text-sm leading-5 text-red-700">
                  {error}
                </p>

                <button
                  type="button"
                  onClick={() => setError(null)}
                  className="mt-3 text-xs font-semibold text-red-800
                    underline underline-offset-2"
                >
                  Dismiss
                </button>

              </div>

            </div>

          </section>

        )}


        {/* ========================================================
            LOADING STATE
            ======================================================== */}

        {loading && (

          <section
            aria-live="polite"
            className="mt-5 rounded-lg border border-blue-100
              bg-blue-50 p-5"
          >

            <div className="flex items-center gap-3">

              <div
                className="h-5 w-5 animate-spin rounded-full
                  border-2 border-blue-200 border-t-blue-600"
                aria-hidden="true"
              />

              <div>

                <p className="text-sm font-semibold text-blue-900">
                  Optimizing your route...
                </p>

                <p className="mt-0.5 text-xs text-blue-700">
                  Calculating travel times, time windows, and the
                  best delivery sequence.
                </p>

              </div>

            </div>

          </section>

        )}


        {/* ========================================================
            RESULTS
            ======================================================== */}

        {route && !loading && (

          <section
            id="results-section"
            aria-labelledby="results-title"
            className="mt-8"
          >

            <div className="mb-5 flex flex-col gap-3 sm:flex-row
              sm:items-end sm:justify-between">

              <div>

                <p className="text-sm font-semibold uppercase
                  tracking-wider text-emerald-600">
                  Optimization complete
                </p>

                <h2
                  id="results-title"
                  className="mt-1 text-2xl font-bold tracking-tight
                    text-slate-900"
                >
                  Your optimized route
                </h2>

                <p className="mt-1 text-sm text-slate-500">
                  Review the route on the map or follow the delivery
                  sequence below.
                </p>

              </div>

              <button
                type="button"
                onClick={handleNewRoute}
                className="inline-flex items-center justify-center
                  rounded-xl border border-slate-200 bg-white px-4
                  py-2.5 text-sm font-semibold text-slate-700
                  shadow-sm transition hover:bg-slate-50
                  active:scale-[0.98]"
              >
                + Plan another route
              </button>

            </div>

            <RouteDisplay route={route} />

          </section>

        )}

      </main>


    </div>
  );
}