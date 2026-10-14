import React, { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, Download, FileSpreadsheet, Lock, Pencil, Upload } from "lucide-react";
import { api, download, dt, errorText, formatDay, todayISO } from "../../api";
import { DayPicker, useDay } from "../../layouts/AdminLayout";
import {
  Badge, Button, EmptyState, ErrorBanner, Field, Input, Modal, PageHeader, Panel, Spinner, cx, useToast,
} from "../../components/ui";

const SLOT = { 0: "Any time", 1: "Morning", 2: "Afternoon" };
const EDITABLE = [
  ["customer_name", "Customer name"], ["phone", "Phone"], ["governorate", "Governorate"], ["city", "City"],
  ["address", "Address"], ["landmark", "Landmark"], ["product", "Product"], ["cod_amount_dt", "COD (DT)"],
  ["slot", "Slot (morning, afternoon or empty)"], ["notes", "Notes"],
];

export default function Import() {
  const { day } = useDay();
  const toast = useToast();
  const [file, setFile] = useState(null);
  const [validation, setValidation] = useState(null);
  const [included, setIncluded] = useState({});
  const [filter, setFilter] = useState("problems");
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  const apply = (data, keep = {}) => {
    setValidation(data);
    const inc = {};
    data.rows.forEach((r) => {
      inc[r.row] = r.row in keep ? keep[r.row] && !r.errors.length
        : !r.errors.length && !r.warnings.some((w) => w.includes("duplicate"));
    });
    setIncluded(inc);
  };

  const onFile = async (f) => {
    if (!f) return;
    setBusy(true);
    setError(null);
    setResult(null);
    setFile(f.name);
    try {
      const form = new FormData();
      form.append("file", f);
      form.append("day", day);
      apply((await api.post("/orders/validate", form)).data);
    } catch (err) {
      setError(errorText(err));
      setValidation(null);
    } finally {
      setBusy(false);
    }
  };

  // Re-check every row after a correction. Excel row numbers are kept.
  const revalidate = async (changedRow, patch) => {
    const rows = validation.rows.map((r) => (r.row === changedRow ? { ...r.raw, ...patch } : r.raw));
    try {
      const data = (await api.post("/orders/revalidate", { day, rows })).data;
      data.rows.forEach((r, i) => (r.row = validation.rows[i].row));
      const fixed = data.rows.find((r) => r.row === changedRow);
      apply(data, { ...included, [changedRow]: !fixed.errors.length });
      if (!fixed.errors.length) toast(`Row ${changedRow} is fixed`);
    } catch (err) {
      setError(errorText(err));
    }
  };

  const selected = useMemo(() => (validation ? validation.rows.filter((r) => included[r.row] && !r.errors.length) : []), [validation, included]);

  const doImport = async () => {
    setBusy(true);
    try {
      const res = (await api.post("/orders/import", { day, rows: selected.map((r) => r.raw) })).data;
      setResult({ ...res, excluded: validation.rows.length - selected.length, errors: validation.summary.error });
      setValidation(null);
      toast(`${res.imported} orders imported for ${formatDay(day)}`);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const shown = validation ? validation.rows.filter((r) => filter === "all" || r.status !== "ok") : [];

  return (
    <>
      <PageHeader title="Import orders" description="Upload the confirmed-orders Excel file. Every row is checked before anything is saved."
        actions={<DayPicker />} />
      <ErrorBanner error={error} onClose={() => setError(null)} />

      {result && (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-5 py-4">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="mt-0.5 h-5 w-5 text-emerald-700" />
            <div>
              <p className="font-medium text-emerald-900">{result.imported} orders imported for {formatDay(result.day)}</p>
              <p className="text-sm text-emerald-800">
                {result.errors} row(s) rejected with errors, {result.excluded - result.errors} excluded by you.
              </p>
            </div>
          </div>
          <Link to="/admin/dispatch"><Button>Assign to drivers</Button></Link>
        </div>
      )}

      {day < todayISO() && (
        <Panel><EmptyState icon={Lock} title="Past days are read-only">
          Orders can only be imported for today or a future day. Use the day picker to choose one.
        </EmptyState></Panel>
      )}

      {!validation && day >= todayISO() && (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <Panel title="Upload" bodyClass="p-5">
            <label
              className="flex cursor-pointer flex-col items-center justify-center rounded-md border-2 border-dashed border-slate-300 px-6 py-14 text-center hover:border-brand hover:bg-brand-50/40"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); onFile(e.dataTransfer.files?.[0]); }}
            >
              <input type="file" accept=".xlsx" className="sr-only" onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ""; }} />
              {busy ? <Spinner className="h-7 w-7 text-brand" /> : <Upload className="h-7 w-7 text-ink-300" aria-hidden="true" />}
              <span className="mt-3 text-[15px] font-medium">{busy ? `Checking ${file}` : "Drop the .xlsx file here, or choose a file"}</span>
              <span className="mt-1 text-[13px] text-ink-500">Orders will be scheduled for {formatDay(day)}. Up to 2,000 rows, 5 MB.</span>
            </label>
          </Panel>
          <Panel title="Files to start from">
            <div className="space-y-4 text-sm">
              <div>
                <Button variant="secondary" icon={Download} onClick={() => download("/excel/template", "smartroute_template.xlsx")}>Template</Button>
                <p className="mt-1.5 text-[13px] text-ink-500">Empty file with the expected columns and how to fill them. French headers work too.</p>
              </div>
              <div>
                <Button variant="secondary" icon={FileSpreadsheet} onClick={() => download("/excel/sample", `orders_${day}.xlsx`, { day })}>Sample day</Button>
                <p className="mt-1.5 text-[13px] text-ink-500">59 generated orders with a few mistakes on purpose: a bad phone, a misspelled governorate, a missing address, a duplicate.</p>
              </div>
            </div>
          </Panel>
        </div>
      )}

      {validation && (
        <Panel bodyClass=""
          title={`Review ${file}`}
          description={`${validation.summary.total} rows: ${validation.summary.ok} ready, ${validation.summary.warning} with warnings, ${validation.summary.error} with errors`}
          actions={<>
            <Button variant="ghost" onClick={() => setValidation(null)}>Cancel</Button>
            <Button onClick={doImport} loading={busy} disabled={!selected.length}>Import {selected.length} orders</Button>
          </>}>
          <div className="flex gap-1 border-b border-slate-200 px-5 py-2.5">
            {[["problems", `Needs a look (${validation.summary.error + validation.summary.warning})`], ["all", `All rows (${validation.summary.total})`]].map(([k, l]) => (
              <button key={k} type="button" onClick={() => setFilter(k)}
                className={cx("rounded-md px-3 py-1.5 text-[13px]", filter === k ? "bg-ink text-white" : "text-ink-700 hover:bg-slate-100")}>{l}</button>
            ))}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead className="border-b border-slate-200 text-[13px] text-ink-500">
                <tr>
                  <th className="w-12 px-5 py-2.5 font-medium"><span className="sr-only">Import</span></th>
                  <th className="py-2.5 pr-3 font-medium">Row</th>
                  <th className="py-2.5 pr-3 font-medium">Customer</th>
                  <th className="py-2.5 pr-3 font-medium">Location</th>
                  <th className="py-2.5 pr-3 text-right font-medium">COD</th>
                  <th className="py-2.5 pr-3 font-medium">Slot</th>
                  <th className="py-2.5 pr-5 font-medium">Check result</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {shown.map((r) => (
                  <tr key={r.row} className={cx("align-top", r.errors.length && "bg-red-50/50")}>
                    <td className="px-5 py-3">
                      <input type="checkbox" className="h-4 w-4 accent-brand" disabled={!!r.errors.length}
                        checked={!!included[r.row] && !r.errors.length} aria-label={`Import row ${r.row}`}
                        onChange={(e) => setIncluded({ ...included, [r.row]: e.target.checked })} />
                    </td>
                    <td className="py-3 pr-3 tabular text-ink-500">{r.row}</td>
                    <td className="py-3 pr-3">
                      <span className="font-medium">{r.raw.customer_name || "No name"}</span>
                      <span className="block tabular text-[13px] text-ink-500">{r.data.phone || r.raw.phone}</span>
                    </td>
                    <td className="py-3 pr-3">
                      {r.data.governorate || r.raw.governorate || "No governorate"}
                      <span className="block text-[13px] text-ink-500">{r.raw.city}</span>
                    </td>
                    <td className="py-3 pr-3 text-right tabular">{r.data.cod_amount != null ? dt(r.data.cod_amount) : r.raw.cod_amount_dt}</td>
                    <td className="py-3 pr-3">{SLOT[r.data.slot] ?? r.raw.slot}</td>
                    <td className="py-3 pr-5">
                      {r.status === "ok" && <Badge tone="good">Ready</Badge>}
                      <ul className="space-y-0.5 text-[13px]">
                        {r.errors.map((e) => <li key={e} className="text-red-800">{e}</li>)}
                        {r.warnings.map((w) => <li key={w} className="text-amber-800">{w}</li>)}
                      </ul>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {Object.entries(r.suggestions).map(([field, value]) => (
                          <Button key={field} size="sm" onClick={() => revalidate(r.row, { [field]: value })}>Use {value}</Button>
                        ))}
                        {r.status !== "ok" && (
                          <Button size="sm" variant="secondary" icon={Pencil} onClick={() => setEditing(r)}>Edit row</Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {shown.length === 0 && <p className="px-5 py-8 text-sm text-ink-500">Every row passed the checks.</p>}
          </div>
        </Panel>
      )}

      {editing && (
        <RowEditor row={editing} onClose={() => setEditing(null)}
          onSave={async (patch) => { await revalidate(editing.row, patch); setEditing(null); }} />
      )}
    </>
  );
}

function RowEditor({ row, onClose, onSave }) {
  const [values, setValues] = useState(row.raw);
  const [saving, setSaving] = useState(false);
  return (
    <Modal title={`Edit row ${row.row}`} onClose={onClose} wide
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button loading={saving} onClick={async () => { setSaving(true); await onSave(values); }}>Check again</Button>
      </>}>
      <ul className="mb-4 space-y-0.5 text-[13px]">
        {row.errors.map((e) => <li key={e} className="text-red-800">{e}</li>)}
        {row.warnings.map((w) => <li key={w} className="text-amber-800">{w}</li>)}
      </ul>
      <div className="grid gap-3 sm:grid-cols-2">
        {EDITABLE.map(([k, label]) => (
          <Field key={k} label={label}>
            <Input value={values[k] ?? ""} onChange={(e) => setValues({ ...values, [k]: e.target.value })} />
          </Field>
        ))}
      </div>
      <p className="mt-3 text-xs text-ink-500">Changes apply to this import only; the Excel file is not modified.</p>
    </Modal>
  );
}

