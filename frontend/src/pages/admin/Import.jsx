import React, { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, Check, CheckCircle2, Download, FileSpreadsheet, Lock, OctagonAlert, Pencil, Route, Upload } from "lucide-react";
import { api, download, dt, errorText, formatDay, todayISO } from "../../api";
import { DayPicker, useDay } from "../../layouts/AdminLayout";
import {
  Badge, Button, EmptyState, ErrorBanner, Field, Input, Modal, PageHeader, Panel, Spinner, StatCard, cx, useToast,
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
      {day >= todayISO() && <Steps current={result ? 2 : validation ? 1 : 0} />}

      {result && (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-3xl bg-gradient-to-br from-[#CDEFD9] via-[#BDE8CF] to-[#A6DEBE] px-6 py-5 shadow-card">
          <div className="flex items-center gap-4">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white/80 text-brand-700"><CheckCircle2 className="h-6 w-6" /></span>
            <div>
              <p className="text-lg font-bold text-ink">{result.imported} orders imported for {formatDay(result.day)}</p>
              <p className="text-sm text-ink-700">
                {result.errors} row(s) rejected with errors, {result.excluded - result.errors} excluded by you.
              </p>
            </div>
          </div>
          <Link to="/admin/dispatch"><Button icon={Route}>Assign to drivers</Button></Link>
        </div>
      )}

      {day < todayISO() && (
        <Panel><EmptyState icon={Lock} title="Past days are read-only">
          Orders can only be imported for today or a future day. Use the day picker to choose one.
        </EmptyState></Panel>
      )}

      {!validation && day >= todayISO() && (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <Panel title="Upload the day's file" description={`Orders will be scheduled for ${formatDay(day)}`} bodyClass="px-6 pb-6">
            <label
              className="flex cursor-pointer flex-col items-center justify-center rounded-3xl border-2 border-dashed border-mint-300 bg-mint-50 px-6 py-16 text-center transition-colors hover:border-brand hover:bg-mint"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); onFile(e.dataTransfer.files?.[0]); }}
            >
              <input type="file" accept=".xlsx" className="sr-only" onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ""; }} />
              <span className="flex h-16 w-16 items-center justify-center rounded-full bg-brand text-white shadow-[0_10px_24px_rgba(22,147,92,0.35)]">
                {busy ? <Spinner className="h-7 w-7 text-white" /> : <Upload className="h-7 w-7" aria-hidden="true" />}
              </span>
              <span className="mt-4 text-base font-bold">{busy ? `Checking ${file}` : "Drop the .xlsx file here"}</span>
              <span className="mt-1 text-[13px] text-ink-500">or <span className="font-semibold text-brand underline-offset-2 hover:underline">choose a file</span>. Up to 2,000 rows, 5 MB.</span>
            </label>
          </Panel>
          <Panel title="Files to start from" bodyClass="px-3 pb-4">
            <div className="space-y-1">
              <FileLink icon={Download} title="Template" onClick={() => download("/excel/template", "smartroute_template.xlsx")}>
                Empty file with the expected columns and how to fill them. French headers work too.
              </FileLink>
              <FileLink icon={FileSpreadsheet} title="Sample day" onClick={() => download("/excel/sample", `orders_${day}.xlsx`, { day })}>
                59 generated orders with a few mistakes on purpose: a bad phone, a misspelled governorate, a missing address, a duplicate.
              </FileLink>
            </div>
            <div className="mx-3 mt-3 rounded-2xl bg-mint-50 p-4 text-[13px] text-ink-700">
              <p className="font-semibold text-ink">What gets checked</p>
              <p className="mt-1">Phone format, governorate spelling, address, amount and slot. Repeat customers who refused before are flagged.</p>
            </div>
          </Panel>
        </div>
      )}

      {validation && (
        <div className="mb-6 grid gap-4 sm:grid-cols-3">
          <StatCard icon={CheckCircle2} tone="good" label="Ready" value={validation.summary.ok} detail="Pass every check" />
          <StatCard icon={AlertTriangle} tone="warn" label="Warnings" value={validation.summary.warning} detail="Can be imported; worth a look" />
          <StatCard icon={OctagonAlert} tone={validation.summary.error ? "bad" : undefined} label="Errors" value={validation.summary.error} detail="Fix them or they are skipped" />
        </div>
      )}
      {validation && (
        <Panel bodyClass="px-5 pb-5"
          title={`Review ${file}`}
          description={`${validation.summary.total} rows: ${validation.summary.ok} ready, ${validation.summary.warning} with warnings, ${validation.summary.error} with errors`}
          actions={<>
            <Button variant="ghost" onClick={() => setValidation(null)}>Cancel</Button>
            <Button onClick={doImport} loading={busy} disabled={!selected.length}>Import {selected.length} orders</Button>
          </>}>
          <div className="mb-3 inline-flex gap-1 rounded-full bg-mint-50 p-1">
            {[["problems", `Needs a look (${validation.summary.error + validation.summary.warning})`], ["all", `All rows (${validation.summary.total})`]].map(([k, l]) => (
              <button key={k} type="button" onClick={() => setFilter(k)}
                className={cx("rounded-full px-4 py-1.5 text-[13px] font-semibold", filter === k ? "bg-brand text-white" : "text-ink-700 hover:bg-white")}>{l}</button>
            ))}
          </div>
          <div className="overflow-x-auto">
            <table className="table-soft min-w-[900px]">
              <thead>
                <tr>
                  <th className="w-12"><span className="sr-only">Import</span></th>
                  <th>Row</th>
                  <th>Customer</th>
                  <th>Location</th>
                  <th className="text-right">COD</th>
                  <th>Slot</th>
                  <th>Check result</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.row} className={cx("align-top", r.errors.length && "bg-red-50/50")}>
                    <td>
                      <input type="checkbox" className="h-4 w-4 accent-brand" disabled={!!r.errors.length}
                        checked={!!included[r.row] && !r.errors.length} aria-label={`Import row ${r.row}`}
                        onChange={(e) => setIncluded({ ...included, [r.row]: e.target.checked })} />
                    </td>
                    <td className="tabular text-ink-500">{r.row}</td>
                    <td>
                      <span className="font-medium">{r.raw.customer_name || "No name"}</span>
                      <span className="block tabular text-[13px] text-ink-500">{r.data.phone || r.raw.phone}</span>
                    </td>
                    <td>
                      {r.data.governorate || r.raw.governorate || "No governorate"}
                      <span className="block text-[13px] text-ink-500">{r.raw.city}</span>
                    </td>
                    <td className="text-right tabular">{r.data.cod_amount != null ? dt(r.data.cod_amount) : r.raw.cod_amount_dt}</td>
                    <td>{SLOT[r.data.slot] ?? r.raw.slot}</td>
                    <td>
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

const STEPS = ["Upload the file", "Review the rows", "Assign to drivers"];
function Steps({ current }) {
  return (
    <ol className="mb-6 flex flex-wrap items-center gap-2 rounded-full bg-white/70 p-1.5 shadow-card sm:inline-flex">
      {STEPS.map((label, i) => (
        <li key={label} className={cx("flex items-center gap-2 rounded-full py-1.5 pl-1.5 pr-4 text-sm font-semibold",
          i === current ? "bg-mint-200 text-ink" : i < current ? "text-brand-700" : "text-ink-500")}>
          <span className={cx("flex h-7 w-7 items-center justify-center rounded-full text-xs",
            i < current ? "bg-brand text-white" : i === current ? "bg-white text-brand-700" : "bg-mint-50 text-ink-500")}>
            {i < current ? <Check className="h-4 w-4" /> : i + 1}
          </span>
          {label}
        </li>
      ))}
    </ol>
  );
}

function FileLink({ icon: Icon, title, onClick, children }) {
  return (
    <button type="button" onClick={onClick} className="flex w-full items-start gap-3 rounded-2xl px-3 py-3 text-left hover:bg-mint-50">
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-mint-200 text-brand-700"><Icon className="h-5 w-5" /></span>
      <span>
        <span className="block text-sm font-bold text-ink">{title}</span>
        <span className="block text-[13px] text-ink-500">{children}</span>
      </span>
    </button>
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

