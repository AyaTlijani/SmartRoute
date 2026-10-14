import React, { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AlertTriangle, Banknote, Inbox, Lock, Route as RouteIcon, Wand2 } from "lucide-react";
import { api, dt, errorText, formatDay, toMapStop } from "../../api";
import { DayPicker, useDay } from "../../layouts/AdminLayout";
import RouteMap from "../../components/RouteMap";
import OrderDetail from "../../components/OrderDetail";
import {
  Button, CustomerBadge, DayStateBadge, EmptyState, ErrorBanner, Input, Loading, Metric, MetricStrip, Modal,
  PageHeader, Panel, PrecisionBadge, StatusBadge, cx, dayStateOf, useToast,
} from "../../components/ui";

const MODES = [
  ["zones", "Zone rule", "Each order goes to the least-loaded nearby driver who covers its governorate. Predictable and easy to adjust by hand."],
  ["optimizer", "Fleet optimizer", "One OR-Tools model picks drivers and stop order together to minimize total driving, within zones, capacity and time slots."],
];

export default function Dispatch() {
  const { day } = useDay();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [open, setOpen] = useState(null);
  const [planning, setPlanning] = useState(false);
  const selected = params.get("driver") === "unassigned" ? "unassigned" : Number(params.get("driver")) || null;
  const select = (id) => setParams(id ? { driver: String(id) } : {}, { replace: true });

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
    if (!valid) select(data.unassigned.length ? "unassigned" : data.drivers.find((d) => d.orders.length)?.id ?? data.drivers[0]?.id);
  }, [data]);

  const run = async (key, fn, message) => {
    setBusy(key);
    setError(null);
    try {
      const result = (await fn()).data;
      setData(result);
      if (message) toast(typeof message === "function" ? message(result) : message);
      return result;
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  const plan = (mode) => {
    setPlanning(false);
    run("plan", () => api.post("/dispatch/plan", { day, mode }), (r) =>
      `Planned with the ${mode === "optimizer" ? "fleet optimizer" : "zone rule"}: ${r.summary.assigned} orders on routes, ` +
      `${r.summary.total_driving_minutes} min total driving${r.summary.unassigned ? `, ${r.summary.unassigned} not served` : ""}`);
  };

  const reassign = (orderId, driverId) =>
    run(`order${orderId}`, () => api.post(`/orders/${orderId}/reassign`, { driver_id: driverId ? Number(driverId) : null }),
      driverId ? "Order moved; both routes re-planned" : "Order moved back to unassigned");

  if (!data) return <><PageHeader title="Dispatch" actions={<DayPicker />} /><ErrorBanner error={error} /><Loading /></>;

  const all = data.drivers.flatMap((d) => d.orders);
  const total = all.length + data.unassigned.length;
  const routed = all.filter((o) => o.stop_number).length;
  const unscheduled = data.drivers.reduce((n, d) => n + d.stats.unscheduled, 0);
  const totalDriving = data.drivers.reduce((n, d) => n + (d.route?.driving_minutes || 0), 0);
  const onRoad = data.drivers.filter((d) => dayStateOf(d.day_state) !== "not_started").length;
  const sources = new Set(data.drivers.filter((d) => d.route).map((d) => d.route.source));
  const openOrders = all.some((o) => o.status === "assigned") || data.unassigned.length > 0;

  return (
    <>
      <PageHeader title="Dispatch"
        description={`Assign ${formatDay(day)}'s orders to drivers and sequence every route with OR-Tools.`}
        actions={<>
          <DayPicker />
          {data.editable && (
            <Button icon={Wand2} loading={busy === "plan"} disabled={!openOrders} onClick={() => setPlanning(true)}>Plan routes</Button>
          )}
        </>} />
      <ErrorBanner error={error} onClose={() => setError(null)} />
      {!data.editable && (
        <p className="mb-4 flex items-center gap-2 rounded-md border border-slate-200 bg-white px-4 py-2.5 text-sm text-ink-700">
          <Lock className="h-4 w-4 text-ink-500" /> Past day: read-only. You can review routes and confirm cash handovers.
        </p>
      )}

      {total === 0 ? (
        <Panel><EmptyState icon={Inbox} title={`No orders for ${formatDay(day)}`}
          action={data.editable && <Link to="/admin/import"><Button>Import orders</Button></Link>}>
          {data.editable ? "Import the day's confirmed orders first, then plan the routes here." : "Nothing was delivered on this day."}
        </EmptyState></Panel>
      ) : (
        <div className="space-y-5">
          <MetricStrip>
            <Metric label="Orders" value={total} detail={`${routed} on a route`} />
            <Metric label="Unassigned" value={data.unassigned.length} tone={data.unassigned.length ? "warn" : undefined} />
            <Metric label="Off route" value={unscheduled} tone={unscheduled ? "warn" : undefined} detail="Time slot can't be met" />
            <Metric label="Total driving" value={`${totalDriving} min`} detail={`${onRoad} of ${data.drivers.length} drivers started`} />
            <Metric label="Travel times" value={sources.has("ors") ? "Road network" : "Estimated"}
              detail={sources.has("ors") ? "OpenRouteService" : "Distance-based, no API key"} />
          </MetricStrip>

          <div className="grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
            <nav aria-label="Drivers" className="space-y-1.5">
              {data.unassigned.length > 0 && (
                <button type="button" onClick={() => select("unassigned")}
                  className={cx("flex w-full items-center justify-between rounded-lg border px-4 py-3 text-left",
                    selected === "unassigned" ? "border-amber-400 bg-amber-50" : "border-slate-200 bg-white hover:border-slate-300")}>
                  <span className="flex items-center gap-2 text-sm font-medium"><AlertTriangle className="h-4 w-4 text-amber-700" />Unassigned</span>
                  <span className="text-sm tabular">{data.unassigned.length}</span>
                </button>
              )}
              {data.drivers.map((d) => <DriverRow key={d.id} d={d} active={selected === d.id} onClick={() => select(d.id)} />)}
            </nav>

            <div className="min-w-0">
              {selected === "unassigned" ? (
                <Panel title="Unassigned orders" description="Each one says why. Assign by hand, plan again, or leave them for a partner courier." bodyClass="">
                  <StopTable orders={data.unassigned} drivers={data.drivers} busy={busy} editable={data.editable}
                    onReassign={reassign} onOpen={setOpen} unassigned />
                </Panel>
              ) : (() => {
                const d = data.drivers.find((x) => x.id === selected);
                return d ? (
                  <DriverRoute d={d} day={day} drivers={data.drivers} busy={busy} editable={data.editable}
                    onReassign={reassign} onOpen={setOpen}
                    onReceive={(amount) => run("receive", () => api.post(`/drivers/${d.id}/days/${day}/receive`, { cash_received: amount }),
                      `Cash from ${d.name} confirmed`)} />
                ) : null;
              })()}
            </div>
          </div>
        </div>
      )}

      {planning && <PlanDialog drivers={data.drivers} onClose={() => setPlanning(false)} onPlan={plan} />}
      {open && <OrderDetail orderId={open} onClose={() => setOpen(null)} onChanged={load} />}
    </>
  );
}

function PlanDialog({ drivers, onClose, onPlan }) {
  const [mode, setMode] = useState("zones");
  const started = drivers.filter((d) => dayStateOf(d.day_state) !== "not_started");
  return (
    <Modal title="Plan routes" onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button icon={Wand2} onClick={() => onPlan(mode)}>Plan routes</Button></>}>
      <fieldset className="space-y-2">
        <legend className="mb-2 text-sm text-ink-700">How should orders be assigned to drivers?</legend>
        {MODES.map(([value, label, text]) => (
          <label key={value} className={cx("flex cursor-pointer gap-3 rounded-md border p-3", mode === value ? "border-brand bg-brand-50" : "border-slate-200")}>
            <input type="radio" name="mode" value={value} checked={mode === value} onChange={() => setMode(value)} className="mt-1 accent-brand" />
            <span><span className="block text-sm font-medium">{label}</span><span className="block text-[13px] text-ink-500">{text}</span></span>
          </label>
        ))}
      </fieldset>
      <p className="mt-4 text-[13px] text-ink-500">
        Assignments are rebuilt for drivers who haven't started.
        {started.length > 0 && ` ${started.map((d) => d.name).join(", ")} ${started.length === 1 ? "is" : "are"} already on the road and keep${started.length === 1 ? "s" : ""} their stops; only their remaining order is re-planned.`}
      </p>
    </Modal>
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
      <div className="mt-1"><DayStateBadge state={dayStateOf(d.day_state)} since={d.day_state?.started_at} /></div>
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

function CashHandover({ d, onReceive }) {
  const ds = d.day_state;
  const [amount, setAmount] = useState(String(ds.cash_declared ?? ""));
  const gap = Math.round((d.stats.cash_collected - (ds.cash_declared || 0)) * 10) / 10;
  if (ds.received_at) {
    return (
      <p className="flex items-center gap-2 border-b border-slate-200 bg-emerald-50 px-5 py-3 text-sm text-emerald-900">
        <Banknote className="h-4 w-4" /> Day closed. {dt(ds.cash_received)} received at {ds.received_at.slice(11, 16)}
        {Math.abs(ds.cash_received - d.stats.cash_collected) > 0.05 && `, ${dt(d.stats.cash_collected - ds.cash_received)} short of the deliveries recorded`}.
      </p>
    );
  }
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 border-b border-amber-200 bg-amber-50 px-5 py-4">
      <div className="text-sm">
        <p className="font-medium text-amber-950">{d.name} ended the day at {ds.ended_at.slice(11, 16)} and declared {dt(ds.cash_declared)}.</p>
        <p className="text-amber-900">
          Deliveries recorded {dt(d.stats.cash_collected)}{Math.abs(gap) > 0.05 ? `: a difference of ${dt(gap)}.` : ", which matches."} Count the cash and confirm.
        </p>
      </div>
      <div className="flex items-end gap-2">
        <label className="text-[13px] text-ink-700">Cash counted (DT)
          <Input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" className="mt-1 w-32" />
        </label>
        <Button icon={Banknote} onClick={() => onReceive(Number(String(amount).replace(",", ".")))}
          disabled={!Number.isFinite(Number(String(amount).replace(",", ".")))}>Confirm receipt</Button>
      </div>
    </div>
  );
}

function DriverRoute({ d, drivers, busy, editable, onReassign, onOpen, onReceive }) {
  const r = d.route;
  const routed = d.orders.filter((o) => o.stop_number);
  const saving = r && r.baseline_minutes > r.driving_minutes ? r.baseline_minutes - r.driving_minutes : 0;
  const state = dayStateOf(d.day_state);
  return (
    <Panel bodyClass="" title={d.name}
      description={`${d.vehicle}, starts at ${d.depot_name}. Covers ${d.zones.split(",").join(", ")}.`}
      actions={<DayStateBadge state={state} since={d.day_state?.started_at} />}>
      {(state === "finished" || state === "reconciled") && <CashHandover d={d} onReceive={onReceive} />}
      {d.orders.length === 0 ? (
        <EmptyState icon={RouteIcon} title="No orders for this driver">Plan routes or assign orders by hand.</EmptyState>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-x-6 gap-y-4 border-b border-slate-200 px-5 py-4 sm:grid-cols-4">
            <Metric label={state === "on_road" ? "Driving left" : "Driving time"} value={r ? `${r.driving_minutes} min` : "–"}
              detail={r ? `${r.distance_km} km, back at ${r.end_time}` : "Nothing left to route"} />
            <Metric label="Stops" value={d.stats.total} detail={`${d.stats.delivered} delivered, ${d.stats.failed} failed`} />
            <Metric label="Cash" value={dt(d.stats.cash_collected)} detail={`of ${dt(d.stats.cash_expected)} expected`} />
            {r ? (
              <div>
                <p className="text-[13px] text-ink-500">Versus nearest-stop-first</p>
                <p className="mt-0.5 text-sm">{r.baseline_minutes} min{r.baseline_late ? `, ${r.baseline_late} stop(s) late` : ", none late"}</p>
                <p className="mt-0.5 text-xs text-ink-500">
                  {saving ? `OR-Tools saves ${saving} min` : "Same driving time"}{r.baseline_late ? " and keeps every slot" : ""}
                </p>
              </div>
            ) : <div />}
          </div>
          {routed.length > 0 && (
            <div className="border-b border-slate-200">
              <RouteMap bare height="h-[360px] lg:h-[420px]"
                depot={{ coordinates: [d.depot_lng, d.depot_lat], address: d.depot_name }}
                stops={routed.map(toMapStop)} routeGeometry={r?.geometry} straightLines={r?.source !== "ors"} />
              <p className="px-5 py-2 text-xs text-ink-500">
                {state === "on_road" ? "The line shows the remaining route from the driver's last known position. " : ""}
                {r?.source !== "ors" ? "Lines connect stops in order; they are not roads. Travel times are estimated from distance." : ""}
              </p>
            </div>
          )}
          <StopTable orders={d.orders} drivers={drivers} busy={busy} editable={editable} onReassign={onReassign} onOpen={onOpen} />
        </>
      )}
    </Panel>
  );
}

function eligibleDrivers(order, drivers) {
  return drivers.filter((d) =>
    d.id === order.driver_id ||
    (d.active && !d.day_state?.ended_at && d.zones.split(",").includes(order.governorate) && d.stats.total < d.max_orders));
}

function StopTable({ orders, drivers, busy, editable, onReassign, onOpen, unassigned }) {
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
            const open = o.status === "pending" || o.status === "assigned";
            return (
              <tr key={o.id} className={cx("align-top", o.unscheduled_reason && o.status === "assigned" && "bg-amber-50/60")}>
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
                  {unassigned ? <span className="mt-1 block text-[13px] text-ink-500">{o.reason}</span>
                    : o.unscheduled_reason && <span className="mt-1 block text-[13px] text-amber-900">{o.unscheduled_reason}</span>}
                  {o.retry_order_id && <span className="mt-1 block text-[13px] text-ink-500">Retry scheduled</span>}
                </td>
                <td className="py-3 pr-5">
                  {open && editable ? (
                    <>
                      <select value={o.driver_id || ""} disabled={busy === `order${o.id}`}
                        onChange={(e) => onReassign(o.id, e.target.value)} aria-label={`Driver for ${o.customer_name}`}
                        className="w-44 rounded-md border border-slate-300 bg-white px-2 py-1.5 text-[13px]">
                        <option value="">Unassigned</option>
                        {options.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                      </select>
                      {options.filter((d) => d.id !== o.driver_id).length === 0 && (
                        <span className="mt-1 block text-xs text-ink-500">No other eligible driver</span>
                      )}
                    </>
                  ) : (
                    <span className="text-[13px] text-ink-500">{open ? "Read-only" : "Finished"}</span>
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
