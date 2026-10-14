import React, { useEffect, useState } from "react";
import { Banknote, BarChart3, CheckCircle2, PackageCheck, RotateCcw, Wallet } from "lucide-react";
import { api, dt, errorText, formatDay } from "../../api";
import { EmptyState, ErrorBanner, IconBadge, Loading, PageHeader, Panel, StatCard, cx } from "../../components/ui";

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
          <div className="flex h-11 items-center gap-1 rounded-full bg-white p-1 shadow-card" role="tablist" aria-label="Period">
            {PERIODS.map((p) => (
              <button key={p} type="button" role="tab" aria-selected={days === p} onClick={() => setDays(p)}
                className={cx("h-9 rounded-full px-4 text-sm font-semibold transition-colors",
                  days === p ? "bg-brand text-white shadow-[0_6px_14px_rgba(22,147,92,0.35)]" : "text-ink-700 hover:bg-mint-50")}>
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

function initials(name) {
  return name.split(" ").map((w) => w[0]).slice(0, 2).join("");
}

function Dashboard({ data }) {
  const t = data.totals;
  const o = data.orders;
  const gap = Math.max(0, (t.cash_expected || 0) - (t.cash_collected || 0));
  const cashPct = t.cash_expected ? Math.round((1000 * t.cash_collected) / t.cash_expected) / 10 : 100;
  const maxReason = data.reasons[0]?.count || 1;
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={CheckCircle2} label="Attempt success" value={`${t.success_rate}%`} tone="good" detail={`${t.delivered} of ${t.attempts} attempts`} />
        <StatCard icon={PackageCheck} label="First-try delivery" value={`${o.first_try_rate}%`} detail={`of ${o.attempted} orders attempted`} />
        <StatCard icon={RotateCcw} label="Eventually delivered" value={`${o.eventual_rate}%`} detail={`${o.retried} orders needed a retry`} />
        <StatCard icon={Wallet} label="Cash gap" value={dt(gap)} tone={gap > 0.5 ? "bad" : undefined} detail={`${t.short_deliveries} short deliveries`} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <Panel title="Delivery attempts per day" description="Hover a bar for the numbers"
          actions={<div className="flex gap-3 text-[13px] font-medium text-ink-700">
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-brand" />Delivered</span>
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-[#F4A79D]" />Failed</span>
          </div>}>
          <DailyChart rows={data.by_day} />
        </Panel>

        <section className="flex flex-col rounded-3xl bg-gradient-to-br from-[#CDEFD9] via-[#BDE8CF] to-[#A6DEBE] p-6 shadow-card">
          <div className="flex items-start justify-between">
            <p className="text-lg font-bold text-ink">Cash collected</p>
            <IconBadge icon={Banknote} tone="white" />
          </div>
          <p className="mt-2 text-[36px] font-extrabold leading-none tracking-tight tabular">{dt(t.cash_collected)}</p>
          <p className="mt-2 text-sm font-medium text-ink-700">of {dt(t.cash_expected)} due on delivered orders</p>
          <div className="mt-auto pt-6">
            <div className="flex items-baseline justify-between text-sm font-semibold">
              <span>Received</span><span className="tabular">{cashPct}%</span>
            </div>
            <div className="mt-1.5 h-3 rounded-full bg-white/70"><div className="h-full rounded-full bg-brand-700" style={{ width: `${cashPct}%` }} /></div>
            <p className="mt-4 rounded-2xl bg-white/60 px-4 py-3 text-sm text-ink-700">
              {gap > 0.5 ? <><b className="text-ink">{dt(gap)}</b> missing across {t.short_deliveries} deliveries where the driver recorded less than due.</>
                : "Every delivered order was paid in full."}
            </p>
          </div>
        </section>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Drivers" description="Attempt success, stops per working day, cash gap" bodyClass="px-3 pb-4">
          <ul className="space-y-1">
            {data.by_driver.map((d) => (
              <li key={d.driver} className="flex items-center gap-3 rounded-2xl px-3 py-2.5 hover:bg-mint-50">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-mint-200 text-sm font-bold text-brand-700">{initials(d.driver)}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-sm font-semibold">{d.driver}</span>
                    <span className="text-sm font-bold tabular">{d.success_rate}%</span>
                  </span>
                  <Bar value={d.success_rate} title={`${d.delivered} of ${d.attempts} attempts`} />
                  <span className="mt-1 flex justify-between text-xs tabular text-ink-500">
                    <span>{d.stops_per_day} stops / day</span>
                    <span className={cx(d.cash_gap > 0 && "font-semibold text-red-700")}>{d.cash_gap > 0 ? `${dt(d.cash_gap)} short` : "Cash complete"}</span>
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="Governorates" description="Lowest attempt success first" bodyClass="px-6 pb-5">
          <ul className="space-y-3.5">
            {data.by_governorate.map((g) => (
              <li key={g.governorate} className="text-sm">
                <span className="flex items-baseline justify-between">
                  <span className="font-semibold">{g.governorate}</span>
                  <span className="tabular"><b>{g.success_rate}%</b> <span className="text-xs text-ink-500">of {g.attempts}</span></span>
                </span>
                <Bar value={g.success_rate} title={`${g.delivered} of ${g.attempts} attempts`} color={g.success_rate < 75 ? "bg-sun" : "bg-brand"} />
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="Why deliveries fail" bodyClass="px-6 pb-6">
          <div className="flex h-[300px] items-end gap-4 pt-2">
            {data.reasons.map((r, i) => (
              <div key={r.reason} className="flex h-full flex-1 flex-col items-center justify-end gap-2" title={`${r.count} failed attempts`}>
                <span className="text-sm font-bold tabular">{r.count}</span>
                <div className={cx("w-full max-w-[56px] rounded-2xl", ["bg-[#F28B7D]", "bg-sun", "bg-lime", "bg-leaf", "bg-mint-300"][i % 5])}
                  style={{ height: `${Math.max(6, (100 * r.count) / maxReason) * 0.72}%` }} />
                <span className="text-center text-xs font-medium leading-tight text-ink-700">{r.reason}</span>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Customers who keep refusing" description="By phone number. Their next orders are flagged at import." bodyClass="px-5 pb-5">
          <table className="table-soft">
            <thead><tr><th>Customer</th><th>Phone</th><th className="text-right">Failed</th></tr></thead>
            <tbody>
              {data.risky_customers.map((c) => (
                <tr key={c.phone}>
                  <td className="font-medium">{c.name}</td>
                  <td className="tabular text-ink-500">{c.phone}</td>
                  <td className="text-right">
                    <span className="rounded-full bg-red-50 px-2.5 py-1 text-xs font-semibold tabular text-red-700">{c.failed} of {c.attempts}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>

      <details className="rounded-3xl bg-white px-6 py-4 text-sm shadow-card">
        <summary className="cursor-pointer font-semibold">How these numbers are calculated</summary>
        <dl className="mt-3 grid gap-3 text-ink-700 sm:grid-cols-2">
          <div><dt className="font-semibold text-ink">Attempt success</dt><dd>Delivered attempts divided by all attempts. Undone attempts are excluded.</dd></div>
          <div><dt className="font-semibold text-ink">First-try delivery</dt><dd>Original orders delivered on their first attempt, out of original orders with at least one attempt.</dd></div>
          <div><dt className="font-semibold text-ink">Eventually delivered</dt><dd>Original orders delivered on any attempt, including next-day retries. A retry is not counted as a new order.</dd></div>
          <div><dt className="font-semibold text-ink">Cash gap</dt><dd>Amount due on delivered orders minus cash the driver recorded.</dd></div>
        </dl>
      </details>
    </div>
  );
}

function Bar({ value, title, color = "bg-brand" }) {
  return (
    <div className="mt-1.5 h-2.5 rounded-full bg-mint" title={title}>
      <div className={cx("h-full rounded-full", color)} style={{ width: `${Math.max(3, value)}%` }} />
    </div>
  );
}

function DailyChart({ rows }) {
  const max = Math.max(...rows.map((r) => r.attempts), 1);
  const step = max > 40 ? 20 : max > 20 ? 10 : 5;
  const top = Math.ceil(max / step) * step;
  const H = 220;
  const ticks = [];
  for (let v = 0; v <= top; v += step) ticks.push(v);
  const gap = rows.length > 40 ? 2 : rows.length > 14 ? 4 : 10;
  return (
    <div>
      <div className="relative mt-5 pl-8" style={{ paddingBottom: 26 }}>
        {ticks.map((v) => (
          <div key={v} className="absolute left-8 right-0 border-t border-dashed border-mint-200" style={{ bottom: 26 + (H * v) / top }}>
            <span className="absolute -left-8 -top-2 w-6 text-right text-[11px] tabular text-ink-500">{v}</span>
          </div>
        ))}
        <div className="relative flex items-end" style={{ height: H, gap }}>
          {rows.map((r) => (
            <div key={r.day} className="group flex h-full flex-1 flex-col justify-end"
              title={`${formatDay(r.day)}: ${r.delivered} delivered, ${r.failed} failed (${r.success_rate}%)`}>
              <div className="flex flex-col overflow-hidden rounded-full transition-opacity group-hover:opacity-80"
                style={{ height: (H * r.attempts) / top }}>
                <div className="bg-[#F4A79D]" style={{ flex: r.failed }} />
                <div className="bg-brand" style={{ flex: r.delivered }} />
              </div>
            </div>
          ))}
        </div>
        <div className="absolute bottom-0 left-8 right-0 flex justify-between text-xs text-ink-500">
          <span>{formatDay(rows[0].day)}</span><span>{formatDay(rows[rows.length - 1].day)}</span>
        </div>
      </div>
    </div>
  );
}
