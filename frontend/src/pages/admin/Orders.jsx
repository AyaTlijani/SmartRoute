import React, { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Package, Search } from "lucide-react";
import { api, dt, errorText, formatDay } from "../../api";
import { DayPicker, useDay } from "../../layouts/AdminLayout";
import OrderDetail from "../../components/OrderDetail";
import {
  Button, CustomerBadge, EmptyState, ErrorBanner, Input, Loading, PageHeader, Panel, PrecisionBadge, StatusBadge, cx,
} from "../../components/ui";

const FILTERS = [
  ["all", "All"], ["pending", "Unassigned"], ["assigned", "To deliver"], ["delivered", "Delivered"], ["failed", "Failed"],
];

export default function Orders() {
  const { day } = useDay();
  const [params, setParams] = useSearchParams();
  const status = params.get("status") || "all";
  const [orders, setOrders] = useState(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(null);
  const [error, setError] = useState(null);

  const load = () => api.get("/orders", { params: { day } }).then((r) => setOrders(r.data)).catch((e) => setError(errorText(e)));
  useEffect(() => {
    setOrders(null);
    load();
  }, [day]);

  const shown = useMemo(() => {
    if (!orders) return [];
    const q = query.trim().toLowerCase();
    return orders.filter((o) =>
      (status === "all" || o.status === status) &&
      (!q || [o.customer_name, o.phone, o.city, o.governorate, o.address, String(o.id)].some((v) => (v || "").toLowerCase().includes(q)))
    );
  }, [orders, status, query]);

  const count = (s) => (orders || []).filter((o) => s === "all" || o.status === s).length;

  return (
    <>
      <PageHeader title="Orders" description={`Every order scheduled for ${formatDay(day)}.`} actions={<DayPicker />} />
      <ErrorBanner error={error} onClose={() => setError(null)} />
      {!orders ? <Loading /> : orders.length === 0 ? (
        <Panel><EmptyState icon={Package} title="No orders for this day"
          action={<Link to="/admin/import"><Button>Import orders</Button></Link>}>
          Import the confirmed-orders Excel file to schedule deliveries.
        </EmptyState></Panel>
      ) : (
        <Panel bodyClass="">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-3">
            <div className="flex flex-wrap gap-1" role="tablist">
              {FILTERS.map(([k, label]) => (
                <button key={k} type="button" role="tab" aria-selected={status === k}
                  onClick={() => setParams(k === "all" ? {} : { status: k })}
                  className={cx("rounded-lg px-3 py-1.5 text-[13px] font-semibold", status === k ? "bg-brand text-white" : "text-ink-700 hover:bg-slate-100")}>
                  {label} <span className="tabular opacity-70">{count(k)}</span>
                </button>
              ))}
            </div>
            <div className="relative w-full sm:w-64">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-300" />
              <Input placeholder="Search name, phone, city" value={query} onChange={(e) => setQuery(e.target.value)} className="pl-9" aria-label="Search orders" />
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[880px] text-left text-sm">
              <thead className="border-b border-slate-200 text-[13px] text-ink-500">
                <tr>
                  <th className="px-5 py-2.5 font-medium">Order</th>
                  <th className="py-2.5 pr-4 font-medium">Customer</th>
                  <th className="py-2.5 pr-4 font-medium">Location</th>
                  <th className="py-2.5 pr-4 font-medium">Driver</th>
                  <th className="py-2.5 pr-4 font-medium">Slot / ETA</th>
                  <th className="py-2.5 pr-4 text-right font-medium">COD</th>
                  <th className="py-2.5 pr-5 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {shown.map((o) => (
                  <tr key={o.id} onClick={() => setOpen(o.id)} className="cursor-pointer align-top hover:bg-slate-50">
                    <td className="px-5 py-3 tabular text-ink-500">#{o.id}</td>
                    <td className="py-3 pr-4">
                      <button type="button" className="text-left font-medium hover:text-brand" onClick={() => setOpen(o.id)}>{o.customer_name}</button>
                      <span className="block tabular text-[13px] text-ink-500">{o.phone}</span>
                      <div className="mt-1"><CustomerBadge order={o} /></div>
                    </td>
                    <td className="py-3 pr-4">
                      {o.city || o.governorate}
                      <span className="block text-[13px] text-ink-500">{o.governorate}</span>
                      <div className="mt-1"><PrecisionBadge precision={o.location_precision} /></div>
                    </td>
                    <td className="py-3 pr-4">{o.driver_name || <span className="text-ink-500">None</span>}</td>
                    <td className="whitespace-nowrap py-3 pr-4 tabular">
                      {o.eta || "–"}
                      <span className="block text-[13px] text-ink-500">{["Any time", "Morning", "Afternoon"][o.slot || 0]}</span>
                    </td>
                    <td className="whitespace-nowrap py-3 pr-4 text-right tabular">
                      {dt(o.cod_amount)}
                      {o.status === "delivered" && o.cash_collected < o.cod_amount && (
                        <span className="block text-[13px] text-red-700">got {dt(o.cash_collected)}</span>
                      )}
                    </td>
                    <td className="py-3 pr-5">
                      <StatusBadge status={o.status} />
                      {o.fail_reason && <span className="mt-1 block text-[13px] text-red-700">{o.fail_reason}</span>}
                      {o.retry_order_id && <span className="mt-1 block text-[13px] text-ink-500">Retry #{o.retry_order_id}</span>}
                      {o.unscheduled_reason && <span className="mt-1 block text-[13px] text-amber-800">Not on route</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {shown.length === 0 && <p className="px-5 py-8 text-sm text-ink-500">No order matches this filter.</p>}
          </div>
        </Panel>
      )}
      {open && <OrderDetail orderId={open} onClose={() => setOpen(null)} onChanged={load} />}
    </>
  );
}
