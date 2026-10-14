import React, { useEffect, useState } from "react";
import { api, dt, errorText } from "../api";
import { Card, ErrorBox, Spinner, Stat } from "./ui";

const PERIODS = [7, 30, 90];

export default function AnalyticsView() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.get("/analytics", { params: { days } })
      .then((r) => setData(r.data))
      .catch((err) => setError(errorText(err)));
  }, [days]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wider text-blue-600">Performance</p>
          <h2 className="mt-1 text-2xl font-bold tracking-tight">Analytics</h2>
          <p className="mt-1 text-sm text-slate-600">Every delivery attempt, grouped by day, driver, region and failure reason.</p>
        </div>
        <div className="flex gap-1 rounded-xl bg-slate-200 p-1">
          {PERIODS.map((p) => (
            <button key={p} type="button" onClick={() => setDays(p)}
              className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${days === p ? "bg-white shadow-sm" : "text-slate-600"}`}>
              {p} days
            </button>
          ))}
        </div>
      </div>

      <ErrorBox error={error} />
      {!data ? <p className="flex items-center gap-2 text-sm text-slate-500"><Spinner /> Loading…</p> : <Dashboard data={data} />}
    </div>
  );
}

function Dashboard({ data }) {
  const t = data.totals;
  if (!t.attempts) return <Card><p className="text-sm text-slate-500">No finished deliveries in this period yet.</p></Card>;
  const shortfall = (t.cash_expected || 0) - (t.cash_collected || 0);
  const worstRegion = data.by_governorate[0];

  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Success rate" value={`${t.success_rate}%`} hint={`${t.attempts} delivery attempts`} tone="green" />
        <Stat label="Delivered" value={t.delivered} />
        <Stat label="Failed" value={t.failed} tone="red" hint={worstRegion && `Worst region: ${worstRegion.governorate} (${worstRegion.success_rate}%)`} />
        <Stat label="Cash collected" value={dt(t.cash_collected)}
          hint={shortfall > 0.5 ? `${dt(shortfall)} short of expected` : "Matches expected"} tone={shortfall > 0.5 ? "amber" : "slate"} />
      </div>

      <Card title="Deliveries per day" subtitle="Hover a bar for exact numbers">
        <DailyChart rows={data.by_day} />
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Success rate by driver">
          <BarList rows={data.by_driver} label={(r) => r.driver} value={(r) => r.success_rate} max={100}
            format={(v) => `${v}%`} detail={(r) => `${r.delivered} delivered, ${r.failed} failed`} />
        </Card>
        <Card title="Success rate by governorate" subtitle="Lowest first">
          <BarList rows={data.by_governorate} label={(r) => r.governorate} value={(r) => r.success_rate} max={100}
            format={(v) => `${v}%`} detail={(r) => `${r.delivered} delivered, ${r.failed} failed`} />
        </Card>
        <Card title="Why deliveries fail">
          <BarList rows={data.reasons} label={(r) => r.reason} value={(r) => r.count}
            max={Math.max(...data.reasons.map((r) => r.count), 1)} format={(v) => v} color="bg-rose-500" />
        </Card>
        <Card title="Customers who keep refusing" subtitle="Matched by phone number. Their next orders are flagged at import.">
          <table className="w-full text-left text-sm">
            <thead className="text-[11px] uppercase tracking-wide text-slate-500">
              <tr className="border-b border-slate-200">
                <th className="py-2">Customer</th><th className="py-2">Phone</th><th className="py-2 text-right">Failed</th>
              </tr>
            </thead>
            <tbody>
              {data.risky_customers.map((c) => (
                <tr key={c.phone} className="border-b border-slate-100">
                  <td className="py-2 font-medium">{c.name}</td>
                  <td className="py-2 tabular-nums text-slate-600">{c.phone}</td>
                  <td className="py-2 text-right tabular-nums font-semibold text-rose-700">{c.failed} of {c.orders}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    </>
  );
}

function BarList({ rows, label, value, max, format, detail, color = "bg-blue-600" }) {
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => (
        <li key={label(r)} title={detail ? `${label(r)}: ${detail(r)}` : undefined}>
          <div className="flex justify-between text-sm">
            <span className="font-medium">{label(r)}</span>
            <span className="tabular-nums text-slate-700">{format(value(r))}</span>
          </div>
          <div className="mt-1 h-2 rounded-full bg-slate-100">
            <div className={`h-full rounded-full ${color}`} style={{ width: `${(100 * value(r)) / max}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

function DailyChart({ rows }) {
  const max = Math.max(...rows.map((r) => r.delivered + r.failed), 1);
  const H = 160;
  return (
    <div>
      <div className="mb-3 flex gap-4 text-xs text-slate-600">
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-emerald-500" /> Delivered</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-rose-500" /> Failed</span>
      </div>
      <div className="flex items-end gap-[3px] border-b border-slate-200" style={{ height: H }}>
        {rows.map((r) => (
          <div key={r.day} className="group relative flex flex-1 flex-col justify-end gap-[2px]" style={{ height: H }}
            title={`${r.day}: ${r.delivered} delivered, ${r.failed} failed (${r.success_rate}%)`}>
            <div className="rounded-t-[3px] bg-rose-500 group-hover:opacity-80" style={{ height: (H * r.failed) / max }} />
            <div className="bg-emerald-500 group-hover:opacity-80" style={{ height: (H * r.delivered) / max }} />
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-slate-500">
        <span>{rows[0]?.day}</span>
        <span>max {max} / day</span>
        <span>{rows[rows.length - 1]?.day}</span>
      </div>
    </div>
  );
}
