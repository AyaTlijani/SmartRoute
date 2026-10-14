import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, CheckCircle2, ChevronRight, Info, OctagonAlert, Truck } from "lucide-react";
import { api, dt, errorText, formatDay } from "../../api";
import { DayPicker, useDay } from "../../layouts/AdminLayout";
import { Button, DayStateBadge, EmptyState, ErrorBanner, Loading, Metric, MetricStrip, PageHeader, Panel, cx } from "../../components/ui";

const LEVEL = {
  critical: { icon: OctagonAlert, color: "text-red-700", bar: "bg-red-600" },
  warning: { icon: AlertTriangle, color: "text-amber-700", bar: "bg-amber-500" },
  info: { icon: Info, color: "text-brand", bar: "bg-brand" },
};

export default function Overview() {
  const { day } = useDay();
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
      <PageHeader title="Overview" description={`Deliveries for ${formatDay(day)}, and what needs your attention.`}
        actions={<DayPicker />} />
      <ErrorBanner error={error} />
      {!data ? <Loading /> : <Body data={data} />}
    </>
  );
}

function Body({ data }) {
  const c = data.counts;
  return (
    <div className="space-y-5">
      <MetricStrip>
        <Metric label="Orders" value={c.total} detail={`${c.pending} unassigned, ${c.assigned} to deliver`} />
        <Metric label="Completed" value={`${data.completion_rate}%`} detail={`${c.delivered + c.failed} of ${c.total} stops`} />
        <Metric label="Delivered on attempt" value={data.success_rate == null ? "–" : `${data.success_rate}%`}
          tone={data.success_rate == null ? undefined : data.success_rate >= 85 ? "good" : "warn"}
          detail={`${c.delivered} delivered, ${c.failed} failed`} />
        <Metric label="Cash collected" value={dt(data.cash.collected)} detail={`of ${dt(data.cash.expected)} expected`} />
        <Metric label="Active drivers" value={data.active_drivers} detail={`${data.fleet.length} with orders today`} />
      </MetricStrip>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <Panel title="Needs attention" bodyClass="">
          {data.attention.length === 0 ? (
            <EmptyState icon={CheckCircle2} title="Nothing to act on">
              Every order is assigned and routed, and no delivery needs a decision.
            </EmptyState>
          ) : (
            <ul className="divide-y divide-slate-100">
              {data.attention.map((a) => {
                const L = LEVEL[a.level];
                return (
                  <li key={a.title}>
                    <Link to={a.to} className="group flex items-start gap-3 px-5 py-3.5 hover:bg-slate-50">
                      <L.icon className={cx("mt-0.5 h-[18px] w-[18px] shrink-0", L.color)} aria-hidden="true" />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-ink">{a.title}</span>
                        <span className="block text-[13px] text-ink-500">{a.detail}</span>
                      </span>
                      <ChevronRight className="mt-0.5 h-4 w-4 text-ink-300 group-hover:text-ink-500" aria-hidden="true" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        <Panel title="Drivers on the road" bodyClass=""
          actions={<Link to="/admin/dispatch"><Button variant="ghost" size="sm">Open dispatch</Button></Link>}>
          {data.fleet.length === 0 ? (
            <EmptyState icon={Truck} title="No routes yet">Assign today's orders to see each driver's progress.</EmptyState>
          ) : (
            <ul className="divide-y divide-slate-100">
              {data.fleet.map((f) => {
                const done = f.delivered + f.failed;
                return (
                  <li key={f.id}>
                   <Link to={`/admin/dispatch?driver=${f.id}`} className="block px-5 py-3 hover:bg-slate-50">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm font-medium">{f.name}</span>
                      <DayStateBadge state={f.state} since={f.started_at} />
                    </div>
                    <p className="mt-1 text-[13px] tabular text-ink-500">{done} of {f.total} stops</p>
                    <div className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-slate-100" role="img"
                      aria-label={`${f.delivered} delivered, ${f.failed} failed, ${f.total - done} left`}>
                      <span className="bg-emerald-600" style={{ width: `${f.total ? (100 * f.delivered) / f.total : 0}%` }} />
                      <span className="bg-red-600" style={{ width: `${f.total ? (100 * f.failed) / f.total : 0}%` }} />
                    </div>
                    <p className="mt-1.5 text-xs tabular text-ink-500">
                      {f.delivered} delivered{f.failed ? `, ${f.failed} failed` : ""}, {dt(f.cash_collected)} collected
                      {f.state !== "finished" && f.state !== "reconciled" && f.end_time && `, back at depot around ${f.end_time}`}
                    </p>
                   </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </div>

      <Panel title="Latest updates from drivers" bodyClass="">
        {data.activity.length === 0 ? (
          <p className="px-5 py-6 text-sm text-ink-500">No delivery has been recorded for this day yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {data.activity.map((a, i) => (
              <li key={i} className="flex items-center gap-3 px-5 py-2.5 text-sm">
                <span className={cx("h-2 w-2 shrink-0 rounded-full", a.result === "delivered" ? "bg-emerald-600" : "bg-red-600")} />
                <span className="w-12 shrink-0 tabular text-ink-500">{a.created_at.slice(11, 16)}</span>
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-medium">{a.driver}</span>{" "}
                  {a.result === "delivered" ? `delivered to ${a.customer_name}, ${dt(a.cash_collected)}` : `could not deliver to ${a.customer_name}: ${a.reason}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
