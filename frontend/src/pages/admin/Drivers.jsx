import React, { useEffect, useState } from "react";
import { KeyRound, Pencil, UserPlus, Users } from "lucide-react";
import { api, errorText } from "../../api";
import {
  Badge, Button, EmptyState, ErrorBanner, Field, Input, Loading, Modal, PageHeader, Panel, Select, cx, useToast,
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
        <Panel bodyClass="">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-left text-sm">
              <thead className="border-b border-slate-200 text-[13px] text-ink-500">
                <tr>
                  <th className="px-5 py-2.5 font-medium">Driver</th>
                  <th className="py-2.5 pr-4 font-medium">Login</th>
                  <th className="py-2.5 pr-4 font-medium">Zones</th>
                  <th className="py-2.5 pr-4 font-medium">Starts from</th>
                  <th className="py-2.5 pr-4 text-right font-medium">Today</th>
                  <th className="py-2.5 pr-4 text-right font-medium">Delivered (all time)</th>
                  <th className="py-2.5 pr-4 font-medium">Status</th>
                  <th className="py-2.5 pr-5"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {drivers.map((d) => (
                  <tr key={d.id} className={cx("align-top", !d.active && "text-ink-500")}>
                    <td className="px-5 py-3">
                      <span className="font-medium text-ink">{d.name}</span>
                      <span className="block tabular text-[13px] text-ink-500">{d.phone}, {d.vehicle}</span>
                    </td>
                    <td className="py-3 pr-4 font-mono text-[13px]">{d.username || "No account"}</td>
                    <td className="py-3 pr-4">
                      <div className="flex max-w-[220px] flex-wrap gap-1">{d.zones.split(",").map((z) => <Badge key={z}>{z}</Badge>)}</div>
                    </td>
                    <td className="py-3 pr-4">{d.depot_name}</td>
                    <td className="py-3 pr-4 text-right tabular">{d.today_orders} / {d.max_orders}</td>
                    <td className="py-3 pr-4 text-right tabular">
                      {d.total_attempts ? `${Math.round((100 * d.total_delivered) / d.total_attempts)}%` : "–"}
                      <span className="block text-[13px] text-ink-500">{d.total_attempts} attempts</span>
                    </td>
                    <td className="py-3 pr-4">
                      <button type="button" role="switch" aria-checked={!!d.active} onClick={() => toggle(d)}
                        className="flex items-center gap-2 text-[13px]" aria-label={`${d.name} active`}>
                        <span className={cx("relative h-5 w-9 rounded-full transition-colors", d.active ? "bg-emerald-600" : "bg-slate-300")}>
                          <span className={cx("absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all", d.active ? "left-[18px]" : "left-0.5")} />
                        </span>
                        {d.active ? "Active" : "Inactive"}
                      </button>
                    </td>
                    <td className="py-3 pr-5">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="sm" icon={Pencil} onClick={() => setEditing(d)} disabled={!meta}>Edit</Button>
                        <Button variant="ghost" size="sm" icon={KeyRound} onClick={() => setPassword(d)}>Password</Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
      {editing && meta && (
        <DriverForm driver={editing} meta={meta} onClose={() => setEditing(null)}
          onSaved={(msg) => { setEditing(null); toast(msg); load(); }} />
      )}
      {password && <PasswordForm driver={password} onClose={() => setPassword(null)} onSaved={() => { setPassword(null); toast("Password changed; the driver must sign in again"); }} />}
    </>
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
