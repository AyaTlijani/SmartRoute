import React, { useEffect, useState } from "react";
import { BarChart3 } from "lucide-react";
import { api, dt, errorText, formatDay } from "../../api";
import { EmptyState, ErrorBanner, Loading, Metric, MetricStrip, PageHeader, Panel, cx } from "../../components/ui";

const PERIODS = [7, 30, 90];

export default function Analytics() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    setData(null);
    api.get("/analytics", { params: { days } }).then((r) => setData(r.data)).catch((e) => setError(errorText(e)));
  }, [days]);

  return (
    <>
      <PageHeader title="Analytics"
        description={data ? `${formatDay(data.start)} to ${formatDay(data.end)}, from recorded deliveries.` : "From recorded deliveries."}
        actions={
          <div className="flex rounded-md border border-slate-300 bg-white" role="tablist" aria-label="Period">
            {PERIODS.map((p) => (
              <button key={p} type="button" role="tab" aria-selected={days === p} onClick={() => setDays(p)}
                className={cx("h-9 px-4 text-sm first:rounded-l-md last:rounded-r-md", days === p ? "bg-brand text-white" : "hover:bg-slate-50")}>
                {p} days
              </button>
            ))}
          </div>
        } />
      <ErrorBanner error={error} />
      {!data ? <Loading /> : !data.totals.attempts ? (
        <Panel><EmptyState icon={BarChart3} title="No deliveries in this period">Analytics appear once drivers record deliveries.</EmptyState></Panel>
      ) : <Dashboard data={data} />}
    </>
  );
}

