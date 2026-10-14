/**
 * DriverApp.jsx — the driver's phone screen.
 *
 * Shows only the signed-in driver's deliveries for today, in the optimized
 * order. The current stop is expanded with call / navigate / delivered /
 * failed. "Delivered" records the cash actually collected and an optional
 * proof photo; "Failed" records a reason. Mistakes can be undone.
 */

import React, { useEffect, useRef, useState } from "react";
import {
  Camera, Check, ChevronDown, LogOut, MapPin, Navigation, Package, Phone, RefreshCw, RotateCcw, StickyNote, Truck, X,
} from "lucide-react";
import { api, dt, errorText, formatDay, routeLegs, toMapStop } from "../../api";
import { useAuth } from "../../auth";
import { Logo } from "../../layouts/AdminLayout";
import RouteMap from "../../components/RouteMap";
import {
  Badge, Button, CustomerBadge, ErrorBanner, Loading, PrecisionBadge, StatusBadge, cx, dayStateOf, useToast,
} from "../../components/ui";

const MAX_PHOTO = 8 * 1024 * 1024;

function currentPosition() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve({});
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => resolve({}), // no GPS is fine: the delivery is still recorded
      { timeout: 3000, maximumAge: 60000 }
    );
  });
}

export default function DriverApp() {
  const { user, logout } = useAuth();
  const toast = useToast();
  const [data, setData] = useState(null);
  const [tab, setTab] = useState("route");
  const [openId, setOpenId] = useState(null);
  const [sheet, setSheet] = useState(null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);

  const load = () => api.get("/me/day").then((r) => setData(r.data)).catch((e) => setError(errorText(e)));
  useEffect(() => {
    load();
    const t = setInterval(load, 30000); // picks up changes made by dispatch
    return () => clearInterval(t);
  }, []);

  const act = async (key, fn, message, tone) => {
    setBusy(key);
    setError(null);
    try {
      const r = await fn();
      if (r?.data?.orders) setData(r.data); else await load();
      if (message) toast(message, tone);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  const replan = async () => {
    const pos = await currentPosition();
    act("replan", () => api.post("/me/replan", pos), pos.lat != null
      ? "Remaining stops re-planned from your position" : "Remaining stops re-planned from your last stop", "info");
  };

  const state = dayStateOf(data?.day_state);
  const todo = data ? data.orders.filter((o) => o.status === "assigned") : [];
  const done = data ? data.orders.filter((o) => o.status !== "assigned") : [];
  const routedLeft = todo.filter((o) => o.stop_number);
  const next = routedLeft[0] || todo[0];
  const active = openId ?? next?.id;
  const closed = state === "finished" || state === "reconciled";

  return (
    <div className="min-h-screen bg-paper">
      <header className="sticky top-0 z-[1100] bg-ink text-white">
        <div className="mx-auto flex max-w-lg items-center justify-between px-4 py-3">
          <Logo light />
          <button type="button" onClick={logout} className="flex items-center gap-1.5 text-sm text-ink-300 hover:text-white">
            <LogOut className="h-4 w-4" /> Sign out
          </button>
        </div>
        {data && (
          <div className="mx-auto max-w-lg px-4 pb-4">
            <p className="text-sm text-ink-300">{user?.full_name}, {formatDay(data.day)}</p>
            <div className="mt-2 flex items-end justify-between">
              <p className="text-3xl font-semibold tabular">{done.length}<span className="text-lg text-ink-300"> of {data.orders.length} stops</span></p>
              <div className="text-right">
                <p className="text-lg font-semibold tabular">{dt(data.stats.cash_collected)}</p>
                <p className="text-xs text-ink-300">of {dt(data.stats.cash_expected)} to collect</p>
              </div>
            </div>
            <div className="mt-3 flex h-1.5 overflow-hidden rounded-full bg-ink-700">
              <span className="bg-emerald-500" style={{ width: `${data.orders.length ? (100 * data.stats.delivered) / data.orders.length : 0}%` }} />
              <span className="bg-red-500" style={{ width: `${data.orders.length ? (100 * data.stats.failed) / data.orders.length : 0}%` }} />
            </div>
            {state === "on_road" && data.route && data.orders.some((o) => o.status === "assigned" && o.stop_number) && <p className="mt-2 text-xs text-ink-300">Back at {data.depot_name} around {data.route.end_time}</p>}
          </div>
        )}
      </header>

      <main className="mx-auto max-w-lg px-4 pb-28 pt-4">
        <ErrorBanner error={error} onClose={() => setError(null)} />
        {!data ? <Loading label="Loading your deliveries" /> : data.orders.length === 0 && !closed ? (
          <div className="rounded-2xl bg-white shadow-card p-6 text-center">
            <Package className="mx-auto h-8 w-8 text-ink-300" />
            <p className="mt-3 font-semibold">No deliveries assigned today</p>
            <p className="mt-1 text-sm text-ink-500">When dispatch plans your route it appears here. This page refreshes on its own.</p>
          </div>
        ) : state === "not_started" ? (
          <>
            <DayMap data={data} next={null} compact />
            <div className="mt-4">
              <LoadingChecklist data={data} busy={busy === "start"}
                onStart={() => act("start", () => api.post("/me/start"), "Route started. Arrival times now count from your departure.")} />
            </div>
          </>
        ) : (
          <>
            {closed && <DayClosed data={data} />}
            <DayMap data={data} next={next} />
            <div className="my-4 grid grid-cols-2 rounded-xl bg-mint p-1 text-sm font-medium" role="tablist">
              {[["route", `To do (${todo.length})`], ["done", `Done (${done.length})`]].map(([k, l]) => (
                <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
                  className={cx("rounded-lg py-2", tab === k ? "bg-white shadow-sm" : "text-ink-700")}>{l}</button>
              ))}
            </div>

            {tab === "route" && !closed && (
              <div className="space-y-2">
                {routedLeft.length > 0 && (
                  <div className="flex items-center justify-between gap-3 pb-1">
                    <p className="text-[13px] text-ink-500">Late or took a detour? Re-plan the stops ahead.</p>
                    <Button size="sm" variant="secondary" icon={RefreshCw} loading={busy === "replan"} onClick={replan}>Re-plan</Button>
                  </div>
                )}
                {routedLeft.length === 0 && (
                  <EndDay data={data} busy={busy === "end"}
                    onEnd={(cash) => act("end", () => api.post("/me/end", { cash_declared: cash }), "Day closed. Hand the cash to the office.")} />
                )}
                {todo.map((o) => (
                  <Stop key={o.id} o={o} isNext={o.id === next?.id} open={o.id === active} onOpen={() => setOpenId(o.id === active ? -1 : o.id)} />
                ))}
              </div>
            )}

            {tab === "route" && closed && <p className="py-6 text-center text-sm text-ink-500">Nothing left to deliver today.</p>}

            {tab === "done" && (
              <ul className="space-y-2">
                {done.length === 0 && <p className="py-6 text-center text-sm text-ink-500">Nothing finished yet.</p>}
                {done.map((o) => (
                  <li key={o.id} className="flex items-center gap-3 rounded-2xl bg-white shadow-card px-4 py-3">
                    <span className="w-6 text-center font-semibold tabular text-ink-500">{o.stop_number ?? "–"}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{o.customer_name}</p>
                      <p className="text-[13px] text-ink-500">
                        {o.status === "delivered" ? `Collected ${dt(o.cash_collected)}${o.has_photo ? ", photo saved" : ""}` : o.fail_reason}
                      </p>
                    </div>
                    <StatusBadge status={o.status} />
                    {!closed && !o.retry_order_id && (
                      <button type="button" onClick={() => act(`undo${o.id}`, () => api.post(`/orders/${o.id}/undo`), `${o.customer_name} is back on your route`, "info")}
                        aria-label={`Undo ${o.customer_name}`} className="rounded p-2 text-ink-500 hover:bg-slate-100"><RotateCcw className="h-4 w-4" /></button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </main>

      {/* Action bar for the open stop, within thumb reach */}
      {data && state === "on_road" && tab === "route" && todo.find((o) => o.id === active) && (
        <div className="fixed inset-x-0 bottom-0 z-[1100] border-t border-slate-200 bg-white pb-safe-bottom">
          <div className="mx-auto grid max-w-lg grid-cols-2 gap-2 px-4 py-3">
            <Button variant="secondary" size="lg" icon={X} onClick={() => setSheet({ type: "fail", order: todo.find((o) => o.id === active) })}
              className="text-red-800">Failed</Button>
            <Button variant="success" size="lg" icon={Check} onClick={() => setSheet({ type: "deliver", order: todo.find((o) => o.id === active) })}>Delivered</Button>
          </div>
        </div>
      )}

      {sheet?.type === "deliver" && (
        <DeliverSheet order={sheet.order} onClose={() => setSheet(null)}
          onDone={() => { setSheet(null); setOpenId(null); toast(`Delivered to ${sheet.order.customer_name}`); load(); }} />
      )}
      {sheet?.type === "fail" && (
        <FailSheet order={sheet.order} reasons={data.fail_reasons} onClose={() => setSheet(null)}
          onDone={() => { setSheet(null); setOpenId(null); toast(`Marked as failed: ${sheet.order.customer_name}`, "warn"); load(); }} />
      )}
    </div>
  );
}

// The whole day on one map: grey = done, blue = still ahead, big marker = next stop.
function DayMap({ data, next, compact }) {
  const stops = data.orders.filter((o) => o.stop_number);
  if (!stops.length) return null;
  const left = data.orders.filter((o) => o.status === "assigned" && o.stop_number).length;
  return (
    <div className="overflow-hidden rounded-2xl bg-white shadow-card">
      <RouteMap bare height={compact ? "h-[30vh]" : "h-[42vh]"}
        depot={{ coordinates: [data.depot_lng, data.depot_lat], address: data.depot_name }}
        stops={stops.map(toMapStop)} legs={routeLegs(data.orders, data.route)}
        straightLines={data.route?.source !== "ors"} nextStop={next?.stop_number} />
      <div className="flex items-center justify-between gap-3 px-4 py-2 text-xs text-ink-500">
        <span className="flex items-center gap-3">
          <span className="flex items-center gap-1"><span className="h-1 w-4 rounded-full bg-brand" />Ahead</span>
          <span className="flex items-center gap-1"><span className="h-1 w-4 rounded-full bg-[#9AA5B1]" />Done</span>
        </span>
        <span>{compact ? `Your route: ${stops.length} stops` : left ? `${left} stops left` : "Route complete"}</span>
      </div>
    </div>
  );
}

// Before leaving the depot: tick every package as loaded, then start.
function LoadingChecklist({ data, busy, onStart }) {
  const stops = data.orders.filter((o) => o.status === "assigned");
  const [loaded, setLoaded] = useState({});
  const count = stops.filter((o) => loaded[o.id]).length;
  return (
    <div className="rounded-2xl bg-white shadow-card">
      <div className="border-b border-slate-200 px-4 py-3.5">
        <p className="font-semibold">Load your packages</p>
        <p className="text-[13px] text-ink-500">
          {stops.length} packages, {dt(data.stats.cash_expected)} to collect. Load the last stop first so the first one is on top.
        </p>
      </div>
      <ul className="divide-y divide-slate-100">
        {[...stops].reverse().map((o) => (
          <li key={o.id}>
            <label className="flex cursor-pointer items-center gap-3 px-4 py-3">
              <input type="checkbox" className="h-5 w-5 accent-brand" checked={!!loaded[o.id]}
                onChange={(e) => setLoaded({ ...loaded, [o.id]: e.target.checked })} />
              <span className="w-6 text-center text-sm font-semibold tabular text-ink-500">{o.stop_number ?? "–"}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{o.product || "Package"}</span>
                <span className="block truncate text-[13px] text-ink-500">{o.customer_name}, {o.city || o.governorate}</span>
              </span>
              <span className="text-sm tabular">{dt(o.cod_amount)}</span>
            </label>
          </li>
        ))}
      </ul>
      <div className="border-t border-slate-200 p-4">
        <Button size="lg" className="w-full" icon={Truck} loading={busy} disabled={count < stops.length} onClick={onStart}>
          {count < stops.length ? `${count} of ${stops.length} loaded` : "Start route"}
        </Button>
        <button type="button" className="mt-2 w-full text-center text-[13px] text-ink-500 underline"
          onClick={() => setLoaded(Object.fromEntries(stops.map((o) => [o.id, true])))}>Mark all as loaded</button>
      </div>
    </div>
  );
}

function EndDay({ data, busy, onEnd }) {
  const [cash, setCash] = useState(String(data.stats.cash_collected));
  const amount = Number(String(cash).replace(",", "."));
  const unrouted = data.orders.filter((o) => o.status === "assigned" && !o.stop_number).length;
  return (
    <div className="mb-2 rounded-lg border border-emerald-200 bg-emerald-50 p-4">
      <p className="flex items-center gap-2 font-semibold text-emerald-900"><Check className="h-5 w-5" /> All stops done</p>
      <p className="mt-1 text-sm text-emerald-900">
        Your deliveries recorded {dt(data.stats.cash_collected)}. Count the cash you are handing to the office.
        {unrouted > 0 && ` ${unrouted} stop(s) that didn't fit your route will go back to dispatch.`}
      </p>
      <label className="mt-3 block text-sm font-medium text-emerald-950">Cash handed over (DT)
        <input type="text" inputMode="decimal" value={cash} onChange={(e) => setCash(e.target.value)}
          className="mt-1 block w-full rounded-md border border-emerald-300 bg-white px-3 py-3 text-lg font-semibold tabular focus:border-brand focus:outline-none" />
      </label>
      {Number.isFinite(amount) && Math.abs(amount - data.stats.cash_collected) > 0.05 && (
        <p className="mt-1.5 text-sm text-amber-800">That is {dt(Math.abs(data.stats.cash_collected - amount))} {amount < data.stats.cash_collected ? "less" : "more"} than your deliveries recorded. The office will see the difference.</p>
      )}
      <Button size="lg" variant="success" className="mt-3 w-full" loading={busy} disabled={!Number.isFinite(amount) || amount < 0}
        onClick={() => onEnd(amount)}>End day</Button>
    </div>
  );
}

function DayClosed({ data }) {
  const ds = data.day_state;
  return (
    <div className={cx("mb-4 rounded-lg border p-4", ds.received_at ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50")}>
      <p className="font-semibold">{ds.received_at ? "Day closed" : "Day ended, waiting for the office"}</p>
      <p className="mt-1 text-sm">
        You declared {dt(ds.cash_declared)} at {ds.ended_at.slice(11, 16)}.
        {ds.received_at ? ` The office confirmed receiving ${dt(ds.cash_received)}.` : " The office will count it and confirm."}
      </p>
    </div>
  );
}

function Stop({ o, isNext, open, onOpen }) {
  const maps = `https://www.google.com/maps/dir/?api=1&destination=${o.lat},${o.lng}`;
  return (
    <div className={cx("rounded-lg border bg-white", open ? (isNext ? "border-brand" : "border-ink-300") : "border-slate-200")}>
      <button type="button" onClick={onOpen} aria-expanded={open} className="flex w-full items-center gap-3 px-4 py-3 text-left">
        <span className={cx("flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold tabular",
          isNext ? "bg-brand text-white" : "bg-slate-100 text-ink")}>{o.stop_number ?? "?"}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{o.customer_name}</span>
          <span className="block truncate text-[13px] text-ink-500">
            {o.city || o.governorate}{o.eta ? `, around ${o.eta}` : `, ${o.slot_label.toLowerCase()}`}
          </span>
        </span>
        <span className="text-right">
          <span className="block font-semibold tabular">{dt(o.cod_amount)}</span>
          <ChevronDown className={cx("ml-auto h-4 w-4 text-ink-300 transition-transform", open && "rotate-180")} />
        </span>
      </button>
      {open && (
        <div className="border-t border-slate-100 px-4 pb-4 pt-3">
          {isNext && <p className="mb-2 text-[13px] font-medium text-brand">Next stop</p>}
          <div className="flex flex-wrap gap-1.5"><CustomerBadge order={o} /><PrecisionBadge precision={o.location_precision} /><Badge>{o.slot_label}</Badge></div>
          <div className="mt-3 space-y-2 text-[15px]">
            <p className="flex gap-2"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-ink-500" />{o.address}, {o.city || o.governorate}</p>
            {o.landmark && <p className="flex gap-2"><Navigation className="mt-0.5 h-4 w-4 shrink-0 text-ink-500" />{o.landmark}</p>}
            {o.product && <p className="flex gap-2"><Package className="mt-0.5 h-4 w-4 shrink-0 text-ink-500" />{o.product}</p>}
            {o.notes && <p className="flex gap-2 rounded-md bg-amber-50 px-2 py-1.5 text-amber-900"><StickyNote className="mt-0.5 h-4 w-4 shrink-0" />{o.notes}</p>}
            {o.location_precision === "governorate" && (
              <p className="rounded-md bg-amber-50 px-2 py-1.5 text-amber-900">Only the governorate is known. Call the customer for directions.</p>
            )}
            {o.unscheduled_reason && <p className="rounded-md bg-amber-50 px-2 py-1.5 text-amber-900">Not in the planned route: {o.unscheduled_reason}</p>}
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <a href={`tel:+216${o.phone}`} className="flex h-12 items-center justify-center gap-2 rounded-md border border-slate-300 font-medium">
              <Phone className="h-4 w-4" /> Call
            </a>
            <a href={maps} target="_blank" rel="noreferrer" className="flex h-12 items-center justify-center gap-2 rounded-md border border-slate-300 font-medium">
              <Navigation className="h-4 w-4" /> Navigate
            </a>
          </div>
        </div>
      )}
    </div>
  );
}

function Sheet({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-[2000] flex items-end justify-center bg-ink/50" onMouseDown={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title} className="w-full max-w-lg rounded-t-2xl bg-white px-5 pb-8 pt-5" onMouseDown={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button type="button" onClick={onClose} className="text-sm text-ink-500">Cancel</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function DeliverSheet({ order, onClose, onDone }) {
  const [cash, setCash] = useState(String(order.cod_amount));
  const [photo, setPhoto] = useState(null);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const sent = useRef(false); // guards against a double tap

  const pick = (f) => {
    if (!f) return;
    if (!f.type.startsWith("image/")) return setError("Choose a photo (JPEG, PNG or WebP).");
    if (f.size > MAX_PHOTO) return setError("That photo is over 8 MB. Take it again at a lower resolution.");
    setError(null);
    setPhoto(f);
    setPreview(URL.createObjectURL(f));
  };

  const submit = async () => {
    if (sent.current) return;
    const amount = Number(String(cash).replace(",", "."));
    if (!Number.isFinite(amount) || amount < 0) return setError("Enter the cash you collected, in dinars.");
    sent.current = true;
    setBusy(true);
    const form = new FormData();
    form.append("cash_collected", amount);
    if (photo) form.append("photo", photo);
    const pos = await currentPosition();
    if (pos.lat != null) { form.append("lat", pos.lat); form.append("lng", pos.lng); }
    try {
      await api.post(`/orders/${order.id}/deliver`, form);
      onDone();
    } catch (e) {
      if (e?.response?.status === 409) return onDone(); // already saved by an earlier tap
      sent.current = false;
      setError(errorText(e));
      setBusy(false);
    }
  };

  const amount = Number(String(cash).replace(",", "."));
  return (
    <Sheet title={`Delivered to ${order.customer_name}`} onClose={onClose}>
      <ErrorBanner error={error} />
      <label className="block text-sm font-medium">
        Cash collected (DT)
        <input type="text" inputMode="decimal" value={cash} onChange={(e) => setCash(e.target.value)}
          className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-3 text-xl font-semibold tabular focus:border-brand focus:outline-none" />
      </label>
      {Number.isFinite(amount) && amount < order.cod_amount && (
        <p className="mt-1.5 text-sm text-amber-800">{dt(order.cod_amount - amount)} less than the {dt(order.cod_amount)} due. Dispatch will see the gap.</p>
      )}
      <label className="mt-4 flex cursor-pointer items-center gap-3 rounded-md border border-dashed border-slate-300 p-3">
        <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => pick(e.target.files?.[0])} />
        {preview ? <img src={preview} alt="Proof of delivery" className="h-16 w-16 rounded object-cover" />
          : <span className="flex h-16 w-16 items-center justify-center rounded bg-slate-100"><Camera className="h-6 w-6 text-ink-500" /></span>}
        <span>
          <span className="block font-medium">{photo ? "Photo added, tap to retake" : "Add a proof photo"}</span>
          <span className="text-[13px] text-ink-500">Optional. The package at the door or with the customer.</span>
        </span>
      </label>
      <Button variant="success" size="lg" className="mt-5 w-full" loading={busy} onClick={submit}>Confirm delivery</Button>
    </Sheet>
  );
}

function FailSheet({ order, reasons, onClose, onDone }) {
  const [reason, setReason] = useState(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const sent = useRef(false);

  const submit = async () => {
    if (sent.current) return;
    sent.current = true;
    setBusy(true);
    const pos = await currentPosition();
    try {
      await api.post(`/orders/${order.id}/fail`, { reason, note: note.trim() || null, ...pos });
      onDone();
    } catch (e) {
      if (e?.response?.status === 409) return onDone();
      sent.current = false;
      setError(errorText(e));
      setBusy(false);
    }
  };

  return (
    <Sheet title="Why couldn't you deliver?" onClose={onClose}>
      <ErrorBanner error={error} />
      <div className="grid grid-cols-2 gap-2">
        {reasons.map((r) => (
          <button key={r} type="button" onClick={() => setReason(r)} aria-pressed={reason === r}
            className={cx("h-12 rounded-md border px-2 text-sm font-medium", reason === r ? "border-red-600 bg-red-50 text-red-800" : "border-slate-300")}>
            {r}
          </button>
        ))}
      </div>
      <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="Note for dispatch (optional)"
        className="mt-3 block w-full rounded-md border border-slate-300 px-3 py-3 focus:border-brand focus:outline-none" />
      <Button variant="danger" size="lg" className="mt-5 w-full" disabled={!reason} loading={busy} onClick={submit}>Mark as failed</Button>
    </Sheet>
  );
}
