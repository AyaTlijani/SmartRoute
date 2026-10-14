import React, { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  AlertTriangle, Banknote, Clock3, Gauge, Inbox, Lock, MapPinOff, Package, Route as RouteIcon, Wand2,
} from "lucide-react";
import { api, dt, errorText, formatDay, routeLegs, toMapStop } from "../../api";
import { DayPicker, useDay } from "../../layouts/AdminLayout";
import RouteMap from "../../components/RouteMap";
import OrderDetail from "../../components/OrderDetail";
import {
  Button, CustomerBadge, DayStateBadge, EmptyState, ErrorBanner, Input, Loading, Modal,
  PageHeader, Panel, PrecisionBadge, StatCard, StatusBadge, cx, dayStateOf, useToast,
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
        actions={<>
          <DayPicker />
          {data.editable && (
            <Button icon={Wand2} loading={busy === "plan"} disabled={!openOrders} onClick={() => setPlanning(true)}>Plan routes</Button>
          )}
        </>} />
      <ErrorBanner error={error} onClose={() => setError(null)} />
      {!data.editable && (
        <p className="mb-5 flex items-center gap-2 rounded-full bg-white px-5 py-3 text-sm font-medium text-ink-700 shadow-card">
          <Lock className="h-4 w-4 text-ink-500" /> Past day: read-only. You can review routes and confirm cash handovers.
        </p>
      )}

      {total === 0 ? (
        <Panel><EmptyState icon={Inbox} title={`No orders for ${formatDay(day)}`}
          action={data.editable && <Link to="/admin/import"><Button>Import orders</Button></Link>}>
          {data.editable ? "Import the day's confirmed orders first, then plan the routes here." : "Nothing was delivered on this day."}
        </EmptyState></Panel>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
            <StatCard icon={Package} label="Orders" value={total} detail={`${routed} on a route`} />
            <StatCard icon={AlertTriangle} label="Unassigned" value={data.unassigned.length} tone={data.unassigned.length ? "warn" : undefined} />
            <StatCard icon={MapPinOff} label="Off route" value={unscheduled} tone={unscheduled ? "warn" : undefined} detail="Slot can't be met" />
            <StatCard icon={Clock3} label="Total driving" value={`${totalDriving} min`} detail={`${onRoad}/${data.drivers.length} drivers started`} />
            <StatCard icon={Gauge} label="Travel times" value={sources.has("ors") ? "Roads" : "Estimated"}
              detail={sources.has("ors") ? "OpenRouteService" : "Distance-based"} />
          </div>

          <div className="grid gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
            <nav aria-label="Drivers" className="space-y-2.5">
              {data.unassigned.length > 0 && (
                <button type="button" onClick={() => select("unassigned")}
                  className={cx("flex w-full items-center justify-between rounded-3xl border-2 px-4 py-3.5 text-left shadow-card",
                    selected === "unassigned" ? "border-sun bg-amber-50" : "border-transparent bg-white hover:border-amber-200")}>
                  <span className="flex items-center gap-3 text-sm font-bold">
                    <span className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-100 text-amber-700"><AlertTriangle className="h-5 w-5" /></span>
                    Unassigned
                  </span>
                  <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-sm font-bold tabular text-amber-800">{data.unassigned.length}</span>
                </button>
              )}
              {data.drivers.map((d) => <DriverRow key={d.id} d={d} active={selected === d.id} onClick={() => select(d.id)} />)}
            </nav>

            <div className="min-w-0">
              {selected === "unassigned" ? (
                <Panel title="Unassigned orders" description="Each one says why. Assign by hand, plan again, or leave them for a partner courier." bodyClass="px-5 pb-5">
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
      className={cx("w-full rounded-3xl border-2 px-4 py-3.5 text-left shadow-card transition-colors",
        active ? "border-brand bg-mint-50" : "border-transparent bg-white hover:border-mint-200")}>
      <div className="flex items-center gap-3">
        <span className={cx("flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold",
          active ? "bg-brand text-white" : "bg-mint-200 text-brand-700")}>
          {d.name.split(" ").map((w) => w[0]).join("")}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-2">
            <span className="truncate text-sm font-bold">{d.name}</span>
            <span className={cx("text-[13px] font-semibold tabular", d.stats.total >= d.max_orders ? "text-amber-800" : "text-ink-500")}>{d.stats.total}/{d.max_orders}</span>
          </span>
          <span className="mt-1 block"><DayStateBadge state={dayStateOf(d.day_state)} since={d.day_state?.started_at} /></span>
        </span>
      </div>
      {d.stats.total > 0 && (
        <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-mint">
          <span className="bg-brand" style={{ width: `${(100 * d.stats.delivered) / d.stats.total}%` }} />
          <span className="bg-sun" style={{ width: `${(100 * d.stats.failed) / d.stats.total}%` }} />
        </div>
      )}
      <p className="mt-1.5 text-xs tabular text-ink-500">
        {d.stats.total === 0 ? "No orders" : `${done} of ${d.stats.total} done${d.route ? `, ${d.route.driving_minutes} min driving` : ""}`}
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
      <p className="mx-6 mb-4 flex items-center gap-2 rounded-2xl bg-mint px-4 py-3 text-sm font-medium text-brand-700">
        <Banknote className="h-4 w-4" /> Day closed. {dt(ds.cash_received)} received at {ds.received_at.slice(11, 16)}
        {Math.abs(ds.cash_received - d.stats.cash_collected) > 0.05 && `, ${dt(d.stats.cash_collected - ds.cash_received)} short of the deliveries recorded`}.
      </p>
    );
  }
  return (
    <div className="mx-6 mb-4 flex flex-wrap items-end justify-between gap-4 rounded-2xl bg-amber-50 px-5 py-4">
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
    <Panel bodyClass="" title={`${d.name}'s route`}
      description={`${d.vehicle[0].toUpperCase() + d.vehicle.slice(1)} from ${d.depot_name}, covers ${d.zones.split(",").join(", ")}`}
      actions={<DayStateBadge state={state} since={d.day_state?.started_at} />}>
      {(state === "finished" || state === "reconciled") && <CashHandover d={d} onReceive={onReceive} />}
      {d.orders.length === 0 ? (
        <EmptyState icon={RouteIcon} title="No orders for this driver">Plan routes or assign orders by hand.</EmptyState>
      ) : (
        <>
          {routed.length > 0 && (
            <div className="relative mx-6 overflow-hidden rounded-3xl">
              <RouteMap bare height="h-[440px] lg:h-[500px]"
                depot={{ coordinates: [d.depot_lng, d.depot_lat], address: d.depot_name }}
                stops={routed.map(toMapStop)} legs={routeLegs(d.orders, r)} straightLines={r?.source !== "ors"}
                nextStop={d.orders.find((o) => o.status === "assigned" && o.stop_number)?.stop_number} />
              {/* Floating route summary, like a navigation app */}
              <div className="pointer-events-none absolute left-3 right-3 top-3 z-[500] flex flex-wrap justify-end gap-2 sm:left-auto">
                {[
                  [state === "on_road" ? "Driving left" : "Driving", r ? `${r.driving_minutes} min` : "–"],
                  ["Distance", r ? `${r.distance_km} km` : "–"],
                  ["Back at depot", r?.end_time || "–"],
                  ["Cash", `${dt(d.stats.cash_collected)} / ${dt(d.stats.cash_expected)}`],
                ].map(([k, v]) => (
                  <div key={k} className="rounded-2xl bg-white/95 px-3.5 py-2 shadow-float backdrop-blur">
                    <p className="text-[11px] font-medium text-ink-500">{k}</p>
                    <p className="text-sm font-extrabold tabular">{v}</p>
                  </div>
                ))}
              </div>
              <div className="pointer-events-none absolute bottom-3 left-3 z-[500] flex flex-wrap items-center gap-3 rounded-2xl bg-white/95 px-3.5 py-2 text-xs font-medium shadow-float">
                <span className="flex items-center gap-1.5"><span className="h-1.5 w-5 rounded-full bg-brand" />Ahead</span>
                <span className="flex items-center gap-1.5"><span className="h-1.5 w-5 rounded-full bg-[#9AA5B1]" />Done</span>
                <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-full border-2 border-red-500 bg-[#9AA5B1]" />Failed</span>
                {r?.source !== "ors" && <span className="text-ink-500">Straight lines, not roads</span>}
              </div>
            </div>
          )}
          {r && (
            <p className="mx-6 mt-3 flex items-center gap-2 rounded-2xl bg-mint-50 px-4 py-2.5 text-[13px] text-ink-700">
              <RouteIcon className="h-4 w-4 text-brand" />
              <span>
                Compared with going to the nearest stop first ({r.baseline_minutes} min{r.baseline_late ? `, ${r.baseline_late} stop(s) late` : ""}):{" "}
                <strong>{saving ? `OR-Tools saves ${saving} min` : "same driving time"}{r.baseline_late ? " and keeps every time slot" : ""}.</strong>
              </span>
            </p>
          )}
          <div className="px-6 pb-6 pt-4">
          <StopTable orders={d.orders} drivers={drivers} busy={busy} editable={editable} onReassign={onReassign} onOpen={onOpen} />
          </div>
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
      <table className="table-soft min-w-[620px]">
        <thead>
          <tr>
            {!unassigned && <th className="w-24">Stop</th>}
            <th>Customer</th>
            <th className="text-right">COD</th>
            <th>Status</th>
            <th className="w-40">Driver</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => {
            const options = eligibleDrivers(o, drivers);
            const open = o.status === "pending" || o.status === "assigned";
            const done = o.status === "delivered" || o.status === "failed";
            return (
              <tr key={o.id} className={cx(o.unscheduled_reason && o.status === "assigned" && "bg-amber-50/60", done && "text-ink-500")}>
                {!unassigned && (
                  <td>
                    <span className="flex items-center gap-2.5">
                      <span className={cx("flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[13px] font-bold tabular",
                        done ? "bg-slate-100 text-ink-500" : o.stop_number ? "bg-mint-200 text-brand-700" : "bg-amber-100 text-amber-800")}>
                        {o.stop_number ?? "–"}
                      </span>
                      <span className="whitespace-nowrap tabular">
                        <span className="block font-semibold text-ink">{o.eta || "–"}</span>
                        <span className="block text-xs">{o.slot_label}</span>
                      </span>
                    </span>
                  </td>
                )}
                <td>
                  <button type="button" onClick={() => onOpen(o.id)} className="text-left font-semibold text-ink hover:text-brand">{o.customer_name}</button>
                  <span className="block text-[13px]">{o.city ? `${o.city}, ${o.governorate}` : o.governorate}</span>
                  <span className="mt-1 flex flex-wrap gap-1"><CustomerBadge order={o} /><PrecisionBadge precision={o.location_precision} /></span>
                </td>
                <td className="whitespace-nowrap text-right font-semibold tabular text-ink">{dt(o.cod_amount)}</td>
                <td className="max-w-[230px]">
                  <StatusBadge status={o.status} />
                  {o.fail_reason && <span className="mt-1 block text-[13px] text-red-800">{o.fail_reason}</span>}
                  {unassigned ? <span className="mt-1 block text-[13px] text-ink-500">{o.reason}</span>
                    : o.unscheduled_reason && <span className="mt-1 block text-[13px] text-amber-900">{o.unscheduled_reason}</span>}
                  {o.retry_order_id && <span className="mt-1 block text-[13px] text-ink-500">Retry scheduled</span>}
                </td>
                <td>
                  {open && editable ? (
                    <>
                      <select value={o.driver_id || ""} disabled={busy === `order${o.id}`}
                        onChange={(e) => onReassign(o.id, e.target.value)} aria-label={`Driver for ${o.customer_name}`}
                        className="w-40 rounded-full border border-mint-200 bg-white px-3 py-1.5 text-[13px] font-medium">
                        <option value="">Unassigned</option>
                        {options.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                      </select>
                      {options.filter((d) => d.id !== o.driver_id).length === 0 && (
                        <span className="mt-1 block text-xs text-ink-500">No other eligible driver</span>
                      )}
                    </>
                  ) : (
                    <span className="text-[13px]">{open ? "Read-only" : "Finished"}</span>
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