function Dashboard({ data }) {
  const t = data.totals;
  const o = data.orders;
  const gap = Math.max(0, (t.cash_expected || 0) - (t.cash_collected || 0));
  return (
    <div className="space-y-5">
      <MetricStrip>
        <Metric label="Attempt success" value={`${t.success_rate}%`} tone="good" detail={`${t.delivered} of ${t.attempts} attempts`} />
        <Metric label="First-try delivery" value={`${o.first_try_rate}%`} detail={`of ${o.attempted} orders attempted`} />
        <Metric label="Eventually delivered" value={`${o.eventual_rate}%`} detail={`${o.retried} orders needed a retry`} />
        <Metric label="Cash collected" value={dt(t.cash_collected)} detail={`of ${dt(t.cash_expected)} due on deliveries`} />
        <Metric label="Cash gap" value={dt(gap)} tone={gap > 0.5 ? "bad" : undefined} detail={`${t.short_deliveries} short deliveries`} />
      </MetricStrip>

      <Panel title="Delivery attempts per day" description="Each bar is one delivery day. Hover for the numbers.">
        <DailyChart rows={data.by_day} />
      </Panel>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Drivers" bodyClass="">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 text-[13px] text-ink-500">
              <tr>
                <th className="px-5 py-2.5 font-medium">Driver</th>
                <th className="py-2.5 pr-3 font-medium">Attempt success</th>
                <th className="py-2.5 pr-3 text-right font-medium">Stops / day</th>
                <th className="py-2.5 pr-5 text-right font-medium">Cash gap</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.by_driver.map((d) => (
                <tr key={d.driver}>
                  <td className="px-5 py-2.5 font-medium">{d.driver}</td>
                  <td className="py-2.5 pr-3"><Bar value={d.success_rate} label={`${d.success_rate}%`} title={`${d.delivered} of ${d.attempts} attempts`} /></td>
                  <td className="py-2.5 pr-3 text-right tabular">{d.stops_per_day}</td>
                  <td className={cx("py-2.5 pr-5 text-right tabular", d.cash_gap > 0 && "text-red-700")}>{dt(d.cash_gap)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>

        <Panel title="Governorates" description="Lowest attempt success first" bodyClass="">
          <ul className="divide-y divide-slate-100">
            {data.by_governorate.map((g) => (
              <li key={g.governorate} className="grid grid-cols-[110px_minmax(0,1fr)_70px] items-center gap-3 px-5 py-2.5 text-sm">
                <span className="font-medium">{g.governorate}</span>
                <Bar value={g.success_rate} label={`${g.success_rate}%`} title={`${g.delivered} of ${g.attempts} attempts`} />
                <span className="text-right text-[13px] tabular text-ink-500">{g.attempts}</span>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="Why deliveries fail" bodyClass="">
          <ul className="divide-y divide-slate-100">
            {data.reasons.map((r) => (
              <li key={r.reason} className="grid grid-cols-[140px_minmax(0,1fr)] items-center gap-3 px-5 py-2.5 text-sm">
                <span>{r.reason}</span>
                <Bar value={(100 * r.count) / data.reasons[0].count} label={r.count} color="bg-red-600" title={`${r.count} failed attempts`} />
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="Customers who keep refusing" description="By phone number. Their next orders are flagged at import." bodyClass="">
          <table className="w-full text-left text-sm">
            <tbody className="divide-y divide-slate-100">
              {data.risky_customers.map((c) => (
                <tr key={c.phone}>
                  <td className="px-5 py-2.5 font-medium">{c.name}</td>
                  <td className="py-2.5 pr-3 tabular text-ink-500">{c.phone}</td>
                  <td className="py-2.5 pr-5 text-right tabular text-red-700">{c.failed} of {c.attempts} failed</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>

      <details className="rounded-2xl bg-white shadow-card px-5 py-3 text-sm">
        <summary className="cursor-pointer font-medium">How these numbers are calculated</summary>
        <dl className="mt-3 grid gap-3 text-ink-700 sm:grid-cols-2">
          <div><dt className="font-medium">Attempt success</dt><dd>Delivered attempts divided by all attempts. Undone attempts are excluded.</dd></div>
          <div><dt className="font-medium">First-try delivery</dt><dd>Original orders delivered on their first attempt, out of original orders with at least one attempt.</dd></div>
          <div><dt className="font-medium">Eventually delivered</dt><dd>Original orders delivered on any attempt, including next-day retries. A retry is not counted as a new order.</dd></div>
          <div><dt className="font-medium">Cash gap</dt><dd>Amount due on delivered orders minus cash the driver recorded.</dd></div>
        </dl>
      </details>
    </div>
  );
}

function Bar({ value, label, title, color = "bg-brand" }) {
  return (
    <div className="flex items-center gap-2" title={title}>
      <div className="h-2 flex-1 rounded-full bg-slate-100">
        <div className={cx("h-full rounded-full", color)} style={{ width: `${Math.max(2, value)}%` }} />
      </div>
      <span className="w-12 text-right text-[13px] tabular">{label}</span>
    </div>
  );
}

function DailyChart({ rows }) {
  const max = Math.max(...rows.map((r) => r.attempts), 1);
  const H = 180;
  return (
    <div>
      <div className="mb-3 flex gap-4 text-[13px] text-ink-700">
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-emerald-600" />Delivered</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-red-600" />Failed</span>
      </div>
      <div className="relative">
        {[0.5, 1].map((f) => (
          <div key={f} className="absolute inset-x-0 border-t border-dashed border-slate-200" style={{ bottom: H * f }}>
            <span className="absolute -top-2.5 right-0 bg-white pl-1 text-[11px] tabular text-ink-500">{Math.round(max * f)}</span>
          </div>
        ))}
        <div className="flex items-end gap-[2px] border-b border-slate-300 pr-8" style={{ height: H }}>
          {rows.map((r) => (
            <div key={r.day} className="group flex flex-1 flex-col justify-end gap-[2px]" style={{ height: H }}
              title={`${formatDay(r.day)}: ${r.delivered} delivered, ${r.failed} failed (${r.success_rate}%)`}>
              <div className="rounded-t-sm bg-red-600 group-hover:opacity-75" style={{ height: (H * r.failed) / max }} />
              <div className="bg-emerald-600 group-hover:opacity-75" style={{ height: (H * r.delivered) / max }} />
            </div>
          ))}
        </div>
      </div>
      <div className="mt-1.5 flex justify-between pr-8 text-xs text-ink-500">
        <span>{formatDay(rows[0].day)}</span><span>{formatDay(rows[rows.length - 1].day)}</span>
      </div>
    </div>
  );
}
