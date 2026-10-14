/**
 * DriverView.jsx — the driver's phone screen.
 *
 * Shows today's stops in the optimized order. The current stop is
 * expanded with call / navigate / delivered / failed actions.
 * "Delivered" asks for the cash collected and a proof photo
 * (the phone camera opens directly on mobile).
 */

import React, { useEffect, useState } from "react";
import { api, dt, errorText, toMapStop } from "../api";
import RouteMap from "./RouteMap";
import { Badge, CustomerBadge, ErrorBox, Spinner } from "./ui";

const FAIL_REASONS = ["No answer", "Customer refused", "Not at home", "Wrong address", "Other"];

function currentPosition() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve({});
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => resolve({}),
      { timeout: 3000, maximumAge: 60000 }
    );
  });
}

export default function DriverView({ driverId, day, go }) {
  const [drivers, setDrivers] = useState([]);
  const [data, setData] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [sheet, setSheet] = useState(null); // { type: "deliver" | "fail", order }
  const [tab, setTab] = useState("stops");
  const [error, setError] = useState(null);

  useEffect(() => {
    api.get("/drivers").then((r) => setDrivers(r.data)).catch(() => {});
  }, []);

  const load = () => {
    if (!driverId) return;
    api.get(`/drivers/${driverId}/day`, { params: { day } })
      .then((r) => setData(r.data))
      .catch((err) => setError(errorText(err)));
  };

  useEffect(() => {
    setData(null);
    setOpenId(null);
    load();
  }, [driverId, day]);

  if (!driverId) {
    return (
      <Shell go={go}>
        <h2 className="text-xl font-bold">Who's driving?</h2>
        <p className="mt-1 text-sm text-slate-500">Demo mode: pick a driver to see their day.</p>
        <div className="mt-4 space-y-2">
          {drivers.map((d) => (
            <button key={d.id} type="button" onClick={() => go("driver", d.id)}
              className="flex w-full items-center justify-between rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm active:scale-[0.99]">
              <span>
                <span className="block font-bold">{d.name}</span>
                <span className="text-xs text-slate-500">{d.zones.split(",").join(" · ")}</span>
              </span>
              <span className="text-slate-400">›</span>
            </button>
          ))}
        </div>
      </Shell>
    );
  }

  if (!data) {
    return <Shell go={go}><p className="flex items-center gap-2 text-sm text-slate-500"><Spinner /> Loading your day…</p><ErrorBox error={error} /></Shell>;
  }

  const todo = data.orders.filter((o) => o.status === "assigned");
  const done = data.orders.filter((o) => o.status !== "assigned");
  const next = todo[0];
  const activeId = openId ?? next?.id;
  const progress = data.orders.length ? (100 * done.length) / data.orders.length : 0;

  return (
    <Shell go={go} title={data.name} subtitle={`${data.day} · from ${data.depot_name}`}>
      <ErrorBox error={error} onClose={() => setError(null)} />

      <div className="rounded-2xl bg-slate-900 p-4 text-white">
        <div className="flex items-end justify-between">
          <div>
            <p className="text-xs text-slate-400">Stops done</p>
            <p className="text-3xl font-bold tabular-nums">{done.length}<span className="text-lg text-slate-400">/{data.orders.length}</span></p>
          </div>
          <div className="text-right">
            <p className="text-xs text-slate-400">Cash collected</p>
            <p className="text-xl font-bold tabular-nums">{dt(data.stats.cash_collected)}</p>
            <p className="text-[11px] text-slate-400">of {dt(data.stats.cash_expected)}</p>
          </div>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-700">
          <div className="h-full rounded-full bg-emerald-400 transition-all" style={{ width: `${progress}%` }} />
        </div>
      </div>

      {data.orders.length === 0 ? (
        <p className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-600">
          No deliveries assigned for {data.day}. Ask dispatch to assign today's orders.
        </p>
      ) : (
        <>
          <div className="mt-4 grid grid-cols-2 gap-1 rounded-xl bg-slate-200 p-1 text-sm font-semibold">
            {["stops", "map"].map((t) => (
              <button key={t} type="button" onClick={() => setTab(t)}
                className={`rounded-lg py-2 capitalize ${tab === t ? "bg-white shadow-sm" : "text-slate-600"}`}>{t}</button>
            ))}
          </div>

          {tab === "map" && (
            <div className="mt-4">
              <RouteMap
                depot={{ coordinates: [data.depot_lng, data.depot_lat], address: data.depot_name }}
                stops={data.orders.filter((o) => o.stop_number).map(toMapStop)}
                routeGeometry={data.route.geometry}
                straightLines={data.route.source !== "ors"}
              />
              {todo.length === 0 && <p className="mt-3 text-sm text-slate-500">All stops finished.</p>}
            </div>
          )}

          {tab === "stops" && (
            <div className="mt-4 space-y-3">
              {todo.length === 0 && (
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-center">
                  <p className="text-2xl" aria-hidden="true">✅</p>
                  <p className="mt-1 font-bold text-emerald-800">Route finished</p>
                  <p className="text-sm text-emerald-700">Hand over {dt(data.stats.cash_collected)} at the depot.</p>
                </div>
              )}

              {todo.map((o) => (
                <StopCard key={o.id} order={o} isNext={o.id === next?.id} open={o.id === activeId}
                  onOpen={() => setOpenId(o.id)}
                  onDeliver={() => setSheet({ type: "deliver", order: o })}
                  onFail={() => setSheet({ type: "fail", order: o })} />
              ))}

              {done.length > 0 && (
                <div className="pt-3">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Finished</p>
                  {done.map((o) => (
                    <div key={o.id} className="mb-2 flex items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-2.5">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">{o.stop_number ? `${o.stop_number}. ` : ""}{o.customer_name}</p>
                        <p className="text-xs text-slate-500">
                          {o.status === "delivered" ? `Collected ${dt(o.cash_collected)}${o.photo_path ? " · photo" : ""}` : o.fail_reason}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge kind={o.status} />
                        <button type="button" className="text-xs font-semibold text-slate-500 underline"
                          onClick={() => api.post(`/orders/${o.id}/undo`).then(load).catch((e) => setError(errorText(e)))}>
                          Undo
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {sheet?.type === "deliver" && (
        <DeliverSheet order={sheet.order} onClose={() => setSheet(null)}
          onDone={() => { setSheet(null); setOpenId(null); load(); }} onError={setError} />
      )}
      {sheet?.type === "fail" && (
        <FailSheet order={sheet.order} onClose={() => setSheet(null)}
          onDone={() => { setSheet(null); setOpenId(null); load(); }} onError={setError} />
      )}
    </Shell>
  );
}

function Shell({ children, go, title, subtitle }) {
  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <header className="sticky top-0 z-[1100] border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-md items-center justify-between px-4 py-3">
          <div className="min-w-0">
            <p className="truncate font-bold">{title || "SmartRoute Driver"}</p>
            {subtitle && <p className="truncate text-xs text-slate-500">{subtitle}</p>}
          </div>
          <div className="flex gap-3 text-xs font-semibold text-blue-700">
            {title && <button type="button" onClick={() => go("driver")}>Switch</button>}
            <button type="button" onClick={() => go("dispatch")}>Admin</button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-md px-4 pb-24 pt-4">{children}</main>
    </div>
  );
}

function StopCard({ order: o, isNext, open, onOpen, onDeliver, onFail }) {
  const maps = `https://www.google.com/maps/dir/?api=1&destination=${o.lat},${o.lng}`;
  if (!open) {
    return (
      <button type="button" onClick={onOpen}
        className="flex w-full items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3 text-left shadow-sm">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-sm font-bold tabular-nums">
          {o.stop_number ?? "?"}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{o.customer_name}</span>
          <span className="block truncate text-xs text-slate-500">{o.city || o.governorate} · {o.eta || o.slot_label}</span>
        </span>
        <span className="text-sm font-semibold tabular-nums">{dt(o.cod_amount)}</span>
      </button>
    );
  }
  return (
    <div className={`rounded-2xl border-2 bg-white p-4 shadow-sm ${isNext ? "border-blue-500" : "border-slate-300"}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-blue-600">
            {isNext ? "Next stop" : "Stop"} {o.stop_number ?? ""} · ETA {o.eta || "—"}
          </p>
          <p className="mt-1 text-lg font-bold leading-tight">{o.customer_name}</p>
          <div className="mt-1"><CustomerBadge order={o} /></div>
        </div>
        <div className="text-right">
          <p className="text-[11px] text-slate-500">Collect</p>
          <p className="text-xl font-bold tabular-nums">{dt(o.cod_amount)}</p>
        </div>
      </div>

      <div className="mt-3 space-y-1 text-sm">
        <p>{o.address}, {o.city || o.governorate}</p>
        {o.landmark && <p className="text-slate-600">📍 {o.landmark}</p>}
        {o.product && <p className="text-slate-600">📦 {o.product}</p>}
        {o.notes && <p className="rounded-lg bg-amber-50 px-2 py-1 text-amber-800">{o.notes}</p>}
        {o.location_precision === "governorate" && (
          <p className="rounded-lg bg-amber-50 px-2 py-1 text-amber-800">Approximate location: call the customer for directions.</p>
        )}
        <p className="text-xs text-slate-500">Slot: {o.slot_label}{!o.stop_number && " · doesn't fit the route's time window"}</p>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <a href={`tel:+216${o.phone}`} className="rounded-xl border border-slate-200 py-3 text-center text-sm font-semibold">📞 Call</a>
        <a href={maps} target="_blank" rel="noreferrer" className="rounded-xl border border-slate-200 py-3 text-center text-sm font-semibold">🧭 Navigate</a>
        <button type="button" onClick={onFail} className="rounded-xl bg-rose-50 py-3 text-sm font-bold text-rose-700">Failed</button>
        <button type="button" onClick={onDeliver} className="rounded-xl bg-emerald-600 py-3 text-sm font-bold text-white">Delivered</button>
      </div>
    </div>
  );
}

function Sheet({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-[2000] flex items-end justify-center bg-slate-900/50" onClick={onClose}>
      <div className="w-full max-w-md rounded-t-3xl bg-white p-5 pb-8" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-bold">{title}</h3>
          <button type="button" onClick={onClose} className="text-sm font-semibold text-slate-500">Cancel</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function DeliverSheet({ order, onClose, onDone, onError }) {
  const [cash, setCash] = useState(order.cod_amount);
  const [photo, setPhoto] = useState(null);
  const [busy, setBusy] = useState(false);
  const preview = photo ? URL.createObjectURL(photo) : null;

  const submit = async () => {
    setBusy(true);
    const form = new FormData();
    form.append("cash_collected", cash || 0);
    if (photo) form.append("photo", photo);
    const pos = await currentPosition();
    if (pos.lat) { form.append("lat", pos.lat); form.append("lng", pos.lng); }
    try {
      await api.post(`/orders/${order.id}/deliver`, form);
      onDone();
    } catch (err) {
      onError(errorText(err));
      setBusy(false);
    }
  };

  const short = Number(cash) < order.cod_amount;
  return (
    <Sheet title={`Delivered to ${order.customer_name}`} onClose={onClose}>
      <label className="block text-sm font-semibold">
        Cash collected (DT)
        <input type="number" inputMode="decimal" step="0.5" value={cash} onChange={(e) => setCash(e.target.value)}
          className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-3 text-lg font-bold tabular-nums" />
      </label>
      {short && <p className="mt-1 text-xs font-semibold text-amber-700">Less than the {dt(order.cod_amount)} expected</p>}

      <label className="mt-4 flex cursor-pointer items-center gap-3 rounded-xl border-2 border-dashed border-slate-300 p-3">
        <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => setPhoto(e.target.files?.[0] || null)} />
        {preview ? <img src={preview} alt="Proof of delivery" className="h-16 w-16 rounded-lg object-cover" />
          : <span className="flex h-16 w-16 items-center justify-center rounded-lg bg-slate-100 text-2xl" aria-hidden="true">📷</span>}
        <span className="text-sm">
          <span className="block font-semibold">{photo ? "Photo added" : "Take proof photo"}</span>
          <span className="text-xs text-slate-500">Package at the door, or with the customer</span>
        </span>
      </label>

      <button type="button" onClick={submit} disabled={busy}
        className="mt-5 w-full rounded-xl bg-emerald-600 py-4 text-base font-bold text-white disabled:bg-emerald-300">
        {busy ? "Saving…" : "Confirm delivery"}
      </button>
    </Sheet>
  );
}

function FailSheet({ order, onClose, onDone, onError }) {
  const [reason, setReason] = useState(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    const pos = await currentPosition();
    try {
      await api.post(`/orders/${order.id}/fail`, { reason, note: note || null, ...pos });
      onDone();
    } catch (err) {
      onError(errorText(err));
      setBusy(false);
    }
  };

  return (
    <Sheet title="Why did it fail?" onClose={onClose}>
      <div className="grid grid-cols-2 gap-2">
        {FAIL_REASONS.map((r) => (
          <button key={r} type="button" onClick={() => setReason(r)}
            className={`rounded-xl border py-3 text-sm font-semibold ${reason === r ? "border-rose-500 bg-rose-50 text-rose-700" : "border-slate-200"}`}>
            {r}
          </button>
        ))}
      </div>
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)"
        className="mt-3 w-full rounded-xl border border-slate-300 px-3 py-3 text-sm" />
      <button type="button" onClick={submit} disabled={!reason || busy}
        className="mt-5 w-full rounded-xl bg-rose-600 py-4 text-base font-bold text-white disabled:bg-rose-300">
        {busy ? "Saving…" : "Mark as failed"}
      </button>
    </Sheet>
  );
}
