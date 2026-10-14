import React, { useEffect, useMemo, useState } from "react";
import { API_URL, api, dt, errorText } from "../api";
import { Badge, Button, Card, ErrorBox, Spinner, Stat } from "./ui";

const SLOT = { 0: "Any", 1: "Morning", 2: "Afternoon" };

export default function ImportView({ day, go }) {
  const [validation, setValidation] = useState(null);
  const [included, setIncluded] = useState({});
  const [filter, setFilter] = useState("all");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [existing, setExisting] = useState([]);

  const loadExisting = () =>
    api.get("/orders", { params: { day } }).then((r) => setExisting(r.data)).catch(() => {});

  useEffect(() => {
    loadExisting();
    setValidation(null);
    setResult(null);
  }, [day]);

  const applyValidation = (data) => {
    setValidation(data);
    // Errors can't be imported; possible duplicates start unticked.
    const inc = {};
    data.rows.forEach((r) => {
      inc[r.row] = !r.errors.length && !r.warnings.some((w) => w.includes("duplicate"));
    });
    setIncluded(inc);
  };

  const onFile = async (file) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("day", day);
      applyValidation((await api.post("/orders/validate", form)).data);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const applySuggestion = async (row, field, value) => {
    const rows = validation.rows.map((r) => (r.row === row ? { ...r.raw, [field]: value } : r.raw));
    try {
      const data = (await api.post("/orders/revalidate", { day, rows })).data;
      // Keep the original Excel row numbers.
      data.rows.forEach((r, i) => (r.row = validation.rows[i].row));
      const keep = { ...included, [row]: true };
      setValidation(data);
      setIncluded(keep);
    } catch (err) {
      setError(errorText(err));
    }
  };

  const toImport = useMemo(
    () => (validation ? validation.rows.filter((r) => included[r.row] && !r.errors.length) : []),
    [validation, included]
  );

  const doImport = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = (await api.post("/orders/import", { day, rows: toImport.map((r) => r.raw) })).data;
      setResult(res);
      setValidation(null);
      loadExisting();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const clearDay = async () => {
    if (!window.confirm("Remove this day's orders that are not delivered yet?")) return;
    await api.delete("/orders", { params: { day } });
    setResult(null);
    loadExisting();
  };

  const shown = validation
    ? validation.rows.filter((r) => filter === "all" || r.status !== "ok")
    : [];

  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm font-semibold uppercase tracking-wider text-blue-600">Step 1</p>
        <h2 className="mt-1 text-2xl font-bold tracking-tight">Import confirmed orders</h2>
        <p className="mt-1 max-w-2xl text-sm text-slate-600">
          Upload the Excel file your confirmation team filled in. SmartRoute checks every row
          (phone numbers, governorate names, cash amounts, duplicates, risky customers) before
          anything is saved.
        </p>
      </div>

      <ErrorBox error={error} onClose={() => setError(null)} />

      <Card
        title="Upload the day's Excel file"
        subtitle={`Orders will be scheduled for ${day}.`}
        actions={
          <>
            <a href={`${API_URL}/excel/template`} className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">
              Download template
            </a>
            <a href={`${API_URL}/excel/sample?day=${day}`} className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-700 hover:bg-blue-100">
              Download sample day (58 orders)
            </a>
          </>
        }
      >
        <label
          className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 px-6 py-10 text-center transition hover:border-blue-400 hover:bg-blue-50/40"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            onFile(e.dataTransfer.files?.[0]);
          }}
        >
          <input type="file" accept=".xlsx" className="hidden" onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ""; }} />
          {busy ? <Spinner className="text-blue-600" /> : <span className="text-3xl" aria-hidden="true">📄</span>}
          <span className="text-sm font-semibold text-slate-800">{busy ? "Checking rows…" : "Drop an .xlsx file here, or click to choose"}</span>
          <span className="text-xs text-slate-500">No file yet? Download the sample day above. It includes 5 rows with mistakes to catch.</span>
        </label>
      </Card>

      {result && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
          <p className="text-sm font-semibold text-emerald-800">
            Imported {result.imported} orders for {result.day}.
          </p>
          <Button onClick={() => go("dispatch")}>Assign to drivers →</Button>
        </div>
      )}

      {validation && (
        <Card
          title="Check before importing"
          subtitle="Red rows can't be imported. Fix them in Excel and upload again, or accept a suggestion."
          actions={
            <Button onClick={doImport} disabled={busy || !toImport.length}>
              Import {toImport.length} orders
            </Button>
          }
        >
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Rows" value={validation.summary.total} />
            <Stat label="Ready" value={validation.summary.ok} tone="green" />
            <Stat label="Warnings" value={validation.summary.warning} tone="amber" hint="Importable, worth a look" />
            <Stat label="Errors" value={validation.summary.error} tone="red" hint="Blocked" />
          </div>

          <div className="mt-5 flex gap-1">
            {[["all", "All rows"], ["problems", "Only problems"]].map(([k, l]) => (
              <button key={k} type="button" onClick={() => setFilter(k)}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${filter === k ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`}>
                {l}
              </button>
            ))}
          </div>

          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[820px] text-left text-sm">
              <thead className="text-[11px] uppercase tracking-wide text-slate-500">
                <tr className="border-b border-slate-200">
                  <th className="py-2 pr-2">Import</th>
                  <th className="py-2 pr-2">Row</th>
                  <th className="py-2 pr-2">Status</th>
                  <th className="py-2 pr-2">Customer</th>
                  <th className="py-2 pr-2">Phone</th>
                  <th className="py-2 pr-2">Location</th>
                  <th className="py-2 pr-2 text-right">Cash</th>
                  <th className="py-2 pr-2">Slot</th>
                  <th className="py-2">Issues</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.row} className={`border-b border-slate-100 align-top ${r.status === "error" ? "bg-rose-50/50" : r.status === "warning" ? "bg-amber-50/40" : ""}`}>
                    <td className="py-2 pr-2">
                      <input type="checkbox" disabled={!!r.errors.length} checked={!!included[r.row] && !r.errors.length}
                        onChange={(e) => setIncluded({ ...included, [r.row]: e.target.checked })} aria-label={`Import row ${r.row}`} />
                    </td>
                    <td className="py-2 pr-2 tabular-nums text-slate-500">{r.row}</td>
                    <td className="py-2 pr-2"><Badge kind={r.status} /></td>
                    <td className="py-2 pr-2 font-medium">{r.raw.customer_name || "—"}</td>
                    <td className="py-2 pr-2 tabular-nums">{r.data.phone || r.raw.phone}</td>
                    <td className="py-2 pr-2">
                      {r.data.governorate || r.raw.governorate}
                      <span className="block text-xs text-slate-500">{r.raw.city}</span>
                    </td>
                    <td className="py-2 pr-2 text-right tabular-nums">{r.data.cod_amount != null ? dt(r.data.cod_amount) : r.raw.cod_amount_dt}</td>
                    <td className="py-2 pr-2">{SLOT[r.data.slot] ?? r.raw.slot}</td>
                    <td className="py-2 text-xs">
                      {r.errors.map((e) => <p key={e} className="text-rose-700">{e}</p>)}
                      {r.warnings.map((w) => <p key={w} className="text-amber-700">{w}</p>)}
                      {Object.entries(r.suggestions).map(([field, value]) => (
                        <button key={field} type="button" onClick={() => applySuggestion(r.row, field, value)}
                          className="mt-1 rounded-md bg-blue-600 px-2 py-0.5 text-[11px] font-semibold text-white hover:bg-blue-700">
                          Use “{value}”
                        </button>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Card
        title={`Orders already saved for ${day}`}
        subtitle={existing.length ? `${existing.length} orders` : "None yet"}
        actions={existing.length > 0 && (
          <>
            <Button variant="secondary" onClick={clearDay}>Clear day</Button>
            <Button onClick={() => go("dispatch")}>Go to dispatch →</Button>
          </>
        )}
      >
        {existing.length === 0 ? (
          <p className="text-sm text-slate-500">Import a file to see orders here.</p>
        ) : (
          <div className="flex flex-wrap gap-2 text-xs">
            {["pending", "assigned", "delivered", "failed"].map((s) => (
              <Badge key={s} kind={s}>
                {s === "assigned" ? "to deliver" : s}: {existing.filter((o) => o.status === s).length}
              </Badge>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
