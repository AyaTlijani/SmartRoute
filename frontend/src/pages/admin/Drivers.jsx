import React, { useEffect, useState } from "react";
import { Bike, Car, KeyRound, MapPin, Pencil, Phone, UserPlus, Users } from "lucide-react";
import { api, errorText } from "../../api";
import {
  Button, EmptyState, ErrorBanner, Field, Input, Loading, Modal, PageHeader, Panel, Select, cx, useToast,
} from "../../components/ui";

export default function Drivers() {
  const toast = useToast();
  const [drivers, setDrivers] = useState(null);
  const [meta, setMeta] = useState(null);
  const [editing, setEditing] = useState(null); // driver object, or {} for new
  const [password, setPassword] = useState(null);
  const [error, setError] = useState(null);

  const load = () => api.get("/drivers").then((r) => setDrivers(r.data)).catch((e) => setError(errorText(e)));
  useEffect(() => {
    load();
    api.get("/meta").then((r) => setMeta(r.data)).catch(() => {});
  }, []);

  const toggle = async (d) => {
    try {
      const r = (await api.put(`/drivers/${d.id}`, payload(d, { active: !d.active }))).data;
      toast(r.active ? `${d.name} is active` : `${d.name} is inactive${r.released_orders ? `; ${r.released_orders} open order(s) went back to unassigned` : ""}`);
      load();
    } catch (e) {
      setError(errorText(e));
    }
  };

  return (
    <>
      <PageHeader title="Drivers"
        description="Each driver has their own login and only sees their own deliveries. Zones, depot and capacity decide which orders they can get."
        actions={<Button icon={UserPlus} onClick={() => setEditing({})} disabled={!meta}>Add driver</Button>} />
      <ErrorBanner error={error} onClose={() => setError(null)} />
      {!drivers ? <Loading /> : drivers.length === 0 ? (
        <Panel><EmptyState icon={Users} title="No drivers yet" action={<Button onClick={() => setEditing({})}>Add driver</Button>} /></Panel>
      ) : (
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {drivers.map((d) => <DriverCard key={d.id} d={d} meta={meta} onToggle={() => toggle(d)}
            onEdit={() => setEditing(d)} onPassword={() => setPassword(d)} />)}
          <button type="button" onClick={() => setEditing({})} disabled={!meta}
            className="flex min-h-[260px] flex-col items-center justify-center gap-3 rounded-3xl border-2 border-dashed border-mint-300 bg-white/50 text-ink-700 transition-colors hover:border-brand hover:bg-white">
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-mint-200 text-brand-700"><UserPlus className="h-6 w-6" /></span>
            <span className="font-semibold">Add a driver</span>
            <span className="max-w-[220px] text-center text-[13px] text-ink-500">Creates their login so they can open the driver app on their phone.</span>
          </button>
        </div>
      )}
      {editing && meta && (
        <DriverForm driver={editing} meta={meta} onClose={() => setEditing(null)}
          onSaved={(msg) => { setEditing(null); toast(msg); load(); }} />
      )}
      {password && <PasswordForm driver={password} onClose={() => setPassword(null)} onSaved={() => { setPassword(null); toast("Password changed; the driver must sign in again"); }} />}
    </>
  );
}

function DriverCard({ d, meta, onToggle, onEdit, onPassword }) {
  const load = d.max_orders ? Math.min(100, (100 * d.today_orders) / d.max_orders) : 0;
  const rate = d.total_attempts ? Math.round((100 * d.total_delivered) / d.total_attempts) : null;
  const Vehicle = d.vehicle === "car" || d.vehicle === "van" ? Car : Bike;
  return (
    <article className={cx("flex flex-col rounded-3xl border border-white/60 bg-white p-5 shadow-card transition-opacity", !d.active && "opacity-60")}>
      <div className="flex items-start gap-3">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-mint-200 to-mint-300 text-base font-bold text-brand-700">
          {d.name.split(" ").map((w) => w[0]).slice(0, 2).join("")}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-bold">{d.name}</h2>
          <p className="font-mono text-[13px] text-ink-500">@{d.username || "no account"}</p>
        </div>
        <button type="button" role="switch" aria-checked={!!d.active} onClick={onToggle} aria-label={`${d.name} active`}
          title={d.active ? "Active" : "Inactive"}
          className={cx("relative mt-1 h-6 w-11 shrink-0 rounded-full transition-colors", d.active ? "bg-brand" : "bg-slate-300")}>
          <span className={cx("absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all", d.active ? "left-[22px]" : "left-0.5")} />
        </button>
      </div>

      <div className="mt-4 flex flex-wrap gap-1.5">
        {d.zones.split(",").map((z) => (
          <span key={z} className="rounded-full bg-mint px-2.5 py-1 text-xs font-semibold text-brand-700">{z}</span>
        ))}
      </div>

      <ul className="mt-4 space-y-1.5 text-[13px] text-ink-700">
        <li className="flex items-center gap-2"><MapPin className="h-4 w-4 text-ink-300" aria-hidden="true" />{d.depot_name}</li>
        <li className="flex items-center gap-2"><Phone className="h-4 w-4 text-ink-300" aria-hidden="true" /><span className="tabular">{d.phone}</span></li>
        <li className="flex items-center gap-2 capitalize"><Vehicle className="h-4 w-4 text-ink-300" aria-hidden="true" />{d.vehicle}</li>
      </ul>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="rounded-2xl bg-mint-50 px-3.5 py-3">
          <p className="text-xs font-medium text-ink-500">Today</p>
          <p className="text-lg font-extrabold tabular">{d.today_orders}<span className="text-sm font-semibold text-ink-500"> / {d.max_orders}</span></p>
          <div className="mt-1 h-1.5 rounded-full bg-mint-200"><div className="h-full rounded-full bg-brand" style={{ width: `${load}%` }} /></div>
        </div>
        <div className="rounded-2xl bg-mint-50 px-3.5 py-3">
          <p className="text-xs font-medium text-ink-500">Delivered, all time</p>
          <p className="text-lg font-extrabold tabular">{rate === null ? "–" : `${rate}%`}</p>
          <p className="text-xs tabular text-ink-500">{d.total_attempts} attempts</p>
        </div>
      </div>

      <div className="mt-4 flex gap-2 border-t border-slate-100 pt-4">
        <Button variant="secondary" size="sm" icon={Pencil} onClick={onEdit} disabled={!meta} className="flex-1">Edit</Button>
        <Button variant="secondary" size="sm" icon={KeyRound} onClick={onPassword} className="flex-1">Password</Button>
      </div>
    </article>
  );
}

