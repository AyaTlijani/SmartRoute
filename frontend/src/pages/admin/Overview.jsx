import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle, Banknote, CheckCircle2, ChevronRight, Info, OctagonAlert, PackageCheck, Truck, Users,
} from "lucide-react";
import { api, dt, errorText, formatDay } from "../../api";
import { useAuth } from "../../auth";
import { DayPicker, useDay } from "../../layouts/AdminLayout";
import { AreaChart, BarChart, Donut, Sparkline } from "../../components/charts";
import { Button, DayStateBadge, EmptyState, ErrorBanner, IconBadge, Loading, PageHeader, Panel, cx } from "../../components/ui";

const LEVEL = {
  critical: { icon: OctagonAlert, tone: "red" },
  warning: { icon: AlertTriangle, tone: "sun" },
  info: { icon: Info, tone: "mint" },
};

const weekday = (iso) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-GB", { weekday: "short" });
};
const short = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k` : `${Math.round(n)}`);

export default function Overview() {
  const { day } = useDay();
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    setData(null);
    const load = () => api.get("/overview", { params: { day } }).then((r) => setData(r.data)).catch((e) => setError(errorText(e)));
    load();
    const t = setInterval(load, 20000);
    return () => clearInterval(t);
  }, [day]);

  return (
    <>
      <PageHeader title={`Welcome back, ${(user?.full_name || "").split(" ")[0]}`} actions={<DayPicker />} />
      <ErrorBanner error={error} />
      {!data ? <Loading /> : <Body data={data} />}
    </>
  );
}

function Body({ data }) {
  const c = data.counts;
  const weekCash = data.week.reduce((s, d) => s + d.cash, 0);
  return (
    <div className="space-y-6">
      {/* Row 1: money */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <Panel title="Cash collected" description="Cash on delivery recorded by drivers, last 7 days"
          actions={<div className="text-right"><p className="text-[13px] text-ink-500">This week</p>
            <p className="text-lg font-extrabold text-brand">+{dt(weekCash)}</p></div>}>
          <AreaChart data={data.week.map((d) => ({ label: weekday(d.day), value: d.cash }))} format={short} />
        </Panel>

        <section className="relative flex flex-col overflow-hidden rounded-3xl bg-gradient-to-br from-[#CDEFD9] via-[#BDE8CF] to-[#A6DEBE] p-6 shadow-card">
          <div className="flex items-start justify-between">
            <p className="text-lg font-bold text-ink">Cash collected today</p>
            <IconBadge icon={Truck} tone="white" />
          </div>
          <p className="mt-2 text-[40px] font-extrabold leading-none tracking-tight tabular text-ink">{dt(data.cash.collected)}</p>
          <p className="mt-2 text-sm font-medium text-ink-700">of {dt(data.cash.expected)} expected from today's deliveries</p>
          <div className="mt-auto pt-6"><Sparkline values={data.week.map((d) => d.cash)} /></div>
        </section>
      </div>

      {/* Row 2: orders */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <Panel title="Orders by status" description={`${c.total} orders for ${formatDay(data.day)}`}>
          <BarChart data={[
            { label: "Unassigned", value: c.pending, color: "#A8D86A" },
            { label: "To deliver", value: c.assigned, color: "#5CC697" },
            { label: "Delivered", value: c.delivered, color: "#16935C" },
            { label: "Failed", value: c.failed, color: "#F2C53D" },
          ]} />
        </Panel>

        <Panel title="Delivery performance">
          <div className="flex items-center gap-6">
            <Donut value={data.success_rate} size={150} stroke={20} label="delivered" />
            <ul className="min-w-0 flex-1 space-y-4">
              <li className="flex items-center justify-between gap-3">
                <span><span className="block text-sm text-ink-500">Completed</span>
                  <span className="text-xl font-extrabold tabular">{data.completion_rate}%</span></span>
                <IconBadge icon={PackageCheck} />
              </li>
              <li className="flex items-center justify-between gap-3">
                <span><span className="block text-sm text-ink-500">Active drivers</span>
                  <span className="text-xl font-extrabold tabular">{data.active_drivers}</span></span>
                <IconBadge icon={Users} />
              </li>
            </ul>
          </div>
          <p className="mt-4 text-[13px] text-ink-500">Share of today's attempts that ended delivered ({c.delivered} of {c.delivered + c.failed}).</p>
        </Panel>
      </div>

      {/* Row 3: action */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Needs attention" bodyClass="px-3 pb-4">
          {data.attention.length === 0 ? (
            <EmptyState icon={CheckCircle2} title="Nothing to act on">Every order is planned and no delivery needs a decision.</EmptyState>
          ) : (
            <ul className="space-y-1">
              {data.attention.map((a) => {
                const L = LEVEL[a.level];
                return (
                  <li key={a.title}>
                    <Link to={a.to} className="group flex items-center gap-3 rounded-2xl px-3 py-3 hover:bg-mint-50">
                      <IconBadge icon={L.icon} tone={L.tone} size="sm" />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold text-ink">{a.title}</span>
                        <span className="block text-[13px] text-ink-500">{a.detail}</span>
                      </span>
                      <ChevronRight className="h-4 w-4 text-ink-300 group-hover:text-ink-500" aria-hidden="true" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        <Panel title="Drivers on the road" bodyClass="px-3 pb-4"
          actions={<Link to="/admin/dispatch"><Button variant="secondary" size="sm">Open dispatch</Button></Link>}>
          {data.fleet.length === 0 ? (
            <EmptyState icon={Truck} title="No routes yet">Plan today's orders to see each driver's progress.</EmptyState>
          ) : (
            <ul className="space-y-1">
              {data.fleet.map((f) => {
                const done = f.delivered + f.failed;
                return (
                  <li key={f.id}>
                    <Link to={`/admin/dispatch?driver=${f.id}`} className="flex items-center gap-3 rounded-2xl px-3 py-3 hover:bg-mint-50">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-mint-200 text-sm font-bold text-brand-700">
                        {f.name.split(" ").map((w) => w[0]).join("")}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center justify-between gap-2">
                          <span className="truncate text-sm font-semibold">{f.name}</span>
                          <DayStateBadge state={f.state} since={f.started_at} />
                        </span>
                        <span className="mt-1.5 flex h-2 overflow-hidden rounded-full bg-mint" role="img"
                          aria-label={`${f.delivered} delivered, ${f.failed} failed, ${f.total - done} left`}>
                          <span className="bg-brand" style={{ width: `${f.total ? (100 * f.delivered) / f.total : 0}%` }} />
                          <span className="bg-sun" style={{ width: `${f.total ? (100 * f.failed) / f.total : 0}%` }} />
                        </span>
                        <span className="mt-1 block text-xs tabular text-ink-500">
                          {done} of {f.total} stops, {dt(f.cash_collected)} collected
                        </span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </div>

      {/* Row 4: activity */}
      <Panel title="Latest updates from drivers" actions={<IconBadge icon={Banknote} size="sm" />}>
        {data.activity.length === 0 ? (
          <p className="py-4 text-sm text-ink-500">No delivery has been recorded for this day yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table-soft min-w-[640px]">
              <thead>
                <tr><th>Time</th><th>Driver</th><th>Customer</th><th>Result</th><th className="text-right">Cash (DT)</th></tr>
              </thead>
              <tbody>
                {data.activity.map((a, i) => (
                  <tr key={i}>
                    <td className="tabular">{a.created_at.slice(11, 16)}</td>
                    <td className="font-medium">{a.driver}</td>
                    <td>{a.customer_name}</td>
                    <td className={cx("font-semibold", a.result === "delivered" ? "text-brand" : "text-red-700")}>
                      {a.result === "delivered" ? "Delivered" : `Failed: ${a.reason}`}
                    </td>
                    <td className="text-right tabular">{a.result === "delivered" ? dt(a.cash_collected).replace(" DT", "") : "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
