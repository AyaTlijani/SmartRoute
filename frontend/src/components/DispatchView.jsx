import React, { useEffect, useState } from "react";
import { API_URL, api, dt, errorText, toMapStop } from "../api";
import RouteMap from "./RouteMap";
import { Badge, Button, Card, CustomerBadge, ErrorBox, Spinner, Stat } from "./ui";

export default function DispatchView({ day, go }) {
  const [data, setData] = useState(null);
  const [selected, setSelected] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [retried, setRetried] = useState({});

  const load = () =>
    api.get("/dispatch", { params: { day } })
      .then((r) => setData(r.data))
      .catch((err) => setError(errorText(err)));

  useEffect(() => {
    setData(null);
    load();
    // Light polling so driver updates show up without refreshing.
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [day]);

  useEffect(() => {
    if (data && !data.drivers.some((d) => d.id === selected)) {
      const first = data.drivers.find((d) => d.orders.length) || data.drivers[0];
      setSelected(first?.id ?? null);
    }
  }, [data]);

  const run = async (fn) => {
    setBusy(true);
    setError(null);
    try {
      setData((await fn()).data);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const assign = () => run(() => api.post("/dispatch/assign", { day }));
  const reassign = (orderId, driverId) =>
    run(() => api.post(`/orders/${orderId}/reassign`, { driver_id: driverId ? Number(driverId) : null }));
  const retry = async (orderId) => {
    try {
      await api.post(`/orders/${orderId}/retry-tomorrow`);
      setRetried((r) => ({ ...r, [orderId]: true }));
    } catch (err) {
      setError(errorText(err));
    }
  };

  if (!data) {
    return <p className="flex items-center gap-2 text-sm text-slate-500"><Spinner /> Loading…</p>;
  }

  const all = data.drivers.flatMap((d) => d.orders);
  const count = (s) => all.filter((o) => o.status === s).length;
  const driver = data.drivers.find((d) => d.id === selected);
  const routed = driver ? driver.orders.filter((o) => o.stop_number) : [];
  const total = all.length + data.unassigned.length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wider text-blue-600">Step 2</p>
          <h2 className="mt-1 text-2xl font-bold tracking-tight">Dispatch</h2>
          <p className="mt-1 max-w-2xl text-sm text-slate-600">
            Each order goes to a driver who covers its governorate, balancing load and keeping
            stops close together. OR-Tools then orders each driver's stops within their time slots.
          </p>
        </div>
        <Button onClick={assign} disabled={busy || data.unassigned.length === 0 && all.length === 0}>
          {busy ? <><Spinner /> Optimizing routes…</> : "Assign & optimize routes"}
        </Button>
      </div>

      <ErrorBox error={error} onClose={() => setError(null)} />

      {total === 0 ? (
        <Card>
          <p className="text-sm text-slate-600">
            No orders for {day}.{" "}
            <button type="button" className="font-semibold text-blue-700 underline" onClick={() => go("import")}>
              Import the day's Excel file
            </button>{" "}
            first.
          </p>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <Stat label="Orders" value={total} />
            <Stat label="Unassigned" value={data.unassigned.length} tone={data.unassigned.length ? "amber" : "slate"} />
            <Stat label="To deliver" value={count("assigned")} tone="blue" />
            <Stat label="Delivered" value={count("delivered")} tone="green" />
            <Stat label="Failed" value={count("failed")} tone="red" />
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {data.drivers.map((d) => {
              const done = d.stats.delivered + d.stats.failed;
              return (
                <button key={d.id} type="button" onClick={() => setSelected(d.id)}
                  className={`rounded-2xl border bg-white p-4 text-left shadow-sm transition ${selected === d.id ? "border-blue-500 ring-2 ring-blue-100" : "border-slate-200 hover:border-slate-300"}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-bold">{d.name}</p>
                      <p className="text-xs text-slate-500">{d.zones.split(",").join(" · ")} · {d.vehicle}</p>
                    </div>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold tabular-nums text-slate-700">
                      {d.stats.total}/{d.max_orders}
                    </span>
                  </div>
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100" title={`${done} of ${d.stats.total} stops finished`}>
                    <div className="h-full rounded-full bg-emerald-500" style={{ width: `${d.stats.total ? (100 * done) / d.stats.total : 0}%` }} />
                  </div>
                  <p className="mt-2 text-xs text-slate-600 tabular-nums">
                    {done}/{d.stats.total} done · {d.route.distance_km} km · {d.route.driving_minutes} min driving
                  </p>
                  {d.stats.unrouted > 0 && (
                    <p className="mt-1 text-xs font-semibold text-amber-700">{d.stats.unrouted} stop(s) don't fit their time slot</p>
                  )}
                </button>
              );
            })}
          </div>

          {driver && (
            <Card
              title={`${driver.name}'s route`}
              subtitle={`Starts at ${driver.depot_name} · cash to collect ${dt(driver.stats.cash_expected)} · collected ${dt(driver.stats.cash_collected)}`}
              actions={<Button variant="secondary" onClick={() => go("driver", driver.id)}>Open driver app ↗</Button>}
            >
              {routed.length > 0 ? (
                <>
                  <RouteMap
                    depot={{ coordinates: [driver.depot_lng, driver.depot_lat], address: driver.depot_name }}
                    stops={routed.map(toMapStop)}
                    routeGeometry={driver.route.geometry}
                    straightLines={driver.route.source !== "ors"}
                  />
                  {driver.route.source === "estimate" && (
                    <p className="mt-2 text-xs text-slate-500">
                      Driving times are estimated from distance and the line connects stops directly.
                      Add an OpenRouteService key for real road routes.
                    </p>
                  )}
                </>
              ) : (
                <p className="text-sm text-slate-500">No stops to route yet. Click “Assign & optimize routes”.</p>
              )}

              {driver.orders.length > 0 && (
                <div className="mt-4 overflow-x-auto">
                  <OrderTable orders={driver.orders} drivers={data.drivers} onReassign={reassign} onRetry={retry} retried={retried} />
                </div>
              )}
            </Card>
          )}

          {data.unassigned.length > 0 && (
            <Card title={`Unassigned (${data.unassigned.length})`} subtitle="No available driver covers these. Pick one by hand, or leave them for a partner courier.">
              <div className="overflow-x-auto">
                <OrderTable orders={data.unassigned} drivers={data.drivers} onReassign={reassign} showReason />
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function OrderTable({ orders, drivers, onReassign, onRetry, retried = {}, showReason }) {
  return (
    <table className="w-full min-w-[760px] text-left text-sm">
      <thead className="text-[11px] uppercase tracking-wide text-slate-500">
        <tr className="border-b border-slate-200">
          <th className="py-2 pr-2">#</th>
          <th className="py-2 pr-2">ETA</th>
          <th className="py-2 pr-2">Customer</th>
          <th className="py-2 pr-2">Location</th>
          <th className="py-2 pr-2 text-right">Cash</th>
          <th className="py-2 pr-2">Status</th>
          <th className="py-2">Action</th>
        </tr>
      </thead>
      <tbody>
        {orders.map((o) => (
          <tr key={o.id} className="border-b border-slate-100 align-top">
            <td className="py-2 pr-2 font-bold tabular-nums">{o.stop_number ?? "—"}</td>
            <td className="py-2 pr-2 tabular-nums">
              {o.eta || "—"}
              <span className="block text-xs text-slate-500">{o.slot_label}</span>
            </td>
            <td className="py-2 pr-2">
              <p className="font-medium">{o.customer_name}</p>
              <CustomerBadge order={o} />
            </td>
            <td className="py-2 pr-2">
              {o.city || o.governorate}
              <span className="block text-xs text-slate-500">{showReason ? o.reason : o.address}</span>
            </td>
            <td className="py-2 pr-2 text-right tabular-nums">{dt(o.cod_amount)}</td>
            <td className="py-2 pr-2">
              <Badge kind={o.status} />
              {o.status === "assigned" && !o.stop_number && !showReason && (
                <span className="block text-[11px] text-amber-700">Doesn't fit slot</span>
              )}
              {o.fail_reason && <span className="block text-[11px] text-rose-700">{o.fail_reason}</span>}
            </td>
            <td className="py-2 text-xs">
              {(o.status === "assigned" || o.status === "pending") && (
                <select value={o.driver_id || ""} onChange={(e) => onReassign(o.id, e.target.value)}
                  className="rounded-lg border border-slate-200 px-2 py-1 text-xs" aria-label="Driver">
                  <option value="">Unassigned</option>
                  {drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              )}
              {o.status === "failed" && retried[o.id] && <span className="text-slate-500">Moved to tomorrow</span>}
              {o.status === "failed" && onRetry && !retried[o.id] && (
                <button type="button" onClick={() => onRetry(o.id)} className="font-semibold text-blue-700 underline">
                  Retry tomorrow
                </button>
              )}
              {o.photo_path && (
                <a href={`${API_URL}/photos/${o.photo_path}`} target="_blank" rel="noreferrer" className="font-semibold text-blue-700 underline">
                  Proof photo
                </a>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
