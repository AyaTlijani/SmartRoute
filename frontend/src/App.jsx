/**
 * App.jsx — SmartRoute root application component.
 *
 * Handles:
 *   - Application state
 *   - Route optimization requests
 *   - Error/loading states
 *   - SmartRoute header/footer
 */

import React, { useState } from "react";
import axios from "axios";
import AddressForm from "./components/AddressForm";
import RouteDisplay from "./components/RouteDisplay";

const API_URL =
  import.meta.env.VITE_API_URL || "http://localhost:8000";

export default function App() {
  const [route, setRoute] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  /**
   * Send the delivery request to the FastAPI backend.
   */
  const handleOptimize = async (formData) => {
    setLoading(true);
    setError(null);
    setRoute(null);

    try {
      const response = await axios.post(
        `${API_URL}/optimize-route`,
        formData
      );

      setRoute(response.data);

      // Scroll to the results after React renders them.
      setTimeout(() => {
        document
          .getElementById("results-section")
          ?.scrollIntoView({
            behavior: "smooth",
            block: "start",
          });
      }, 100);

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

  return (
    <div className="min-h-screen bg-gray-50">

      {/* ============================================================
          HEADER
          ============================================================ */}

      <header className="bg-blue-600 text-white shadow-lg sticky top-0 z-10">

        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center gap-3">

          <span
            className="text-3xl"
            aria-hidden="true"
          >
            🚚
          </span>

          <div>

            <h1 className="text-xl font-bold leading-tight tracking-tight">
              SmartRoute
            </h1>

            <p className="text-blue-200 text-xs mt-0.5">
              Intelligent Delivery Optimization
            </p>

          </div>

        </div>

      </header>


      {/* ============================================================
          MAIN CONTENT
          ============================================================ */}

      <main className="max-w-2xl mx-auto px-4 pb-16">

        {/* Delivery input form */}
        <AddressForm
          onSubmit={handleOptimize}
          loading={loading}
        />


        {/* Error message */}
        {error && (

          <div
            role="alert"
            className="mt-4 p-4 bg-red-50 border border-red-200 rounded-xl"
          >

            <p className="text-red-800 font-semibold text-sm">
              Optimisation failed
            </p>

            <pre
              className="text-red-700 text-sm mt-1
                whitespace-pre-wrap font-sans"
            >
              {error}
            </pre>

          </div>

        )}


        {/* Optimised route */}
        {route && (

          <div id="results-section">

            <RouteDisplay
              route={route}
            />

          </div>

        )}

      </main>


      {/* ============================================================
          FOOTER
          ============================================================ */}

      <footer
        className="text-center text-xs text-gray-400
          py-4 border-t border-gray-200"
      >
        SmartRoute &nbsp;•&nbsp;
        OR-Tools VRPTW &nbsp;•&nbsp;
        FastAPI + React
      </footer>

    </div>
  );
}