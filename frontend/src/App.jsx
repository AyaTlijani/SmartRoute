/**
 * App.jsx — SmartRoute shell.
 *
 * Simple hash routing (no router library):
 *   #/import     admin uploads the day's Excel file
 *   #/dispatch   assign orders to drivers, see routes and statuses
 *   #/driver/3   phone view for driver 3
 *   #/analytics  delivery performance
 *   #/planner    the original address-based route planner
 */

import React, { useEffect, useState } from "react";
import ImportView from "./components/ImportView";
import DispatchView from "./components/DispatchView";
import DriverView from "./components/DriverView";
import AnalyticsView from "./components/AnalyticsView";
import QuickPlanner from "./components/QuickPlanner";
import { todayISO } from "./api";

const TABS = [
  ["import", "1 · Import"],
  ["dispatch", "2 · Dispatch"],
  ["driver", "3 · Driver app"],
  ["analytics", "Analytics"],
  ["planner", "Quick planner"],
];

function readHash() {
  const [, page = "import", arg] = window.location.hash.split("/");
  return { page: TABS.some(([k]) => k === page) ? page : "import", arg };
}

export default function App() {
  const [route, setRoute] = useState(readHash);
  const [day, setDay] = useState(todayISO);

  useEffect(() => {
    const onHash = () => setRoute(readHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const go = (page, arg) => {
    window.location.hash = arg ? `/${page}/${arg}` : `/${page}`;
  };

  // The driver app is a full-screen phone layout.
  if (route.page === "driver") {
    return <DriverView driverId={route.arg} day={day} go={go} />;
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="sticky top-0 z-[1100] border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 text-xl" aria-hidden="true">
              🚚
            </div>
            <div>
              <h1 className="text-base font-bold leading-tight">SmartRoute</h1>
              <p className="text-[11px] font-medium text-slate-500">Delivery dispatch · Tunisia</p>
            </div>
          </div>

          <nav className="order-3 -mx-1 flex w-full gap-1 overflow-x-auto sm:order-none sm:w-auto">
            {TABS.map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => go(key)}
                className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm font-semibold transition ${
                  route.page === key ? "bg-blue-50 text-blue-700" : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                {label}
              </button>
            ))}
          </nav>

          {route.page !== "planner" && route.page !== "analytics" && (
            <label className="ml-auto flex items-center gap-2 text-xs font-semibold text-slate-500">
              Delivery day
              <input
                type="date"
                value={day}
                onChange={(e) => e.target.value && setDay(e.target.value)}
                className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm text-slate-800"
              />
            </label>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 pb-16 pt-6 sm:px-6 lg:px-8">
        {route.page === "import" && <ImportView day={day} go={go} />}
        {route.page === "dispatch" && <DispatchView day={day} go={go} />}
        {route.page === "analytics" && <AnalyticsView />}
        {route.page === "planner" && <QuickPlanner />}
      </main>

      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-col gap-1 px-4 py-4 text-xs text-slate-400 sm:flex-row sm:justify-between sm:px-6 lg:px-8">
          <p>SmartRoute · demo data is generated, not real customers</p>
          <p>FastAPI · OR-Tools · SQLite · React · Leaflet</p>
        </div>
      </footer>
    </div>
  );
}