function payload(d, patch = {}) {
  return {
    name: d.name, phone: d.phone, vehicle: d.vehicle,
    zones: Array.isArray(d.zones) ? d.zones : d.zones.split(","),
    depot_name: d.depot_name, depot_lat: d.depot_lat, depot_lng: d.depot_lng,
    max_orders: Number(d.max_orders), active: !!d.active, ...patch,
  };
}

function DriverForm({ driver, meta, onClose, onSaved }) {
  const isNew = !driver.id;
  const [f, setF] = useState(() => ({
    name: driver.name || "", phone: driver.phone || "", vehicle: driver.vehicle || "scooter",
    zones: driver.zones ? driver.zones.split(",") : [], max_orders: driver.max_orders || 20,
    depot_name: driver.depot_name || meta.depots[0].name, active: driver.id ? !!driver.active : true,
    username: "", password: "",
  }));
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const save = async () => {
    setBusy(true);
    setError(null);
    const depot = meta.depots.find((d) => d.name === f.depot_name);
    const body = {
      ...payload({ ...f, depot_lat: depot.lat, depot_lng: depot.lng }),
      ...(isNew ? { username: f.username.trim(), password: f.password } : {}),
    };
    try {
      if (isNew) await api.post("/drivers", body);
      else {
        const r = (await api.put(`/drivers/${driver.id}`, body)).data;
        if (r.released_orders) return onSaved(`Saved. ${r.released_orders} open order(s) went back to unassigned.`);
      }
      onSaved(isNew ? `${f.name} added. They can sign in as ${f.username}.` : "Driver saved");
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };

  const toggleZone = (z) => setF({ ...f, zones: f.zones.includes(z) ? f.zones.filter((x) => x !== z) : [...f.zones, z] });

  return (
    <Modal title={isNew ? "Add driver" : `Edit ${driver.name}`} onClose={onClose} wide
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={save}>{isNew ? "Add driver" : "Save changes"}</Button></>}>
      <ErrorBanner error={error} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Full name"><Input value={f.name} onChange={set("name")} /></Field>
        <Field label="Phone" hint="8 digits"><Input value={f.phone} onChange={set("phone")} inputMode="numeric" /></Field>
        <Field label="Vehicle">
          <Select value={f.vehicle} onChange={set("vehicle")}>{meta.vehicles.map((v) => <option key={v}>{v}</option>)}</Select>
        </Field>
        <Field label="Maximum orders per day"><Input type="number" min="1" max="100" value={f.max_orders} onChange={set("max_orders")} /></Field>
        <Field label="Starts from" className="sm:col-span-2">
          <Select value={f.depot_name} onChange={set("depot_name")}>{meta.depots.map((d) => <option key={d.name}>{d.name}</option>)}</Select>
        </Field>
      </div>
      <fieldset className="mt-4">
        <legend className="text-[13px] font-medium text-ink-700">Zones covered ({f.zones.length} selected)</legend>
        <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-4">
          {meta.governorates.map((g) => (
            <label key={g} className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="h-4 w-4 accent-brand" checked={f.zones.includes(g)} onChange={() => toggleZone(g)} />{g}
            </label>
          ))}
        </div>
      </fieldset>
      {isNew && (
        <div className="mt-5 grid gap-4 border-t border-slate-200 pt-4 sm:grid-cols-2">
          <Field label="Username" hint="Letters, numbers, dot, dash"><Input value={f.username} onChange={set("username")} autoComplete="off" /></Field>
          <Field label="Temporary password" hint="At least 6 characters"><Input type="text" value={f.password} onChange={set("password")} autoComplete="new-password" /></Field>
        </div>
      )}
    </Modal>
  );
}

function PasswordForm({ driver, onClose, onSaved }) {
  const [pw, setPw] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await api.post(`/drivers/${driver.id}/password`, { password: pw });
      onSaved();
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };
  return (
    <Modal title={`New password for ${driver.name}`} onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={save} disabled={pw.length < 6}>Set password</Button></>}>
      <ErrorBanner error={error} />
      <Field label="New password" hint="At least 6 characters. The driver is signed out everywhere.">
        <Input value={pw} onChange={(e) => setPw(e.target.value)} autoFocus />
      </Field>
    </Modal>
  );
}
