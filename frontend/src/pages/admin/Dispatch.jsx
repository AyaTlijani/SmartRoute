import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, Inbox, RefreshCw, Route as RouteIcon, Wand2 } from "lucide-react";
import { api, dt, errorText, formatDay, toMapStop } from "../../api";
import { DayPicker, useDay } from "../../layouts/AdminLayout";
import RouteMap from "../../components/RouteMap";
import OrderDetail from "../../components/OrderDetail";
import {
  Button, CustomerBadge, EmptyState, ErrorBanner, Loading, Metric, MetricStrip, PageHeader, Panel,
  PrecisionBadge, StatusBadge, cx, useToast,
} from "../../components/ui";

export default function Dispatch() {
  const { day } = useDay();
  const toast = useToast();
  const [data, setData] = useState(null);
  const [selected, setSelected] = useState(null); // driver id or "unassigned"
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [open, setOpen] = useState(null);

  const load = () => api.get("/dispatch", { params: { day } }).then((r) => setData(r.data)).catch((e) => setError(errorText(e)));

  useEffect(() => {
    setData(null);
    load();
    const t = setInterval(load, 15000); // driver updates show up without a refresh
    return () => clearInterval(t);
  }, [day]);

  useEffect(() => {
    if (!data) return;
    const valid = selected === "unassigned" ? data.unassigned.length : data.drivers.some((d) => d.id === selected);
    if (!valid) setSelected(data.unassigned.length ? "unassigned" : data.drivers.find((d) => d.orders.length)?.id ?? data.drivers[0]?.id);
  }, [data]);

  const run = async (key, fn, message) => {
    setBusy(key);
    setError(null);
    try {
      const result = (await fn()).data;
      setData(result);
      if (message) toast(typeof message === "function" ? message(result) : message, result.assigned_now === 0 ? "warn" : "good");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  const reassign = (orderId, driverId) =>
    run(`order${orderId}`, () => api.post(`/orders/${orderId}/reassign`, { driver_id: driverId ? Number(driverId) : null }),
      driverId ? "Order moved, both routes re-optimized" : "Order moved back to unassigned");

  if (!data) return <><PageHeader title="Dispatch" actions={<DayPicker />} /><ErrorBanner error={error} /><Loading /></>;

  const all = data.drivers.flatMap((d) => d.orders);
  const total = all.length + data.unassigned.length;
  const routedCount = all.filter((o) => o.stop_number).length;
  const unscheduled = data.drivers.reduce((n, d) => n + d.stats.unscheduled, 0);
  const sources = new Set(data.drivers.filter((d) => d.route).map((d) => d.route.source));

  return (
    <>
      <PageHeader title="Dispatch"
        description={`Assign ${formatDay(day)}'s orders to drivers by zone, then optimize each route with OR-Tools.`}
        actions={<>
          <DayPicker />
          <Button variant="secondary" icon={RefreshCw} loading={busy === "reopt"} disabled={!all.length}
            onClick={() => run("reopt", () => api.post("/dispatch/reoptimize", { day }), "Routes re-optimized")}>Re-optimize</Button>
          <Button icon={Wand2} loading={busy === "assign"} disabled={!data.unassigned.length}
            onClick={() => run("assign", () => api.post("/dispatch/assign", { day }), (d) => d.assigned_now
              ? `${d.assigned_now} ${d.assigned_now === 1 ? "order" : "orders"} assigned, routes optimized`
              : "No order could be assigned: no active driver with room covers them")}>
            Assign {data.unassigned.length || ""} unassigned
          </Button>
        </>} />
      <ErrorBanner error={error} onClose={() => setError(null)} />

      {total === 0 ? (
        <Panel><EmptyState icon={Inbox} title={`No orders for ${formatDay(day)}`}
          action={<Link to="/admin/import"><Button>Import orders</Button></Link>}>
          Import the day's confirmed orders first, then come back to assign them.
        </EmptyState></Panel>
      ) : (
        <div className="space-y-5">
          <MetricStrip>
            <Metric label="Orders" value={total} />
            <Metric label="Unassigned" value={data.unassigned.length} tone={data.unassigned.length ? "warn" : undefined} />
            <Metric label="On a route" value={routedCount} detail={`${data.drivers.filter((d) => d.orders.length).length} drivers`} />
            <Metric label="Not on a route" value={unscheduled} tone={unscheduled ? "warn" : undefined} detail="Time window can't be met" />
            <Metric label="Travel times" value={sources.has("ors") ? "Road network" : "Estimated"}
              detail={sources.has("ors") ? "OpenRouteService" : "Distance-based, no API key"} />
          </MetricStrip>

          <div className="grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
            <nav aria-label="Drivers" className="space-y-1.5">
              {data.unassigned.length > 0 && (
                <button type="button" onClick={() => setSelected("unassigned")}
                  className={cx("flex w-full items-center justify-between rounded-lg border px-4 py-3 text-left",
                    selected === "unassigned" ? "border-amber-400 bg-amber-50" : "border-slate-200 bg-white hover:border-slate-300")}>
                  <span className="flex items-center gap-2 text-sm font-medium"><AlertTriangle className="h-4 w-4 text-amber-700" />Unassigned</span>
                  <span className="text-sm tabular">{data.unassigned.length}</span>
                </button>
              )}
              {data.drivers.map((d) => <DriverRow key={d.id} d={d} active={selected === d.id} onClick={() => setSelected(d.id)} />)}
            </nav>

            <div className="min-w-0">
              {selected === "unassigned" ? (
                <Panel title="Unassigned orders" description="No active driver with room covers these. Assign one by hand, or leave them for a partner courier." bodyClass="">
                  <StopTable orders={data.unassigned} drivers={data.drivers} busy={busy} onReassign={reassign} onOpen={setOpen} unassigned />
                </Panel>
              ) : (
                (() => {
                  const d = data.drivers.find((x) => x.id === selected);
                  return d ? <DriverRoute d={d} drivers={data.drivers} busy={busy} onReassign={reassign} onOpen={setOpen} /> : null;
                })()
              )}
            </div>
          </div>
        </div>
      )}
      {open && <OrderDetail orderId={open} onClose={() => setOpen(null)} onChanged={load} />}
    </>
  );
}

function DriverRow({ d, active, onClick }) {
  const done = d.stats.delivered + d.stats.failed;
  return (
    <button type="button" onClick={onClick}
      className={cx("w-full rounded-lg border px-4 py-3 text-left", active ? "border-brand bg-brand-50" : "border-slate-200 bg-white hover:border-slate-300")}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-sm font-medium">{d.name}</span>
        <span className={cx("text-[13px] tabular", d.stats.total >= d.max_orders ? "text-amber-800" : "text-ink-500")}>{d.stats.total}/{d.max_orders}</span>
      </div>
      <p className="mt-0.5 truncate text-xs text-ink-500">{d.zones.split(",").join(", ")}{!d.active && ", inactive"}</p>
      {d.stats.total > 0 && (
        <div className="mt-2 flex h-1 overflow-hidden rounded-full bg-slate-200">
          <span className="bg-emerald-600" style={{ width: `${(100 * d.stats.delivered) / d.stats.total}%` }} />
          <span className="bg-red-600" style={{ width: `${(100 * d.stats.failed) / d.stats.total}%` }} />
        </div>
      )}
      <p className="mt-1.5 text-xs tabular text-ink-500">
        {d.stats.total === 0 ? "No orders" : `${done} done${d.route ? `, ${d.route.driving_minutes} min driving` : ""}`}
        {d.stats.unscheduled > 0 && <span className="text-amber-800">, {d.stats.unscheduled} off route</span>}
      </p>
    </button>
  );
}

function DriverRoute({ d, drivers, busy, onReassign, onOpen }) {
  const r = d.route;
  const routed = d.orders.filter((o) => o.stop_number);
  const saving = r && r.baseline_minutes > r.driving_minutes ? r.baseline_minutes - r.driving_minutes : 0;
  return (
    <Panel bodyClass=""
      title={d.name}
      description={`${d.vehicle}, starts at ${d.depot_name}. Covers ${d.zones.split(",").join(", ")}.`}>
      {d.orders.length === 0 ? (
        <EmptyState icon={RouteIcon} title="No orders for this driver">Assign orders to build a route.</EmptyState>
      ) : (
        <>
          {r && (
            <div className="grid grid-cols-2 gap-x-6 gap-y-4 border-b border-slate-200 px-5 py-4 sm:grid-cols-4">
              <Metric label="Driving time" value={`${r.driving_minutes} min`} detail={`${r.distance_km} km, back at ${r.end_time}`} />
              <Metric label="Stops" value={`${routed.length}`} detail={`${d.stats.delivered} delivered, ${d.stats.failed} failed`} />
              <Metric label="Cash" value={dt(d.stats.cash_collected)} detail={`of ${dt(d.stats.cash_expected)} expected`} />
              <div>
                <p className="text-[13px] text-ink-500">Versus nearest-stop-first</p>
                <p className="mt-0.5 text-sm">
                  {r.baseline_minutes} min driving{r.baseline_late ? `, ${r.baseline_late} stop(s) late` : ", none late"}
                </p>
                <p className="mt-0.5 text-xs text-ink-500">
                  {saving ? `OR-Tools saves ${saving} min` : "Same driving time"}{r.baseline_late ? " and keeps every slot" : ""}
                </p>
              </div>
            </div>
          )}
          {routed.length > 0 && (
            <div className="border-b border-slate-200">
              <RouteMap bare height="h-[360px] lg:h-[420px]"
                depot={{ coordinates: [d.depot_lng, d.depot_lat], address: d.depot_name }}
                stops={routed.map(toMapStop)} routeGeometry={r?.geometry} straightLines={r?.source !== "ors"} />
              {r?.source !== "ors" && (
                <p className="px-5 py-2 text-xs text-ink-500">
                  Lines connect stops in route order; they are not roads. Travel times are estimated from distance.
                  Add an OpenRouteService key for road routes.
                </p>
              )}
            </div>
          )}
          <StopTable orders={d.orders} drivers={drivers} busy={busy} onReassign={onReassign} onOpen={onOpen} />
        </>
      )}
    </Panel>
  );
}

function eligibleDrivers(order, drivers) {
  return drivers.filter((d) =>
    d.id === order.driver_id ||
    (d.active && d.zones.split(",").includes(order.governorate) && d.stats.total < d.max_orders));
}

function StopTable({ orders, drivers, busy, onReassign, onOpen, unassigned }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] text-left text-sm">
        <thead className="border-b border-slate-200 text-[13px] text-ink-500">
          <tr>
            {!unassigned && <th className="w-14 px-5 py-2.5 font-medium">Stop</th>}
            {!unassigned && <th className="py-2.5 pr-3 font-medium">ETA</th>}
            <th className={cx("py-2.5 pr-3 font-medium", unassigned && "pl-5")}>Customer</th>
            <th className="py-2.5 pr-3 font-medium">Location</th>
            <th className="py-2.5 pr-3 text-right font-medium">COD</th>
            <th className="py-2.5 pr-3 font-medium">Status</th>
            <th className="py-2.5 pr-5 font-medium">Driver</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {orders.map((o) => {
            const options = eligibleDrivers(o, drivers);
            return (
              <tr key={o.id} className={cx("align-top", o.unscheduled_reason && "bg-amber-50/60")}>
                {!unassigned && <td className="px-5 py-3 text-base font-semibold tabular">{o.stop_number ?? "–"}</td>}
                {!unassigned && (
                  <td className="whitespace-nowrap py-3 pr-3 tabular">{o.eta || "–"}<span className="block text-[13px] text-ink-500">{o.slot_label}</span></td>
                )}
                <td className={cx("py-3 pr-3", unassigned && "pl-5")}>
                  <button type="button" onClick={() => onOpen(o.id)} className="text-left font-medium hover:text-brand">{o.customer_name}</button>
                  <div className="mt-1"><CustomerBadge order={o} /></div>
                </td>
                <td className="py-3 pr-3">
                  {o.city || o.governorate}
                  <span className="block text-[13px] text-ink-500">{o.governorate}</span>
                  <div className="mt-1"><PrecisionBadge precision={o.location_precision} /></div>
                </td>
                <td className="whitespace-nowrap py-3 pr-3 text-right tabular">{dt(o.cod_amount)}</td>
                <td className="max-w-[260px] py-3 pr-3">
                  <StatusBadge status={o.status} />
                  {o.fail_reason && <span className="mt-1 block text-[13px] text-red-800">{o.fail_reason}</span>}
                  {o.unscheduled_reason && <span className="mt-1 block text-[13px] text-amber-900">{o.unscheduled_reason}</span>}
                  {unassigned && <span className="mt-1 block text-[13px] text-ink-500">{o.reason}</span>}
                  {o.retry_order_id && <span className="mt-1 block text-[13px] text-ink-500">Retry scheduled</span>}
                </td>
                <td className="py-3 pr-5">
                  {o.status === "pending" || o.status === "assigned" ? (
                    <select value={o.driver_id || ""} disabled={busy === `order${o.id}`}
                      onChange={(e) => onReassign(o.id, e.target.value)} aria-label={`Driver for ${o.customer_name}`}
                      className="w-44 rounded-md border border-slate-300 bg-white px-2 py-1.5 text-[13px]">
                      <option value="">Unassigned</option>
                      {options.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                    </select>
                  ) : (
                    <span className="text-[13px] text-ink-500">Finished</span>
                  )}
                  {(o.status === "pending" || o.status === "assigned") && options.filter((d) => d.id !== o.driver_id).length === 0 && (
                    <span className="mt-1 block text-xs text-ink-500">No other eligible driver</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

